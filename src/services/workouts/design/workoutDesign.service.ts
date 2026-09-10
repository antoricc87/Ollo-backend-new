/**
 * Workout design — the one place training is GENERATED. A strict-schema LLM
 * call drafts a session from a brief (the ask + the person + how they train +
 * what they did recently + their own last loads); code then checks it and asks
 * for a revision when it misses (time band, equipment, coverage, recovery,
 * loads). Loads (kg) are only ever the user's own history — a lift with no
 * history gets a load note, never an invented number.
 *
 * Output is a PlannedSessionInput: the exact shape WorkoutService persists as
 * a PLANNED row, so "design → put on a day → do it → log it" is one record.
 */
import moment from "moment-timezone";
import prisma from "../../../utility/prismaClient";
import { getLLM } from "../../agent/llm/openai.client";
import { ACTIVITY_KEYS, activityByKey } from "../domain/activity.catalog";
import { canonicalExercise, catalogForPlanner, muscleGroupsFor } from "../domain/exercise.catalog";
import { fmtSets } from "../domain/workout.metrics";
import { FOCUS, PLACE, PlannedSessionInput, type ExerciseInput } from "../domain/workout.schema";
import TrainingProfileService from "../model/training_profile.model";
import WorkoutService from "../model/workouts.model";

const DAY = "YYYY-MM-DD";
export const DEFAULT_SESSION_MIN = 45;
const MAX_REVISIONS = 2;
const REPS_SECONDS = 3; // per rep, for the time estimate
const WARMUP_MIN = 5;
const COOLDOWN_MIN = 3;

/* --------------------------------- brief --------------------------------- */

export type DesignAsk = {
  durationMin: number;
  focus?: (typeof FOCUS)[number] | null;
  muscleGroups?: string[];
  place?: (typeof PLACE)[number] | null;
  equipment?: string[];
  request?: string | null;
  /** Local day the session is for (defaults today) — only used for recovery reasoning and the row. */
  date: string;
  /** Other sessions planned in the same week (when designing a week) so recovery is judged across days. */
  weekContext?: { date: string; title: string; focus: string; muscleGroups: string[] }[];
};

export type DesignBrief = Awaited<ReturnType<typeof buildBrief>>;

