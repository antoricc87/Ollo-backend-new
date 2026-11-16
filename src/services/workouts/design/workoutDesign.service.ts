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
import { route } from "../../agent/llm/policy";
import { ACTIVITY_KEYS, activityByKey } from "../domain/activity.catalog";
import { canonicalExercise, catalogForPlanner, exerciseByKey, muscleGroupsFor, musclesFor, stepDown, type ExerciseDef } from "../domain/exercise.catalog";
import { SUPPORTING_ONLY, type Muscle, type Pattern } from "../domain/exercise.details";
import { fmtSets } from "../domain/workout.metrics";
import { FOCUS, PLACE, PlannedSessionInput, ROLES, type ExerciseInput, type PartItem } from "../domain/workout.schema";
import TrainingProfileService from "../model/training_profile.model";
import WorkoutService from "../model/workouts.model";
import { generalSessionLine, stopLine, treatmentWording, type TrainingGate } from "../../encounter/domain/trainingGate";

const DAY = "YYYY-MM-DD";
export const DEFAULT_SESSION_MIN = 45;
const MAX_REVISIONS = 2;
const REPS_SECONDS = 3; // per rep, for the time estimate
const WARMUP_MIN = 5;
const COOLDOWN_MIN = 3;
const RECENT_DAYS = 28;
const SETUP_SEC = 60; // per exercise: set-up and moving between stations
const RAMP_SETS = 2; // lighter sets before a main lift

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
  /** A check-in on record says to keep this general and lighter (encounter/domain/trainingGate.ts, level "general"). */
  caution?: DesignCaution | null;
  /** Other sessions planned in the same week (when designing a week) so recovery is judged across days. */
  weekContext?: { date: string; title: string; focus: string; muscleGroups: string[] }[];
  /** The session this one CHANGES (editing a week draft): everything the request doesn't touch stays as it is. */
  previous?: { title: string; focus: string; durationMin: number; exercises: { exerciseKey: string; name: string; sets: number; reps: number | null; repsMax: number | null; durationSec: number | null; restSec: number | null; targetKg: number | null }[] } | null;
};

/** What the designer is told about a symptom on record: the person's own facts, never a condition to design for. */
export type DesignCaution = Pick<TrainingGate, "about" | "reasons" | "conditions" | "stopIf">;

/** Under caution no rep set goes below this — heavy low-rep work is what "lighter" rules out. */
export const CAUTION_MIN_REPS = 8;

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

  // The last 4 weeks, completed only — what was trained and when (recovery, continuity, how often). A trainer
  // looks further back than a week (Nov 15 2026); exercises are listed for the last 2 weeks only.
  const from = moment.tz(opts.today, DAY, tz).subtract(RECENT_DAYS, "days").toDate();
  const to = moment.tz(opts.today, DAY, tz).endOf("day").toDate();
  const recentRows = await WorkoutService.list(patientId, { from, to }, { limit: 40 });
  // Planned and not done: what is still coming (a single session fits around it) and what was missed lately.
  const ahead = moment.tz(opts.today, DAY, tz).add(7, "days").format(DAY);
  const back = moment.tz(opts.today, DAY, tz).subtract(14, "days").format(DAY);
  const yesterday = moment.tz(opts.today, DAY, tz).subtract(1, "days").format(DAY);
  const [plannedRows, missedRows] = await Promise.all([WorkoutService.listPlanned(patientId, opts.today, ahead), WorkoutService.listPlanned(patientId, back, yesterday)]);
  const plannedLine = (p: (typeof plannedRows)[number]) => ({ date: p.plannedFor!, title: p.title ?? activityByKey(p.activityKey).label, focus: p.focus ?? null, muscleGroups: p.muscleGroups ?? [] });
  const recent = recentRows.map((s) => ({
    date: moment(s.startedAt).tz(tz).format(DAY),
    daysAgo: moment.tz(opts.today, DAY, tz).diff(moment(s.startedAt).tz(tz).startOf("day"), "days"),
    title: s.title ?? activityByKey(s.activityKey).label,
    activity: s.activityKey,
    shape: activityByKey(s.activityKey).shape,
    focus: s.focus,
    durationMin: Math.round(s.durationSec / 60),
    muscleGroups: s.muscleGroups.length ? s.muscleGroups : Array.from(new Set(s.exercises.map((e) => e.muscleGroup).filter((x): x is string => !!x))),
    exercises: moment.tz(opts.today, DAY, tz).diff(moment(s.startedAt).tz(tz).startOf("day"), "days") <= 14 ? s.exercises.slice(0, 8).map((e) => `${e.name} ${fmtSets(e.sets)}`.trim()) : [],
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
    /** Sessions already planned for the next 7 days (the saved week) — a single session is designed around them. */
    alreadyPlanned: plannedRows.map(plannedLine),
    /** Planned in the last 2 weeks and never done. */
    missed: missedRows.map(plannedLine),
    lastLoads,
    remembered: memories.map((m) => `[${m.category.toLowerCase()}] ${m.content}`),
    recovery: opts.client ? { sleepMinutesLastNight: opts.client.sleepMinutesLastNight ?? null, hrvMs: opts.client.hrvMs ?? null, restingHeartRate: opts.client.restingHeartRate ?? null } : null,
  };
};

/* --------------------------------- schema -------------------------------- */

const EXERCISE_OUT = {
  type: "object",
  properties: {
    role: { type: "string", enum: ROLES, description: "What it does today: main (the day's key lift or work), accessory (supporting), core, conditioning, mobility" },
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
  required: ["role", "exerciseKey", "name", "sets", "reps", "repsMax", "durationSec", "targetKg", "restSec", "loadNote", "alternatives"],
  additionalProperties: false,
} as const;

/** One warm-up or cool-down exercise: a catalog drill/stretch (or easy cardio) and its dose — one round, no sets. */
const PART_OUT = {
  type: "object",
  properties: {
    exerciseKey: { type: ["string", "null"], description: "Catalog key (warm-up drills, cool-down stretches, or cardio for easy minutes); null for a custom one" },
    name: { type: "string" },
    reps: { type: ["integer", "null"], description: "Reps (each side when perSide); null when timed" },
    durationSec: { type: ["integer", "null"], description: "Seconds (each side when perSide): a hold, or easy cardio minutes × 60; null for reps" },
    perSide: { type: "boolean" },
    note: { type: ["string", "null"], description: "A few words when useful ('easy pace', 'slow and controlled'), else null" },
  },
  required: ["exerciseKey", "name", "reps", "durationSec", "perSide", "note"],
  additionalProperties: false,
} as const;
type PartOut = { exerciseKey: string | null; name: string; reps: number | null; durationSec: number | null; perSide: boolean; note: string | null };

const SESSION_OUT = {
  type: "object",
  properties: {
    approach: { type: "string", description: "Written FIRST, before any exercise: your thinking as their trainer — 3–5 short sentences (see the system message)" },
    title: { type: "string", description: "Short: 'Upper body strength', 'Easy run', 'Hotel-room conditioning'" },
    activityKey: { type: "string", enum: ACTIVITY_KEYS },
    focus: { type: "string", enum: FOCUS },
    place: { type: "string", enum: PLACE },
    durationMin: { type: "integer" },
    muscleGroups: { type: "array", items: { type: "string" }, description: "Catalog groups this session trains" },
    why: { type: "string", description: "One line, in second person: how it fits their plan, recovery and what they did recently" },
    warmup: { type: "array", items: PART_OUT, description: "The warm-up, in order: 2–5 exercises" },
    cooldown: { type: "array", items: PART_OUT, description: "The cool-down, in order: 2–4 exercises" },
    distanceKm: { type: ["number", "null"], description: "Endurance sessions only" },
    exercises: { type: "array", items: EXERCISE_OUT },
    notes: { type: ["string", "null"], description: "Anything the user should know (pace, intensity cue, what to skip if short on time)" },
  },
  required: ["approach", "title", "activityKey", "focus", "place", "durationMin", "muscleGroups", "why", "warmup", "cooldown", "distanceKm", "exercises", "notes"],
  additionalProperties: false,
} as const;

type SessionOut = {
  approach: string;
  title: string;
  activityKey: string;
  focus: (typeof FOCUS)[number];
  place: (typeof PLACE)[number];
  durationMin: number;
  muscleGroups: string[];
  why: string;
  warmup: PartOut[];
  cooldown: PartOut[];
  distanceKm: number | null;
  exercises: { role: (typeof ROLES)[number]; exerciseKey: string | null; name: string; sets: number; reps: number | null; repsMax: number | null; durationSec: number | null; targetKg: number | null; restSec: number; loadNote: string | null; alternatives: string[] }[];
  notes: string | null;
};

/**
 * A personal trainer, not a template (Nov 15 2026, user ruling): the designer looks at the whole picture,
 * thinks first (`approach`), and builds the session the way a good trainer would — structure is its call,
 * and the person's own instructions about structure win. Code only catches what no trainer would do
 * (checkSession: a single working set, a supporting exercise at strength reps, no warm-up or cool-down).
 */
const SYSTEM = `You are this person's personal trainer, designing ONE session for them. Look at the whole picture before choosing anything.

First write \`approach\` (3–5 short sentences, plain words): what today is for; how it fits around what comes before and after it (weekContext, alreadyPlanned, recentSessions, missed) and their recovery; what their record, goals, limits and what you remember about them change; then the structure you chose and why. If their words say how they want the session built, that structure wins — say so.

Every session has three parts: warm-up → main workout → cool-down. What goes inside each, and in what order, is your call:
- warm-up (\`warmup\`) for TODAY's work: often a few minutes of easy cardio (a cardio exercise with durationSec, note "easy"), then 2–4 moving drills from the catalog's "warm-up drills" for the joints and muscles of the day, one round each (e.g. leg swings 10 per side). No long held stretches here.
- main workout (\`exercises\`): the day's key lifts or efforts first, while they are fresh, then supporting work, then core where it fits or is asked for (core goes after the heavy lifts unless they say otherwise or it is a core day), an optional short finisher if time and the goal allow. For a heavy first lift, say in its loadNote to ramp up with 2–3 lighter sets.
- cool-down (\`cooldown\`): 2–4 stretches from the catalog's "cool-down stretches" for what was trained, 30–45 s holds (per side when one-sided), optionally a few easy cardio minutes first.
Conditioning, endurance and mobility days have the same three parts with their own main workout (intervals, a run, a mobility flow).
A class or a named workout ("GTX", "bootcamp", "HIIT") is the NAME of the session: design it as exercises of that kind, from what they said it is ("a mix of conditioning and strength"), never as one exercise called the class.

Each exercise has a role, and its dose follows its role and the day's focus — never one rep range for the whole session:
- main: strength 3–6 reps, 2–4 min rest; hypertrophy 6–12 reps, 90–120 s; mixed in between.
- accessory (supporting, incl. every one-joint move, flyes, face pulls, curls, calf raises, leg curls): 8–15 reps, 60–90 s.
- core: 8–15 controlled reps or 20–45 s holds; pick what the day and their needs call for (anti-extension, anti-rotation, side work, flexion), not always the same move.
- conditioning: intervals or timed work, short rests; mobility (a mobility day's main workout): slow, timed holds.
- at least 2 working sets per exercise; an exercise worth doing once is worth 2 sets, otherwise drop it.
Continuity: keep the main lifts consistent with what they have been doing (lastLoads, recentSessions) so progress shows; vary supporting work.

Rules:
- Honour the ask exactly: duration (the whole session, warm-up and rests included), focus, muscle groups, place. Only equipment they have (bodyweight always counts; a gym has everything).
- Pick exercises from the catalog by key; a custom exercise is allowed when nothing fits (exerciseKey null).
- Loads: targetKg ONLY for exercises present in lastLoads, as a small progression on that history (same weight or +2.5 kg / +5 %); everything else gets targetKg null and a loadNote telling them how to pick a weight. Never invent a kilogram.
- Recovery: avoid heavy work on muscle groups trained hard in the last 48 h (or planned hard the next day) unless the ask names them; a short night or low HRV → keep it moderate and say so in why.
- Conditions/medications on record shape intensity conservatively and are stated as the reason in why (e.g. "your record lists hypertension, so no breath-holding maximal lifts") — never advice about the condition itself. If limitations are given, respect them literally and name what you avoided.
- Experience: new → simple machine/bodyweight patterns, more coaching cues; experienced → compound barbell work first.
- Keep it doable: 4–7 exercises for 45 min strength, fewer for shorter; supersets are fine, say so in notes. Warm-up and cool-down about 5 minutes each unless the session is long or they ask.
- Plain language, no medical claims, no supplements. Output ONLY the schema.`;

/**
 * Added when a check-in is on record at level "general". The session is still
 * a training session — what changes is the load and the framing.
 */
const CAUTION_RULES = `
CAUTION — the ask carries \`caution\`: this person has a symptom on record (caution.about) and a clinician has not looked at it. Design a GENERAL, LIGHTER session:
- Gentle whole-body movement, mobility and easy core or conditioning work that any healthy adult could do. No heavy or maximal sets (rep sets of ${CAUTION_MIN_REPS} or more), no jumping or impact, no heavy loading through the area in caution.about, nothing that needs pushing through discomfort. Loads at or below their history, never a progression.
- It is NOT designed for the symptom. Never present an exercise, the title, the why or the notes as helping, relieving, fixing, treating, rehabilitating or "being good for" the symptom, and never name a condition. Title it by what it is ("Mobility and easy core", "Light full body"), not by the body part that hurts.
- why = one line saying it is a lighter, general session because of what they told you (their fact, e.g. "kept light and general while your back pain is unassessed by a clinician"). No advice about the symptom itself.`;

/* --------------------------------- checks -------------------------------- */

/** Added when the ask carries `previous`: the person asked to change one session of a week they already have. */
const CHANGE_RULES = `
CHANGE — the ask carries \`previous\`: the session they already have for this day. ask.request says what to change. Keep every exercise, set, rep, rest and load the request does not touch, in the same order, with the same exerciseKey; add, remove or alter only what it asks for. Keep the title unless the session's purpose changes.
A different LENGTH changes the work, not just the label (a 45 → 30 minute edit once kept every set and said "move briskly"): shorter = first fewer sets on supporting exercises, then drop the least important supporting exercise; keep the main lifts. Longer = more sets or one or two more exercises, not a new session.`;

/** A planned session as the \`previous\` a change request is designed against. */
export const asPrevious = (s: PlannedSessionInput): NonNullable<DesignAsk["previous"]> => ({
  title: s.title ?? "Session",
  focus: s.focus ?? "mixed",
  durationMin: s.durationMin ?? DEFAULT_SESSION_MIN,
  exercises: (s.exercises ?? []).map((e) => ({ exerciseKey: e.exerciseKey, name: e.name, sets: e.sets?.length ?? 0, reps: e.sets?.[0]?.targetReps ?? null, repsMax: e.sets?.[0]?.targetRepsMax ?? null, durationSec: e.sets?.[0]?.durationSec ?? null, restSec: e.sets?.[0]?.restSec ?? null, targetKg: e.sets?.[0]?.targetKg ?? null })),
});

/**
 * Minutes the session really takes. Calibrated Nov 15 2026: six exercises × 3 sets with 1–2.5 min rests came
 * out at 37 min and passed as both "45" and "30" — set-up was 45 s and the warm-up sets before a main lift
 * were not counted. Now: 60 s set-up per exercise, and 2 lighter ramp-up sets before each main lift.
 */
export const estimateMinutes = (s: PlannedSessionInput) => {
  // Warm-up / cool-down: what their exercises take (10 s to move between them), never less than the old allowance.
  const partSec = (items: PartItem[] | undefined) => (items ?? []).reduce((a, x) => a + (x.durationSec ?? (x.reps ?? 10) * REPS_SECONDS) * (x.perSide ? 2 : 1) + 10, 0);
  let sec = Math.max(WARMUP_MIN * 60, partSec(s.warmupItems)) + Math.max(COOLDOWN_MIN * 60, partSec(s.cooldownItems));
  for (const e of s.exercises ?? []) {
    for (const set of e.sets ?? []) sec += set.durationSec ?? (set.targetReps ?? 10) * REPS_SECONDS;
    sec += Math.max(0, (e.sets?.length ?? 1) - 1) * (e.sets?.[0]?.restSec ?? 60) + SETUP_SEC;
    if (e.role === "main" && !e.sets?.[0]?.durationSec) sec += RAMP_SETS * ((e.sets?.[0]?.targetReps ?? 5) * REPS_SECONDS + 60);
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

  // What no trainer would do, whatever structure was chosen (Nov 15 2026). Everything else is the designer's call.
  if ((s.exercises?.length ?? 0) > 0) {
    if (!s.warmupItems?.length && !(s.warmup ?? []).some((w) => w.trim())) issues.push("no warm-up — add one for today's work");
    if (!s.cooldownItems?.length && !(s.cooldown ?? []).some((w) => w.trim())) issues.push("no cool-down — add easy movement and stretches for what was trained");
  }
  for (const e of s.exercises ?? []) {
    const def = exerciseByKey(e.exerciseKey);
    const work = (e.sets ?? []).filter((set) => !set.isWarmup);
    const steady = def?.pattern === "cardio" || def?.category === "mobility" || work.some((set) => (set.durationSec ?? 0) >= 300); // one 20-minute run is one set
    if (work.length === 1 && !steady) issues.push(`${e.name} has a single working set — give it at least 2, or drop it`);
    const supporting = e.role === "accessory" || def?.pattern === "isolation" || SUPPORTING_ONLY.has(e.exerciseKey);
    const low = work.find((set) => set.durationSec == null && set.targetReps != null && set.targetReps < 8);
    // A curl can be the day's main lift on an arm day; a face pull or a fly never trains heavy.
    if (low && (SUPPORTING_ONLY.has(e.exerciseKey) || (supporting && e.role !== "main"))) issues.push(`${e.name} at ${low.targetReps} reps — a supporting exercise works at 8–15 reps`);
  }

  // level: someone new — or a session kept lighter by a check-in — never gets an advanced lift. Stepped down the
  // `easier` chain in code (no redesign, the card says so); with no easier version the reviser picks another.
  if (brief.training?.experience === "new" || ask.caution) {
    for (const e of s.exercises ?? []) {
      const def = exerciseByKey(e.exerciseKey);
      if (def?.level !== "advanced") continue;
      const down = stepDown(def.key, (x) => x.level !== "advanced");
      if (!down) {
        issues.push(`${def.name} is an advanced lift and ${ask.caution ? "this session is kept lighter" : "they are new to training"} — pick a beginner or intermediate exercise for the same job`);
        continue;
      }
      const weighted = (e.sets ?? []).some((set) => set.targetKg != null) || !!e.loadNote;
      assumptions.push(`${def.name} → ${down.name.toLowerCase()}: the simpler version${ask.caution ? " while this is kept lighter" : " while you're new to it"}`);
      Object.assign(e, { exerciseKey: down.key, name: down.name, muscleGroup: down.muscleGroup, equipment: down.equipment, alternatives: [] });
      for (const set of e.sets ?? []) set.targetKg = null; // the history was for the other lift
      e.loadNote = weighted && down.needs.length ? `a weight you could do ${e.sets?.[0]?.targetRepsMax ?? e.sets?.[0]?.targetReps ?? 10} with, leaving 2 reps in reserve` : null;
    }
  }

  // equipment (outside a gym, only what they have; bodyweight always ok). Every piece the exercise needs is checked —
  // a dumbbell bench press at home with dumbbells and no bench misses. The issue names only the missing kit; the app
  // reads "<name> needs <kit>, not available (<place>: <have>)" to put the tag on the row.
  const kit = new Set<string>([...(ask.equipment ?? []), ...(brief.training?.equipment ?? [])]);
  const place = s.place ?? ask.place ?? brief.training?.place ?? null;
  if (place && place !== "gym" && kit.size > 0) {
    const haveLine = ["bodyweight", ...[...kit].filter((x) => x !== "bodyweight")].join(", ");
    for (const e of [...(s.warmupItems ?? []), ...(s.exercises ?? []), ...(s.cooldownItems ?? [])]) {
      const needs = exerciseByKey(e.exerciseKey)?.needs ?? ("equipment" in e && e.equipment && e.equipment !== "bodyweight" ? [e.equipment] : []);
      const missing = needs.filter((k) => !kit.has(k));
      if (missing.length) issues.push(`${e.name} needs ${missing.join(" and ")}, not available (${place}: ${haveLine})`);
    }
  }

  // requested muscle groups covered
  const want = new Set((ask.muscleGroups ?? []).flatMap(muscleGroupsFor));
  const have = new Set((s.exercises ?? []).map((e) => e.muscleGroup).filter(Boolean));
  for (const g of want) if (!have.has(g) && g !== "full_body" && g !== "cardio") issues.push(`asked for ${g}, no exercise targets it`);
  // a single muscle asked for ("biceps", "hamstrings") needs an exercise that MAINLY works it — a group is not enough
  // a stretch loosens a muscle, it does not train it — mobility never counts for coverage or balance
  const defs = (s.exercises ?? []).map((e) => exerciseByKey(e.exerciseKey)).filter((d): d is ExerciseDef => !!d && d.category !== "mobility");
  const works = (ms: Muscle[]) => defs.some((d) => d.primary.some((m) => ms.includes(m)));
  for (const w of ask.muscleGroups ?? []) {
    const ms = musclesFor(w);
    if (ms.length && !works(ms)) issues.push(`asked for ${w}, no exercise mainly works them`);
  }
  // balance, only where the ask names the shape of the session (sets of work, not circuits or mobility)
  if (["strength", "hypertrophy", "mixed"].includes(s.focus ?? "")) {
    const words = new Set((ask.muscleGroups ?? []).map((w) => w.trim().toLowerCase().replace(/[-\s]+/g, "_")));
    const has = (ps: Pattern[]) => defs.some((d) => ps.includes(d.pattern));
    const push = has(["push_horizontal", "push_vertical"]);
    const pull = has(["pull_horizontal", "pull_vertical"]);
    const lower = has(["squat", "lunge", "hinge", "olympic"]);
    if (["full", "full_body", "total_body"].some((w) => words.has(w)) && defs.length >= 4) {
      const missing = [!lower && "lower-body (squat, lunge or hinge)", !push && "push", !pull && "pull"].filter(Boolean);
      if (missing.length) issues.push(`a full-body session with no ${missing.join(", no ")} exercise — add one`);
    }
    if (["upper", "upper_body"].some((w) => words.has(w)) && defs.length >= 3 && (!push || !pull)) issues.push(`an upper-body session with ${push ? "pushing but no pulling" : "pulling but no pushing"} — balance it`);
    if (["lower", "lower_body", "legs", "leg"].some((w) => words.has(w)) && defs.length >= 3) {
      if (!works(["quads"])) issues.push("a lower-body session with nothing that mainly works the quads (a squat or lunge)");
      // squats mainly work the glutes too, so the back of the leg needs a hinge (deadlift, bridge, swing) or a hamstring move
      if (!has(["hinge"]) && !works(["hamstrings"])) issues.push("a lower-body session with nothing for the back of the leg (a hinge such as a deadlift or bridge, or a leg curl)");
    }
  }

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
  // A check-in on record (level "general"): lighter in fact, and never framed as treatment.
  if (ask.caution) {
    for (const e of s.exercises ?? []) {
      const hist = brief.lastLoads[e.exerciseKey];
      for (const set of e.sets ?? []) {
        if (set.targetKg != null && hist?.kg != null && set.targetKg > hist.kg) set.targetKg = hist.kg; // no progression
      }
      const low = (e.sets ?? []).find((set) => set.durationSec == null && set.targetReps != null && set.targetReps < CAUTION_MIN_REPS);
      if (low) issues.push(`${e.name} has sets of ${low.targetReps} — under caution no heavy low-rep work: ${CAUTION_MIN_REPS}+ reps with a lighter load, or a timed hold`);
    }
    if (s.focus === "strength") issues.push(`focus "strength" (heavy, low reps) is not a lighter session — use mobility, conditioning or mixed`);
    const framed = treatmentWording([s.title, s.why, s.notes, ...(s.warmup ?? []), ...(s.cooldown ?? []), ...(s.exercises ?? []).flatMap((e) => [e.name, e.loadNote])], ask.caution);
    if (framed) issues.push(`"${framed}" presents the session as treatment or names a condition — describe it as a general, lighter session and title it by what it is`);
    assumptions.push(generalSessionLine(ask.caution));
    const stop = stopLine(ask.caution);
    if (stop) assumptions.push(stop);
  }
  if (brief.training?.limitations) assumptions.push(`kept your note: "${brief.training.limitations}"`);
  if (!brief.training) assumptions.push("no training profile yet — assumed a normal gym");
  return { issues, assumptions };
};

/* --------------------------------- design -------------------------------- */

/** A model's text cut to the column's limit at a word, never rejected: one long load note used to throw away the whole session. */
const fit = (text: string | null | undefined, max: number) => {
  if (text == null) return text ?? null;
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(" ") > max * 0.6 ? cut.lastIndexOf(" ") : cut.length).trimEnd()}…`;
};

/** "Leg swings, 10 each side" · "Hamstring stretch, 30 s each side" · "Bike, 5 min easy" — the line the app shows. */
export const partLine = (x: PartItem) => {
  const t = x.durationSec ?? null;
  const dose = t != null ? (t >= 60 && t % 60 === 0 ? `${t / 60} min` : `${t} s`) : x.reps != null ? `${x.reps}${x.perSide ? "" : " reps"}` : "";
  return [x.name, [dose && `${dose}${x.perSide ? " each side" : ""}`, x.note].filter(Boolean).join(" ")].filter(Boolean).join(", ");
};

const toPart = (x: PartOut): PartItem => {
  const c = canonicalExercise(x.name, x.exerciseKey);
  return {
    exerciseKey: c.key,
    name: c.def ? c.name : fit(x.name, 80)!,
    reps: x.durationSec ? null : x.reps != null ? Math.max(1, Math.min(100, x.reps)) : null,
    durationSec: x.durationSec ? Math.max(5, Math.min(3600, x.durationSec)) : null,
    perSide: !!x.perSide,
    note: fit(x.note, 80),
  };
};

const toPlanned = (out: SessionOut, ask: DesignAsk): PlannedSessionInput => {
  const warmupItems = (out.warmup ?? []).slice(0, 8).map(toPart);
  const cooldownItems = (out.cooldown ?? []).slice(0, 8).map(toPart);
  const exercises: ExerciseInput[] = out.exercises.map((e) => {
    const c = canonicalExercise(e.name, e.exerciseKey);
    const n = Math.max(1, Math.min(10, e.sets || 1));
    return {
      exerciseKey: c.key,
      name: c.def ? c.name : fit(e.name, 80)!,
      muscleGroup: c.def?.muscleGroup ?? null,
      equipment: c.def?.equipment ?? null,
      loadNote: fit(e.loadNote, 160),
      alternatives: (e.alternatives ?? []).filter((k) => canonicalExercise(k, k).def).slice(0, 2),
      role: (ROLES as readonly string[]).includes(e.role) ? e.role : null,
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
    muscleGroups: Array.from(new Set(out.muscleGroups.flatMap(muscleGroupsFor).concat(exercises.map((e) => e.muscleGroup!).filter((g) => g && g !== "mobility")))).slice(0, 8),
    why: out.why?.slice(0, 300) ?? null,
    warmup: warmupItems.map((x) => fit(partLine(x), 160)!),
    cooldown: cooldownItems.map((x) => fit(partLine(x), 160)!),
    warmupItems,
    cooldownItems,
    notes: fit(out.notes, 1000),
    distanceKm: out.distanceKm,
    exercises,
  });
};

/** `approach` = the trainer's thinking behind the session (not saved; the reply may use it). */
export type DesignedSession = { session: PlannedSessionInput; approach: string; fit: { ok: boolean; issues: string[]; revised: boolean }; assumptions: string[]; model: string; latencyMs: number };

export const designSession = async (ask: DesignAsk, brief: DesignBrief, opts: { model?: string } = {}): Promise<DesignedSession> => {
  const llm = getLLM();
  // Which model: llm/policy.ts task "design" (opts.model only when an eval compares models).
  const model = opts.model ?? route("design").model;
  const t0 = Date.now();
  // The LAST revision carries the session's own check: if it still breaks a rule, the shared client
  // escalates that one call (policy). A time estimate a few minutes off is not worth it.
  const lastCheck = (out: SessionOut): true | string => {
    const serious = checkSession(toPlanned(out, ask), ask, brief).issues.filter((i) => !/^estimated \d+ min/.test(i));
    return serious.length ? serious.join("; ") : true;
  };
  const generate = (revision?: { previous: SessionOut; issues: string[] }, last = false) =>
    llm.json<SessionOut>({
      task: "design",
      ...(opts.model ? { model: opts.model } : {}),
      ...(last ? { accept: lastCheck } : {}),
      system: SYSTEM + (ask.caution ? CAUTION_RULES : "") + (ask.previous ? CHANGE_RULES : "") + (revision ? "\nYou are REVISING a session that missed its checks: fix every listed issue, keep what was fine." : ""),
      user: JSON.stringify({
        ask: { ...ask, dayName: moment.utc(ask.date, DAY).format("dddd") },
        person: brief.person,
        training: brief.training,
        plan: brief.plan,
        recentSessions: brief.recent,
        // Inside a week the other days come as ask.weekContext; on its own, the saved week is what it fits around.
        ...(ask.weekContext ? {} : { alreadyPlanned: brief.alreadyPlanned.filter((p) => p.date !== ask.date) }),
        missed: brief.missed,
        lastLoads: brief.lastLoads,
        remembered: brief.remembered,
        recovery: brief.recovery,
        catalog: catalogForPlanner(),
        ...(revision ? { previous: revision.previous, issues: revision.issues } : {}),
      }),
      schema: SESSION_OUT,
      schemaName: "workout_session_design",
    });
  let out = await generate();
  let session = toPlanned(out, ask);
  let check = checkSession(session, ask, brief);
  let revised = false;
  for (let i = 0; i < MAX_REVISIONS && check.issues.length; i++) {
    const again = await generate({ previous: out, issues: check.issues }, i === MAX_REVISIONS - 1);
    const s2 = toPlanned(again, ask);
    const c2 = checkSession(s2, ask, brief);
    if (c2.issues.length <= check.issues.length) {
      out = again;
      session = s2;
      check = c2;
      revised = true;
    }
  }
  return { session, approach: out.approach ?? "", fit: { ok: check.issues.length === 0, issues: check.issues, revised }, assumptions: check.assumptions, model, latencyMs: Date.now() - t0 };
};

/* ---------------------------------- week --------------------------------- */

export type WeekAsk = {
  startDate: string;
  days: number;
  sessionsPerWeek: number;
  sessionMinutes: number;
  /** They SAID the length: every session is that long. Otherwise the layout may make a lighter day shorter. */
  minutesFixed?: boolean;
  /** Their own messages, verbatim, newest last — what the week is designed from. `request` is the assistant's summary. */
  words?: string[];
  /** One question may come back instead of a week (false on proactive runs and once one was asked in the thread). */
  mayAsk?: boolean;
  focus?: (typeof FOCUS)[number] | null;
  place?: (typeof PLACE)[number] | null;
  request?: string | null;
  /** Same as DesignAsk.caution — applied to the layout and to every session in it. */
  caution?: DesignCaution | null;
};

type WeekOut = { reading?: WeekReading; title: string; notes: string; keepDay: number; sessions: { day: number; title: string; activityKey: string; focus: (typeof FOCUS)[number]; durationMin: number; muscleGroups: string[]; why: string; mustRespect?: string; startTime?: string | null }[] };

/**
 * UNDERSTAND FIRST, THEN LAY OUT (Oct 19 2026, user ruling). The layout used to
 * open with a split recipe and get the request as one JSON field among many —
 * "I played soccer today… lower body toward the end of the week" came back as
 * a template week. Nothing here encodes any routine or sport: the model reads
 * the person's words, writes what they imply for THIS week (`reading`), may ask
 * ONE question when the words honestly read two ways, and lays the week out to
 * honour every point; `reviewWeek` then checks the result against those points.
 */
const WEEK_SYSTEM = `You are an experienced coach laying out ONE training week for one specific person. Work from THEIR WORDS: ask.words are their own messages, newest last (ask.request is an assistant's summary and may have lost detail; their words win).

First write \`reading\` — think it through before any day is placed:
- purpose: one line, what this week is for, in their terms.
- said: each thing their words or their record tell you about their body, what they did recently, and their schedule — each followed by what it means for THIS week, day by day where it matters (what needs time to recover and roughly how long, which days are fresher, what is fixed). Reason it out like a coach would; there is no rule table.
- wishes: every wish THEY expressed, as a short checkable point — what, which days or which part of the week, how often, how long, and anything they want in EVERY session. Only what they asked: your own advice and what their record implies belong in \`said\`, not here. A session length is a wish only when ask.minutesFixed is true (they said it); otherwise sessionMinutes is a default — never a wish.
- openQuestion: null, unless their words can honestly be read in two ways that would give clearly different weeks and nothing in their words, the conversation or the record settles it — then ONE short, plain question that settles it. Never ask about length, place, equipment, days or how many sessions (those come in the ask). When ask.mayAsk is false it is always null: take the more careful reading and say it in purpose.

Then lay out the week so every point of the reading is honoured:
- Exactly sessionsPerWeek sessions across the days (day 1 = startDate; the dayNames list maps day → weekday). Use the days they named, else preferredDays, else spread with rest between hard days.
- Only when their words leave the split open: a sensible split for the count and experience (2 → full body ×2; 3 → full body ×3 or push/pull/legs; 4 → upper/lower ×2; 5–6 → push/pull/legs + conditioning).
- Never the same heavy muscle groups on consecutive days. Respect recentSessions and what they said they did — day 1 may follow something hard.
- Session titles are SHORT and in sentence case ("Upper body and core", "Lower back recovery"), never Title Case; put the emphasis in muscleGroups.
- why = one line per session, second person, saying which point(s) of the reading this day carries.
- mustRespect = what THIS day's designer has to respect, from the reading: where they are and what equipment exists that day, how hard it may be and why (what comes before and after it), what to leave out. Another coach designs the exercises from this line alone, so be concrete. Empty string when nothing is special.
- A class or named workout they mention ("GTX", "spin", "bootcamp") is the name of that day's session: keep the name in the title and lay it out as a session of the kind they described — it gets exercises like any other day.
- startTime: HH:mm when their words give a time of day for that session ("early morning" → 06:30, "after work" → 18:00, a clock time as said), else null.
- Respect limitations, equipment and place.
- Output ONLY the schema.`;

const WEEK_CAUTION_RULES = `
CAUTION — the ask carries \`caution\`: this person has a symptom on record (caution.about) and a clinician has not looked at it. Lay out a LIGHTER week: keep the session count, but no "strength" focus days (use mixed, conditioning, mobility or endurance), and make at least one day a general mobility session. Titles say what the day is ("Mobility and easy core", "Light full body"), never the body part that hurts, a condition, or words like rehab, relief or treatment. notes = one line that the week is kept lighter and general because of what they reported, one line on a missed day. Nothing about the symptom itself.`;

const WEEK_OUT = {
  type: "object",
  properties: {
    reading: {
      type: "object",
      properties: {
        purpose: { type: "string" },
        said: { type: "array", items: { type: "string" } },
        wishes: { type: "array", items: { type: "string" } },
        openQuestion: { type: ["string", "null"] },
      },
      required: ["purpose", "said", "wishes", "openQuestion"],
      additionalProperties: false,
    },
    title: { type: "string", description: "e.g. 'Upper / lower week', 'Three full-body sessions'" },
    notes: { type: "string", description: "2 short lines about the week: what it builds, what to do if a day is missed" },
    keepDay: { type: "integer", description: "The one day to keep if they can only do one — the card tags it. The session that does most for what the week is for; never a class or fixed appointment they will attend anyway" },
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
          mustRespect: { type: "string" },
          startTime: { type: ["string", "null"], description: "HH:mm when their words give a time of day for it, else null" },
        },
        required: ["day", "title", "activityKey", "focus", "durationMin", "muscleGroups", "why", "mustRespect", "startTime"],
        additionalProperties: false,
      },
    },
  },
  required: ["reading", "title", "notes", "keepDay", "sessions"],
  additionalProperties: false,
} as const;