/** Everything the designer is allowed to know. Built once, reused across a week. */
export const buildBrief = async (patientId: string, opts: { today: string; timeZone: string; client?: { sleepMinutesLastNight?: number; hrvMs?: number; restingHeartRate?: number } | null }) => {
  const tz = opts.timeZone;
  const [summary, patient, profile, plan, memories] = await Promise.all([
    prisma.patientSummary.findUnique({ where: { patientId }, include: { vitals: true, conditions: { include: { condition: true } }, medications: { include: { medication: true } }, exercise: true } }),
    prisma.patient.findUnique({ where: { id: patientId }, select: { dob: true, gender: true } }),
    TrainingProfileService.get(patientId),
    prisma.healthPlan.findFirst({ where: { patientId, status: "ACTIVE" }, include: { targets: true }, orderBy: { createdAt: "desc" } }),
    prisma.agentMemory.findMany({ where: { patientId, active: true, category: { in: ["PREFERENCE", "CONSTRAINT", "ROUTINE"] } }, take: 20, select: { content: true, category: true } }),
  ]);
  const weightKg = await WorkoutService.bodyWeightKg(patientId);
  const age = patient?.dob ? moment().diff(moment(patient.dob), "years") : null;

  // Last 7 days, completed only — what was trained and when (recovery).
  const from = moment.tz(opts.today, DAY, tz).subtract(7, "days").toDate();
  const to = moment.tz(opts.today, DAY, tz).endOf("day").toDate();
  const recentRows = await WorkoutService.list(patientId, { from, to }, { limit: 20 });
  const recent = recentRows.map((s) => ({
    date: moment(s.startedAt).tz(tz).format(DAY),
    daysAgo: moment.tz(opts.today, DAY, tz).diff(moment(s.startedAt).tz(tz).startOf("day"), "days"),
    title: s.title ?? activityByKey(s.activityKey).label,
    activity: s.activityKey,
    shape: activityByKey(s.activityKey).shape,
    focus: s.focus,
    durationMin: Math.round(s.durationSec / 60),
    muscleGroups: s.muscleGroups.length ? s.muscleGroups : Array.from(new Set(s.exercises.map((e) => e.muscleGroup).filter((x): x is string => !!x))),
    exercises: s.exercises.slice(0, 8).map((e) => `${e.name} ${fmtSets(e.sets)}`.trim()),
  }));

  // The user's own last loads per lift — the ONLY source of target kg.
  const lifts = await prisma.workoutExercise.findMany({
    where: { session: { patientId, deletedAt: null, status: "COMPLETED" }, exerciseKey: { not: { startsWith: "custom:" } } },
    orderBy: { session: { startedAt: "desc" } },
    take: 120,
    include: { sets: { orderBy: { sortOrder: "asc" } }, session: { select: { startedAt: true } } },
  });
  const lastLoads: Record<string, { sets: string; kg: number | null; reps: number | null; date: string }> = {};
  for (const l of lifts) {
    if (lastLoads[l.exerciseKey]) continue;
    const work = l.sets.filter((s) => !s.isWarmup && (s.reps != null || s.weightKg != null));
    if (!work.length) continue;
    const kg = Math.max(...work.map((s) => s.weightKg ?? 0)) || null;
    const reps = work.find((s) => s.weightKg === kg)?.reps ?? work[0].reps ?? null;
    lastLoads[l.exerciseKey] = { sets: fmtSets(l.sets), kg, reps, date: moment(l.session.startedAt).tz(tz).format(DAY) };
  }

  const sessionsTarget = plan?.targets.find((t) => t.metricKey === "exercise_sessions")?.min ?? null;
  return {
    today: opts.today,
    timeZone: tz,
    person: {
      age,
      sex: patient?.gender ?? null,
      weightKg,
      activityLevel: summary?.vitals?.activityLevel ?? null,
      conditions: summary?.conditions.map((c) => c.condition.name) ?? [],
      medications: summary?.medications.map((m) => m.medication.name) ?? [],
      exercisePrefs: summary?.exercise ? { frequency: summary.exercise.frequency, preferences: summary.exercise.preferences } : null,
    },
    training: profile
      ? { place: profile.place, equipment: profile.equipment, experience: profile.experience, sessionMinutes: profile.sessionMinutes, preferredDays: profile.preferredDays, preferredTime: profile.preferredTime, limitations: profile.limitations }
      : null,
    plan: plan ? { outcome: plan.outcome, intensity: plan.intensity, sessionsPerWeek: sessionsTarget } : null,
    recent,
    lastLoads,
    remembered: memories.map((m) => `[${m.category.toLowerCase()}] ${m.content}`),
    recovery: opts.client ? { sleepMinutesLastNight: opts.client.sleepMinutesLastNight ?? null, hrvMs: opts.client.hrvMs ?? null, restingHeartRate: opts.client.restingHeartRate ?? null } : null,
  };
};

/* --------------------------------- schema -------------------------------- */

const EXERCISE_OUT = {
  type: "object",
  properties: {
    exerciseKey: { type: ["string", "null"], description: "Catalog key when one fits, else null (then name is a custom exercise)" },
    name: { type: "string" },
    sets: { type: "integer" },
    reps: { type: ["integer", "null"], description: "Reps per set (lower end of a range); null for timed sets" },
    repsMax: { type: ["integer", "null"], description: "Upper end of a rep range, else null" },
    durationSec: { type: ["integer", "null"], description: "Timed sets (plank, carries, intervals); null for rep sets" },
    targetKg: { type: ["number", "null"], description: "ONLY when lastLoads has this exerciseKey — a small progression on that; otherwise null" },
    restSec: { type: "integer" },
    loadNote: { type: ["string", "null"], description: "How to pick the weight when targetKg is null — SHORT, under 8 words ('a weight you could do 12 with'); null when targetKg is set" },
    alternatives: { type: "array", items: { type: "string" }, description: "0–2 catalog keys to swap in if the kit is busy or missing" },
  },
  required: ["exerciseKey", "name", "sets", "reps", "repsMax", "durationSec", "targetKg", "restSec", "loadNote", "alternatives"],
  additionalProperties: false,
} as const;