export type WeekReading = { purpose: string; said: string[]; wishes: string[]; openQuestion: string | null };

/* -------------------- the week against their own words ------------------- */

const REVIEW_SYSTEM = `You check a designed training week against what the person asked for. You get their own words, the coach's reading of them (wishes), and the week as designed (each day with its exercises).
For EACH wish, and for anything else THEIR WORDS clearly ask that the wishes missed, say whether the week honours it. Be literal and fair: judge only what they asked — never your own advice, a note about their record, or anything they did not say (no "keep it adaptable to their equipment" unless they asked). A wish that is honoured needs no fix.
A class or named workout ("GTX", "bootcamp") is the NAME of a session: a session with that title, made of exercises of the kind they described, honours it — never ask for it to be "a class" instead.
Judge a length only when lengthSaid is true (otherwise the minutes are a default, not something they asked); a length wish is judged on estimatedMinutes (what the sets really take, within about 5 minutes), not on the minutes label; a time-of-day wish on startTime.
For one that is not: days = the day numbers that must change (only days that have a session), fix = one short instruction for redesigning those days (what to add, remove or change), written so a coach can apply it to that one session.`;

const REVIEW_OUT = {
  type: "object",
  properties: {
    checks: {
      type: "array",
      items: {
        type: "object",
        properties: { wish: { type: "string" }, met: { type: "boolean" }, days: { type: "array", items: { type: "integer" } }, fix: { type: ["string", "null"] } },
        required: ["wish", "met", "days", "fix"],
        additionalProperties: false,
      },
    },
  },
  required: ["checks"],
  additionalProperties: false,
} as const;