const SESSION_OUT = {
  type: "object",
  properties: {
    title: { type: "string", description: "Short: 'Upper body strength', 'Easy run', 'Hotel-room conditioning'" },
    activityKey: { type: "string", enum: ACTIVITY_KEYS },
    focus: { type: "string", enum: FOCUS },
    place: { type: "string", enum: PLACE },
    durationMin: { type: "integer" },
    muscleGroups: { type: "array", items: { type: "string" }, description: "Catalog groups this session trains" },
    why: { type: "string", description: "One line, in second person: how it fits their plan, recovery and what they did recently" },
    warmup: { type: "array", items: { type: "string" }, description: "2–4 short lines" },
    cooldown: { type: "array", items: { type: "string" }, description: "1–3 short lines" },
    distanceKm: { type: ["number", "null"], description: "Endurance sessions only" },
    exercises: { type: "array", items: EXERCISE_OUT },
    notes: { type: ["string", "null"], description: "Anything the user should know (pace, intensity cue, what to skip if short on time)" },
  },
  required: ["title", "activityKey", "focus", "place", "durationMin", "muscleGroups", "why", "warmup", "cooldown", "distanceKm", "exercises", "notes"],
  additionalProperties: false,
} as const;

type SessionOut = {
  title: string;
  activityKey: string;
  focus: (typeof FOCUS)[number];
  place: (typeof PLACE)[number];
  durationMin: number;
  muscleGroups: string[];
  why: string;
  warmup: string[];
  cooldown: string[];
  distanceKm: number | null;
  exercises: { exerciseKey: string | null; name: string; sets: number; reps: number | null; repsMax: number | null; durationSec: number | null; targetKg: number | null; restSec: number; loadNote: string | null; alternatives: string[] }[];
  notes: string | null;
};

const SYSTEM = `You are a careful strength & conditioning coach designing ONE session for a specific person. Rules:
- Honour the ask exactly: duration (the whole session, warm-up and rests included), focus, muscle groups, place. Only equipment they have (bodyweight always counts; a gym has everything).
- Pick exercises from the catalog by key; a custom exercise is allowed when nothing fits (exerciseKey null).
- Sets/reps/rest fit the focus: strength 3–6 reps, 2–4 min rest; hypertrophy 6–12 reps, 60–120 s; conditioning/endurance intervals or timed work, short rests; mobility slow, timed holds.
- Loads: targetKg ONLY for exercises present in lastLoads, as a small progression on that history (same weight or +2.5 kg / +5 %); everything else gets targetKg null and a loadNote telling them how to pick a weight. Never invent a kilogram.
- Recovery: avoid heavy work on muscle groups trained hard in the last 48 h unless the ask names them; a short night or low HRV → keep it moderate and say so in why.
- Conditions/medications on record shape intensity conservatively and are stated as the reason in why (e.g. "your record lists hypertension, so no breath-holding maximal lifts") — never advice about the condition itself. If limitations are given, respect them literally and name what you avoided.
- Experience: new → simple machine/bodyweight patterns, more coaching cues; experienced → compound barbell work first.
- Keep it doable: 4–7 exercises for 45 min strength, fewer for shorter; supersets are fine, say so in notes. Warm-up 2–4 lines, cool-down 1–3 lines.
- Plain language, no medical claims, no supplements. Output ONLY the schema.`;

/* --------------------------------- checks -------------------------------- */

const estimateMinutes = (s: PlannedSessionInput) => {
  let sec = (WARMUP_MIN + COOLDOWN_MIN) * 60;
  for (const e of s.exercises ?? []) {
    for (const set of e.sets ?? []) sec += set.durationSec ?? (set.targetReps ?? 10) * REPS_SECONDS;
    sec += Math.max(0, (e.sets?.length ?? 1) - 1) * (e.sets?.[0]?.restSec ?? 60) + 45; // set-up / transition
  }
  return Math.round(sec / 60);
};

export type DesignIssue = string;

/**
 * Deterministic checks. Mutates the session to enforce the load rule (kg only
 * from history) and returns what still misses for the reviser.
 */
export const checkSession = (s: PlannedSessionInput, ask: DesignAsk, brief: DesignBrief): { issues: DesignIssue[]; assumptions: string[] } => {
  const issues: DesignIssue[] = [];
  const assumptions: string[] = [];
  const isStrengthLike = ["strength", "hypertrophy", "conditioning", "mixed"].includes(s.focus ?? "");

  // time band (only meaningful when the session is made of sets)
  if (isStrengthLike && (s.exercises?.length ?? 0) > 0) {
    const est = estimateMinutes(s);
    const tol = Math.max(8, Math.round(ask.durationMin * 0.2));
    if (Math.abs(est - ask.durationMin) > tol) issues.push(`estimated ${est} min of work vs ${ask.durationMin} min asked — ${est > ask.durationMin ? "cut sets/exercises or rest" : "add a set or an exercise"}`);
  }
  if (s.durationMin !== ask.durationMin) s.durationMin = ask.durationMin;

  // equipment (outside a gym, only what they have; bodyweight always ok)
  const allowed = new Set<string>([...(ask.equipment ?? []), ...(brief.training?.equipment ?? []), "bodyweight", "other"]);
  const place = s.place ?? ask.place ?? brief.training?.place ?? null;
  if (place && place !== "gym" && allowed.size > 2) {
    for (const e of s.exercises ?? []) if (e.equipment && !allowed.has(e.equipment)) issues.push(`${e.name} needs ${e.equipment}, not available (${place}: ${[...allowed].filter((x) => x !== "other").join(", ")})`);
  }

  // requested muscle groups covered
  const want = new Set((ask.muscleGroups ?? []).flatMap(muscleGroupsFor));
  const have = new Set((s.exercises ?? []).map((e) => e.muscleGroup).filter(Boolean));
  for (const g of want) if (!have.has(g) && g !== "full_body" && g !== "cardio") issues.push(`asked for ${g}, no exercise targets it`);

  // recovery: heavy groups < 48 h ago, unless asked for
  const recentHeavy = new Set(brief.recent.filter((r) => r.daysAgo <= 1 && r.shape === "strength" && r.durationMin >= 20).flatMap((r) => r.muscleGroups));
  if (isStrengthLike && recentHeavy.size) {
    const clash = [...have].filter((g) => recentHeavy.has(g!) && !want.has(g!) && g !== "core");
    if (clash.length >= 2) issues.push(`${clash.join(", ")} were trained in the last 48 h and not asked for — pick fresher groups or make it light`);
  }

  // loads: kg only from history (enforced, not just flagged)
  for (const e of s.exercises ?? []) {
    const hist = brief.lastLoads[e.exerciseKey];
    for (const set of e.sets ?? []) {
      if (set.targetKg != null && !hist) {
        set.targetKg = null;
        if (!e.loadNote) e.loadNote = `a weight you could do ${set.targetRepsMax ?? set.targetReps ?? 10} with, leaving 2 reps in reserve`;
      }
      if (set.targetKg != null && hist?.kg != null && set.targetKg > hist.kg * 1.15) set.targetKg = Math.round(hist.kg * 1.05 * 2) / 2;
    }
    if (e.exerciseKey.startsWith("custom:")) assumptions.push(`${e.name} is not in the exercise library`);
  }
  if (brief.training?.limitations) assumptions.push(`kept your note: "${brief.training.limitations}"`);
  if (!brief.training) assumptions.push("no training profile yet — assumed a normal gym");
  return { issues, assumptions };
};

/* --------------------------------- design -------------------------------- */

const toPlanned = (out: SessionOut, ask: DesignAsk): PlannedSessionInput => {
  const exercises: ExerciseInput[] = out.exercises.map((e) => {
    const c = canonicalExercise(e.name, e.exerciseKey);
    const n = Math.max(1, Math.min(10, e.sets || 1));
    return {
      exerciseKey: c.key,
      name: c.def ? c.name : e.name,
      muscleGroup: c.def?.muscleGroup ?? null,
      equipment: c.def?.equipment ?? null,
      loadNote: e.loadNote,
      alternatives: (e.alternatives ?? []).filter((k) => canonicalExercise(k, k).def).slice(0, 2),
      sets: Array.from({ length: n }, () => ({ targetReps: e.reps, targetRepsMax: e.repsMax ?? null, targetKg: e.targetKg, restSec: e.restSec, durationSec: e.durationSec })),
    };
  });
  return PlannedSessionInput.parse({
    activityKey: (ACTIVITY_KEYS as readonly string[]).includes(out.activityKey) ? out.activityKey : "strength",
    title: out.title.slice(0, 80),
    plannedFor: ask.date,
    durationMin: ask.durationMin,
    focus: out.focus,
    place: out.place ?? ask.place ?? null,
    muscleGroups: Array.from(new Set(out.muscleGroups.flatMap(muscleGroupsFor).concat(exercises.map((e) => e.muscleGroup!).filter(Boolean)))).slice(0, 8),
    why: out.why?.slice(0, 300) ?? null,
    warmup: out.warmup.slice(0, 8),
    cooldown: out.cooldown.slice(0, 8),
    notes: out.notes,
    distanceKm: out.distanceKm,
    exercises,
  });
};