export type WeekCheck = { wish: string; met: boolean; days: number[]; fix: string | null };

/** Which designed days miss a wish, and how to fix them. Model judgement, applied once. */
export const reviewWeek = async (
  input: { words: string[]; request: string | null; reading: WeekReading; sessions: { day: number; session: PlannedSessionInput }[]; dayNames: string[]; lengthSaid?: boolean },
  opts: { model?: string } = {}
): Promise<WeekCheck[]> => {
  const week = input.sessions.map((x) => ({
    day: x.day,
    on: input.dayNames[x.day - 1],
    title: x.session.title,
    focus: x.session.focus,
    minutes: x.session.durationMin,
    // What the work really takes — a label of 30 over 45 minutes of sets is not 30 minutes.
    estimatedMinutes: estimateMinutes(x.session),
    startTime: x.session.startTime ?? null,
    warmup: x.session.warmup,
    exercises: (x.session.exercises ?? []).map((e) => `${e.name} ${(e.sets ?? []).length}×${e.sets?.[0]?.targetReps ?? (e.sets?.[0]?.durationSec ? `${e.sets[0].durationSec}s` : "")}${e.loadNote ? ` (${e.loadNote})` : ""}`),
    cooldown: x.session.cooldown,
  }));
  const out = await getLLM().json<{ checks: WeekCheck[] }>({
    task: "review",
    ...(opts.model ? { model: opts.model } : {}),
    system: REVIEW_SYSTEM,
    user: JSON.stringify({ theirWords: input.words.length ? input.words : [input.request ?? ""], wishes: input.reading.wishes, said: input.reading.said, lengthSaid: !!input.lengthSaid, week }),
    schema: REVIEW_OUT,
    schemaName: "workout_week_review",
  });
  const days = new Set(input.sessions.map((x) => x.day));
  return (out.checks ?? []).map((c) => ({ ...c, days: (c.days ?? []).filter((d) => days.has(d)) }));
};