export type DesignedSession = { session: PlannedSessionInput; fit: { ok: boolean; issues: string[]; revised: boolean }; assumptions: string[]; model: string; latencyMs: number };

export const designSession = async (ask: DesignAsk, brief: DesignBrief, opts: { model?: string } = {}): Promise<DesignedSession> => {
  const llm = getLLM();
  const model = opts.model ?? process.env.WORKOUT_DESIGN_MODEL ?? llm.defaultModel;
  const t0 = Date.now();
  const generate = (revision?: { previous: SessionOut; issues: string[] }) =>
    llm.json<SessionOut>({
      system: SYSTEM + (revision ? "\nYou are REVISING a session that missed its checks: fix every listed issue, keep what was fine." : ""),
      user: JSON.stringify({
        ask: { ...ask, dayName: moment.utc(ask.date, DAY).format("dddd") },
        person: brief.person,
        training: brief.training,
        plan: brief.plan,
        recentSessions: brief.recent,
        lastLoads: brief.lastLoads,
        remembered: brief.remembered,
        recovery: brief.recovery,
        catalog: catalogForPlanner(),
        ...(revision ? { previous: revision.previous, issues: revision.issues } : {}),
      }),
      schema: SESSION_OUT,
      schemaName: "workout_session_design",
      model,
    });
  let out = await generate();
  let session = toPlanned(out, ask);
  let check = checkSession(session, ask, brief);
  let revised = false;
  for (let i = 0; i < MAX_REVISIONS && check.issues.length; i++) {
    const again = await generate({ previous: out, issues: check.issues });
    const s2 = toPlanned(again, ask);
    const c2 = checkSession(s2, ask, brief);
    if (c2.issues.length <= check.issues.length) {
      out = again;
      session = s2;
      check = c2;
      revised = true;
    }
  }
  return { session, fit: { ok: check.issues.length === 0, issues: check.issues, revised }, assumptions: check.assumptions, model, latencyMs: Date.now() - t0 };
};

/* ---------------------------------- week --------------------------------- */

export type WeekAsk = {
  startDate: string;
  days: number;
  sessionsPerWeek: number;
  sessionMinutes: number;
  focus?: (typeof FOCUS)[number] | null;
  place?: (typeof PLACE)[number] | null;
  request?: string | null;
};

type WeekOut = { title: string; notes: string; sessions: { day: number; title: string; activityKey: string; focus: (typeof FOCUS)[number]; durationMin: number; muscleGroups: string[]; why: string }[] };

const WEEK_SYSTEM = `You are a coach laying out ONE training week for a specific person: which days train, what each day is for. Rules:
- Exactly sessionsPerWeek sessions across the days (day 1 = startDate). Use preferredDays when given (the dayNames list maps day → weekday); otherwise spread sessions with rest between hard days.
- A sensible split for the count and experience: 2 → full body ×2; 3 → full body ×3 or push/pull/legs; 4 → upper/lower ×2; 5–6 → push/pull/legs + conditioning. Mix in conditioning/mobility/endurance when the focus or the plan asks for it (a weight-loss plan likes one conditioning day).
- Never put the same heavy muscle groups on consecutive days. Respect recent sessions (day 1 may follow a hard day already done).
- Respect limitations, equipment and place. why = one line per session, second person.
- Output ONLY the schema.`;

const WEEK_OUT = {
  type: "object",
  properties: {
    title: { type: "string", description: "e.g. 'Upper / lower week', 'Three full-body sessions'" },
    notes: { type: "string", description: "2 short lines about the week: what it builds, what to do if a day is missed" },
    sessions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          day: { type: "integer" },
          title: { type: "string" },
          activityKey: { type: "string", enum: ACTIVITY_KEYS },
          focus: { type: "string", enum: FOCUS },
          durationMin: { type: "integer" },
          muscleGroups: { type: "array", items: { type: "string" } },
          why: { type: "string" },
        },
        required: ["day", "title", "activityKey", "focus", "durationMin", "muscleGroups", "why"],
        additionalProperties: false,
      },
    },
  },
  required: ["title", "notes", "sessions"],
  additionalProperties: false,
} as const;

export type DesignedWeek = { title: string; notes: string; sessions: (DesignedSession & { day: number })[]; fit: { ok: boolean; issues: string[] }; model: string; latencyMs: number };

export const designWeek = async (ask: WeekAsk, brief: DesignBrief, opts: { model?: string } = {}): Promise<DesignedWeek> => {
  const llm = getLLM();
  const model = opts.model ?? process.env.WORKOUT_DESIGN_MODEL ?? llm.defaultModel;
  const t0 = Date.now();
  const dayNames = Array.from({ length: ask.days }, (_, i) => `${i + 1}: ${moment.utc(ask.startDate, DAY).add(i, "days").format("ddd D MMM")}`);
  const layout = (revision?: { previous: WeekOut; issues: string[] }) =>
    llm.json<WeekOut>({
      system: WEEK_SYSTEM + (revision ? "\nYou are REVISING a layout that missed its checks: fix every listed issue (exact session count, one session per day, no consecutive heavy days), keep what was fine." : ""),
      user: JSON.stringify({ ask: { ...ask, dayNames }, person: brief.person, training: brief.training, plan: brief.plan, recentSessions: brief.recent, remembered: brief.remembered, ...(revision ? { previous: revision.previous, issues: revision.issues } : {}) }),
      schema: WEEK_OUT,
      schemaName: "workout_week_design",
      model,
    });
  const checkLayout = (out: WeekOut) => {
    const issues: string[] = [];
    let sessions = out.sessions.filter((s) => s.day >= 1 && s.day <= ask.days).sort((a, b) => a.day - b.day);
    const dupes = sessions.length - new Set(sessions.map((s) => s.day)).size;
    sessions = sessions.filter((s, i) => sessions.findIndex((x) => x.day === s.day) === i); // one per day
    if (dupes) issues.push(`${dupes} day(s) had two sessions — one session per day`);
    if (sessions.length !== ask.sessionsPerWeek) issues.push(`${sessions.length} sessions laid out, exactly ${ask.sessionsPerWeek} asked (days available: 1–${ask.days})`);
    for (let i = 1; i < sessions.length; i++) {
      const a = sessions[i - 1], b = sessions[i];
      if (b.day - a.day === 1 && ["strength", "hypertrophy"].includes(a.focus) && ["strength", "hypertrophy"].includes(b.focus)) {
        const overlap = a.muscleGroups.flatMap(muscleGroupsFor).filter((g) => b.muscleGroups.flatMap(muscleGroupsFor).includes(g) && g !== "core");
        if (overlap.length) issues.push(`day ${a.day} and day ${b.day} both load ${overlap.join(", ")} on consecutive days`);
      }
    }
    return { sessions, issues };
  };
  let skeleton = await layout();
  let { sessions, issues } = checkLayout(skeleton);
  for (let i = 0; i < MAX_REVISIONS && issues.length; i++) {
    const again = await layout({ previous: skeleton, issues });
    const c = checkLayout(again);
    if (c.issues.length <= issues.length) {
      skeleton = again;
      sessions = c.sessions;
      issues = c.issues;
    }
  }
  const weekContext = sessions.map((s) => ({ date: moment.utc(ask.startDate, DAY).add(s.day - 1, "days").format(DAY), title: s.title, focus: s.focus, muscleGroups: s.muscleGroups }));
  const designed = await Promise.all(
    sessions.map(async (s) => {
      const date = moment.utc(ask.startDate, DAY).add(s.day - 1, "days").format(DAY);
      const d = await designSession(
        {
          durationMin: s.durationMin || ask.sessionMinutes,
          focus: s.focus,
          muscleGroups: s.muscleGroups,
          place: ask.place ?? (brief.training?.place && brief.training.place !== "mixed" ? (brief.training.place as DesignAsk["place"]) : null),
          request: `${s.title}. ${s.why} ${ask.request ?? ""}`.trim(),
          date,
          weekContext: weekContext.filter((w) => w.date !== date),
        },
        brief,
        { model }
      );
      d.session.title = s.title.slice(0, 80);
      d.session.why = d.session.why ?? s.why;
      return { ...d, day: s.day };
    })
  );
  return { title: skeleton.title.slice(0, 120), notes: skeleton.notes, sessions: designed, fit: { ok: issues.length === 0 && designed.every((d) => d.fit.ok), issues: [...issues, ...designed.flatMap((d) => d.fit.issues.map((i) => `day ${d.day}: ${i}`))] }, model, latencyMs: Date.now() - t0 };
};