/**
 * What a week must hold whatever produced it — the layout model or an edit to
 * a draft (weekEdit.ts): no two consecutive heavy days on the same muscles,
 * and under caution no strength day and at least one mobility day.
 */
export const weekShapeIssues = (sessions: { day: number; focus?: string | null; muscleGroups?: string[] | null }[], caution: boolean): string[] => {
  const issues: string[] = [];
  const sorted = [...sessions].sort((x, y) => x.day - y.day);
  const heavyFocus = (f?: string | null) => ["strength", "hypertrophy"].includes(f ?? "");
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1], b = sorted[i];
    if (b.day - a.day === 1 && heavyFocus(a.focus) && heavyFocus(b.focus)) {
      const overlap = (a.muscleGroups ?? []).flatMap(muscleGroupsFor).filter((g) => (b.muscleGroups ?? []).flatMap(muscleGroupsFor).includes(g) && g !== "core");
      if (overlap.length) issues.push(`day ${a.day} and day ${b.day} both load ${Array.from(new Set(overlap)).join(", ")} on consecutive days`);
    }
  }
  if (caution) {
    const heavy = sorted.filter((x) => x.focus === "strength");
    if (heavy.length) issues.push(`day ${heavy.map((x) => x.day).join(", ")} has focus "strength" — under caution use mixed, conditioning, mobility or endurance`);
    if (!sorted.some((x) => x.focus === "mobility")) issues.push("under caution at least one day is a general mobility session");
  }
  return issues;
};

export type DesignedWeek = {
  title: string;
  notes: string;
  keepDay: number | null;
  sessions: (DesignedSession & { day: number })[];
  fit: { ok: boolean; issues: string[] };
  model: string;
  latencyMs: number;
  /** How the request was read — the reply opens with it. */
  reading: WeekReading;
  /** Set instead of a week when the request reads two ways: ask it, design nothing. */
  question: string | null;
};

export const designWeek = async (ask: WeekAsk, brief: DesignBrief, opts: { model?: string } = {}): Promise<DesignedWeek> => {
  const llm = getLLM();
  // The layout is task "plan"; each session is "design" (llm/policy.ts).
  const model = opts.model ?? route("design").model;
  // Reported only: the reading and layout run as task "plan" (the review as "review").
  const planModel = opts.model ?? route("plan").model;
  const t0 = Date.now();
  const dayNames = Array.from({ length: ask.days }, (_, i) => `${i + 1}: ${moment.utc(ask.startDate, DAY).add(i, "days").format("ddd D MMM")}`);
  const layout = (revision?: { previous: WeekOut; issues: string[] }, last = false) =>
    llm.json<WeekOut>({
      task: "plan",
      ...(opts.model ? { model: opts.model } : {}),
      ...(last ? { accept: (o: WeekOut) => (checkLayout(o).issues.length ? checkLayout(o).issues.join("; ") : true) } : {}),
      system: WEEK_SYSTEM + (ask.caution ? WEEK_CAUTION_RULES : "") + (revision ? "\nYou are REVISING a layout that missed its checks: fix every listed issue (exact session count, one session per day, no consecutive heavy days), keep what was fine." : ""),
      user: JSON.stringify({ ask: { ...ask, words: ask.words ?? [], mayAsk: !!ask.mayAsk && !revision, dayNames }, today: brief.today, person: brief.person, training: brief.training, plan: brief.plan, recentSessions: brief.recent, remembered: brief.remembered, ...(revision ? { previous: revision.previous, issues: revision.issues } : {}) }),
      schema: WEEK_OUT,
      schemaName: "workout_week_design",
    });
  const checkLayout = (out: WeekOut) => {
    const issues: string[] = [];
    let sessions = out.sessions.filter((s) => s.day >= 1 && s.day <= ask.days).sort((a, b) => a.day - b.day);
    const dupes = sessions.length - new Set(sessions.map((s) => s.day)).size;
    sessions = sessions.filter((s, i) => sessions.findIndex((x) => x.day === s.day) === i); // one per day
    if (dupes) issues.push(`${dupes} day(s) had two sessions — one session per day`);
    if (sessions.length !== ask.sessionsPerWeek) issues.push(`${sessions.length} sessions laid out, exactly ${ask.sessionsPerWeek} asked (days available: 1–${ask.days})`);
    issues.push(...weekShapeIssues(sessions, !!ask.caution));
    if (ask.caution) {
      const framed = treatmentWording([out.title, out.notes, ...sessions.flatMap((x) => [x.title, x.why])], ask.caution);
      if (framed) issues.push(`"${framed}" presents the week as treatment or names a condition — title days by what they are and keep it general`);
    }
    return { sessions, issues };
  };
  let skeleton = await layout();
  const reading: WeekReading = skeleton.reading ?? { purpose: "", said: [], wishes: [], openQuestion: null };
  // One question instead of a week: nothing is designed until it is answered.
  if (ask.mayAsk && reading.openQuestion?.trim())
    return { title: skeleton.title, notes: "", keepDay: null, sessions: [], fit: { ok: false, issues: [] }, model: planModel, latencyMs: Date.now() - t0, reading, question: reading.openQuestion.trim() };
  let { sessions, issues } = checkLayout(skeleton);
  for (let i = 0; i < MAX_REVISIONS && issues.length; i++) {
    const again = await layout({ previous: skeleton, issues }, i === MAX_REVISIONS - 1);
    const c = checkLayout(again);
    if (c.issues.length <= issues.length) {
      skeleton = { ...again, reading: skeleton.reading };
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
          durationMin: ask.minutesFixed ? ask.sessionMinutes : s.durationMin || ask.sessionMinutes,
          focus: s.focus,
          muscleGroups: s.muscleGroups,
          place: ask.place ?? (brief.training?.place && brief.training.place !== "mixed" ? (brief.training.place as DesignAsk["place"]) : null),
          request: sessionRequest(s, reading, ask),
          date,
          weekContext: weekContext.filter((w) => w.date !== date),
          caution: ask.caution ?? null,
        },
        brief,
        { model }
      );
      d.session.title = s.title.slice(0, 80);
      d.session.why = d.session.why ?? s.why;
      if (s.startTime && /^\d{2}:\d{2}$/.test(s.startTime)) d.session.startTime = s.startTime;
      return { ...d, day: s.day };
    })
  );

  // The week against their words: a missed wish redesigns only the days it names, once.
  let unmet: string[] = [];
  if (reading.wishes.length) {
    const review = (list: typeof designed) => reviewWeek({ words: ask.words ?? [], request: ask.request ?? null, reading, sessions: list.map((d) => ({ day: d.day, session: d.session })), dayNames, lengthSaid: !!ask.minutesFixed }, opts.model ? { model: opts.model } : {}).catch((e) => {
      console.error("[workouts] week review failed", e?.message ?? e);
      return [] as WeekCheck[];
    });
    const misses = (await review(designed)).filter((c) => !c.met);
    const fixes = new Map<number, string[]>();
    for (const c of misses) for (const d of c.days) if (c.fix) fixes.set(d, [...(fixes.get(d) ?? []), c.fix]);
    if (fixes.size) {
      await Promise.all(
        [...fixes].map(async ([day, fix]) => {
          const i = designed.findIndex((d) => d.day === day);
          const was = designed[i];
          const s = sessions.find((x) => x.day === day)!;
          const again = await designSession(
            {
              durationMin: was.session.durationMin ?? ask.sessionMinutes,
              focus: was.session.focus as DesignAsk["focus"],
              muscleGroups: was.session.muscleGroups ?? [],
              place: (was.session.place as DesignAsk["place"]) ?? null,
              request: `${fix.join(" ")} ${sessionRequest(s, reading, ask)}`,
              date: was.session.plannedFor!,
              weekContext: weekContext.filter((w) => w.date !== was.session.plannedFor),
              caution: ask.caution ?? null,
              previous: asPrevious(was.session),
            },
            brief,
            { model }
          );
          again.session.title = was.session.title;
          again.session.startTime = was.session.startTime ?? null;
          designed[i] = { ...again, day };
        })
      );
      unmet = (await review(designed)).filter((c) => !c.met).map((c) => c.wish);
    } else unmet = misses.map((c) => c.wish);
  }

  return {
    title: skeleton.title.slice(0, 120),
    notes: skeleton.notes,
    keepDay: sessions.some((x) => x.day === skeleton.keepDay) ? skeleton.keepDay : null,
    sessions: designed,
    fit: { ok: issues.length === 0 && unmet.length === 0 && designed.every((d) => d.fit.ok), issues: [...issues, ...unmet.map((w) => `not yet in the week: ${w}`), ...designed.flatMap((d) => d.fit.issues.map((i) => `day ${d.day}: ${i}`))] },
    model: planModel === model ? model : `${planModel} + ${model}`,
    latencyMs: Date.now() - t0,
    reading,
    question: null,
  };
};

/** What one day's designer is told: its role in the week, what the week is for, and their own words. */
const sessionRequest = (s: { title: string; why: string; mustRespect?: string }, reading: WeekReading, ask: WeekAsk) =>
  [
    s.mustRespect?.trim() ? `THIS DAY MUST RESPECT: ${s.mustRespect.trim()}` : null,
    `${s.title}. ${s.why}`,
    reading.purpose ? `The week is for: ${reading.purpose}.` : null,
    reading.wishes.length ? `Their wishes for the week: ${reading.wishes.join("; ")}.` : null,
    ask.words?.length ? `Their words: "${ask.words.join(" / ").slice(0, 1200)}"` : ask.request ?? null,
  ]
    .filter(Boolean)
    .join(" ");
