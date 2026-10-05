import { z } from "zod";
import moment from "moment-timezone";
import { randomUUID } from "crypto";
import prisma from "../../../utility/prismaClient";
import { dayString, defineTool, shiftDay, subjectField } from "./registry";
import type { Card } from "./registry";
import WorkoutService from "../../workouts/model/workouts.model";
import WorkoutPlanService, { fmtTargets, type WorkoutPlanView } from "../../workouts/model/plan.model";
import TrainingProfileService from "../../workouts/model/training_profile.model";
import { activityByKey } from "../../workouts/domain/activity.catalog";
import { fmtDuration, fmtSets } from "../../workouts/domain/workout.metrics";
import { EQUIPMENT, EXPERIENCE, FOCUS, PLACE, PlannedSessionInput, WEEKDAYS, WorkoutPlanInput, timeString } from "../../workouts/domain/workout.schema";
import { asPrevious, buildBrief, DEFAULT_SESSION_MIN, designSession, designWeek, weekShapeIssues } from "../../workouts/design/workoutDesign.service";
import { applyWeekEdits, dateOfDay, WeekEditError, type WeekEdit, type WeekSession } from "../../workouts/design/weekEdit";
import encounterService from "../../encounter/model/encounter.model";
import { generalSessionLine, stopLine, type TrainingGate } from "../../encounter/domain/trainingGate";

/**
 * Designing training in the agent — on the SAME workouts domain that logs it.
 *  - generate_workout / generate_workout_plan: drafts (nothing persisted); the
 *    card carries a draftId and the exact PlannedSessionInput rows the server
 *    would save, so the app's "Put in plan" / "Save this week" buttons and the
 *    save_workout_plan proposal all write through WorkoutService.
 *  - edit_workout_plan: a change to the week draft on the table (move / add /
 *    remove / change one session) — design/weekEdit.ts; sessions the request
 *    doesn't name come back exactly as they were. A new card, a new draftId.
 *  - save_workout_plan: confirm-gated write → WorkoutPlanService.create.
 *  - update_training_profile: confirm-gated write → TrainingProfile.
 *  Reading planned sessions is get_workouts with status (workout.tools.ts).
 */

/* ------------------------------- drafts -------------------------------- */

type WeekDraft = { plan: WorkoutPlanInput; card: unknown; at: number };
type SessionDraft = { session: PlannedSessionInput; card: unknown; at: number };
const weekDrafts = new Map<string, WeekDraft>();
const sessionDrafts = new Map<string, SessionDraft>();
const DRAFT_TTL_MS = 6 * 60 * 60 * 1000;

const evict = <T extends { at: number }>(m: Map<string, T>) => {
  for (const [k, v] of m) if (Date.now() - v.at > DRAFT_TTL_MS) m.delete(k);
};
export const registerWeekDraft = (draftId: string, plan: WorkoutPlanInput, card: unknown) => {
  evict(weekDrafts);
  weekDrafts.set(draftId, { plan, card, at: Date.now() });
};
export const registerSessionDraft = (draftId: string, session: PlannedSessionInput, card: unknown) => {
  evict(sessionDrafts);
  sessionDrafts.set(draftId, { session, card, at: Date.now() });
};
/** A parked single-session draft (for log_workout draftId / put-in-plan). */
export const sessionDraft = (draftId: string) => sessionDrafts.get(draftId)?.session ?? null;

/** A generated workout_plan card → save body (the card carries the server-shaped sessions). */
export const weekInputFromCard = (data: any): WorkoutPlanInput =>
  WorkoutPlanInput.parse({
    title: data?.title,
    notes: data?.notes ?? null,
    startDate: data?.startDate ?? null,
    days: data?.days,
    brief: data?.brief ?? null,
    fit: data?.fit ?? null,
    source: "ollie",
    sessions: (data?.sessions ?? []).map((s: any) => ({ ...s.session, plannedFor: undefined, day: s.day })),
  });

const findWeekDraft = async (threadId: string | null, draftId?: string | null): Promise<{ draftId: string; plan: WorkoutPlanInput } | null> => {
  if (draftId && weekDrafts.has(draftId)) return { draftId, plan: weekDrafts.get(draftId)!.plan };
  if (!draftId) {
    const newest = [...weekDrafts.entries()].sort((a, b) => b[1].at - a[1].at)[0];
    if (newest && Date.now() - newest[1].at < 30 * 60 * 1000 && !threadId) return { draftId: newest[0], plan: newest[1].plan };
  }
  if (!threadId) return null;
  const rows = await prisma.agentMessage.findMany({ where: { threadId, role: "ASSISTANT" }, orderBy: { seq: "desc" }, take: 40, select: { cards: true } });
  for (const r of rows) {
    const cards = Array.isArray(r.cards) ? (r.cards as any[]) : [];
    for (const c of [...cards].reverse()) {
      if (c?.type !== "workout_plan" || c?.data?.saved) continue;
      if (draftId && c?.data?.draftId !== draftId) continue;
      try {
        return { draftId: c.data?.draftId ?? "card", plan: weekInputFromCard(c.data) };
      } catch {
        /* malformed card — keep looking */
      }
    }
  }
  return null;
};

/** The latest unsaved week card of this conversation, whole (edit_workout_plan builds the next draft from it). */
const findWeekCard = async (threadId: string | null, draftId?: string | null): Promise<any | null> => {
  if (draftId && weekDrafts.has(draftId)) return weekDrafts.get(draftId)!.card;
  if (threadId) {
    const rows = await prisma.agentMessage.findMany({ where: { threadId, role: "ASSISTANT" }, orderBy: { seq: "desc" }, take: 40, select: { cards: true } });
    for (const r of rows) {
      const cards = Array.isArray(r.cards) ? (r.cards as any[]) : [];
      for (const c of [...cards].reverse()) {
        if (c?.type !== "workout_plan" || c?.data?.saved || !c?.data?.sessions?.length) continue;
        if (draftId && c.data.draftId !== draftId) continue;
        return c.data;
      }
    }
    return null;
  }
  // No thread (scripts): the newest draft still in memory.
  const newest = [...weekDrafts.entries()].sort((x, y) => y[1].at - x[1].at)[0];
  return !draftId && newest && Date.now() - newest[1].at < 30 * 60 * 1000 ? newest[1].card : null;
};

/* ------------------------------ card shapes ------------------------------ */

/** Rows the card renders for a planned session (targets, not actuals). */
export const sessionDisplay = (s: PlannedSessionInput) => ({
  title: s.title,
  activityLabel: activityByKey(s.activityKey).label,
  focus: s.focus,
  place: s.place ?? null,
  durationLabel: fmtDuration((s.durationMin ?? DEFAULT_SESSION_MIN) * 60),
  muscleGroups: s.muscleGroups ?? [],
  why: s.why ?? null,
  warmup: s.warmup ?? [],
  cooldown: s.cooldown ?? [],
  notes: s.notes ?? null,
  distanceKm: s.distanceKm ?? null,
  exercises: (s.exercises ?? []).map((e) => ({
    name: e.name,
    exerciseKey: e.exerciseKey,
    muscleGroup: e.muscleGroup ?? null,
    equipment: e.equipment ?? null,
    prescription: fmtTargets(e.sets as any),
    restSec: e.sets?.[0]?.restSec ?? null,
    loadNote: e.loadNote ?? null,
    alternatives: e.alternatives ?? [],
    sets: e.sets,
  })),
});

const sessionLine = (s: PlannedSessionInput) => `${s.title} — ${s.focus}, ${s.durationMin} min${s.place ? `, ${s.place}` : ""}: ${(s.exercises ?? []).map((e) => `${e.name} ${fmtTargets(e.sets as any)}`.trim()).join("; ") || activityByKey(s.activityKey).label}`;

/** The saved week as the same `workout_plan` card the generator emits, plus `saved`. */
export const savedWeekCard = (v: WorkoutPlanView, tz: string): Card => ({
  type: "workout_plan",
  title: v.title,
  data: {
    title: v.title,
    notes: v.notes,
    startDate: v.startDate,
    days: v.days,
    brief: v.brief,
    fit: v.fit,
    saved: { id: v.id, startDate: v.startDate, endDate: v.endDate, todayIndex: v.todayIndex, status: v.status, planned: v.planned, done: v.done },
    sessions: v.daysOut
      .filter((d) => d.planned)
      .map((d) => {
        const s = d.planned!;
        const input: PlannedSessionInput = {
          activityKey: s.activityKey as any,
          title: s.title ?? activityByKey(s.activityKey).label,
          plannedFor: d.date,
          durationMin: Math.round(s.durationSec / 60),
          focus: (s.focus ?? "mixed") as any,
          place: (s.place ?? null) as any,
          muscleGroups: s.muscleGroups,
          why: s.why,
          warmup: s.warmup,
          cooldown: s.cooldown,
          notes: s.notes,
          distanceKm: s.distanceKm,
          exercises: s.exercises.map((e) => ({ exerciseKey: e.exerciseKey, name: e.name, muscleGroup: e.muscleGroup, equipment: e.equipment, notes: e.notes, loadNote: e.loadNote, alternatives: e.alternatives, sets: e.sets.map((x) => ({ reps: x.reps, weightKg: x.weightKg, durationSec: x.durationSec, distanceM: x.distanceM, rpe: x.rpe, toFailure: x.toFailure, isWarmup: x.isWarmup, targetReps: x.targetReps, targetRepsMax: x.targetRepsMax, targetKg: x.targetKg, restSec: x.restSec })) })),
        };
        return { day: d.day, date: d.date, sessionId: s.id, state: d.state, session: input, display: sessionDisplay(input), done: s.status === "COMPLETED" ? { calories: s.calories, avgHr: s.avgHr, durationMin: Math.round(s.durationSec / 60), exercises: s.exercises.map((e) => `${e.name} ${fmtSets(e.sets)}`.trim()) } : null };
      }),
    rest: v.daysOut.filter((d) => !d.planned).map((d) => ({ day: d.day, date: d.date, other: d.other.map((o) => o.title ?? activityByKey(o.activityKey).label) })),
    timeZone: tz,
  },
});

/* -------------------------------- helpers -------------------------------- */

const askDefaults = async (patientId: string, input: { durationMin?: number; place?: any; equipment?: string[] }) => {
  const profile = await TrainingProfileService.get(patientId);
  const durationMin = input.durationMin ?? profile?.sessionMinutes ?? DEFAULT_SESSION_MIN;
  const place = input.place ?? (profile?.place && profile.place !== "mixed" ? (profile.place as (typeof PLACE)[number]) : null);
  const needsPlace = !profile && !input.place && !(input.equipment?.length);
  return { profile, durationMin, place, needsPlace };
};

/**
 * A check-in on record decides what may be designed (encounter/domain/
 * trainingGate.ts). Both design tools read it here, at call time — the
 * interview may have been assessed earlier in this same turn.
 */
const heldResult = (gate: TrainingGate) => ({
  result: {
    held: true,
    about: gate.about,
    reasons: gate.reasons,
    note: gate.pending
      ? `No session is designed while the check-in about their ${gate.about.toLowerCase()} is unfinished. Say so in one line and carry on with it (or offer once to pick it back up if it was paused) — the training question is answered straight after. Do NOT say a clinician has to clear them first: finishing the check-in is the next step.`
      : `No session is designed: ${gate.reasons.join("; ")}. Say that plainly in one or two lines, without softening, and offer what you can do — the summary for a clinician, a message to the care team, a booking. Do not describe exercises in your own words instead.`,
  },
});

const cautionNote = (gate: TrainingGate, what: "session" | "week") =>
  `This is a GENERAL, lighter ${what}${what === "session" ? " — the card says so and lists when to stop" : ""}. What is true and must come across: (1) say ONCE, in one line, that exercises aimed at their ${gate.about.toLowerCase()} are for a clinician or physiotherapist to choose; (2) describe the ${what} as what it is — never that it will help, relieve, treat or fix the ${gate.about.toLowerCase()}${gate.conditions.length ? `, and never as being for ${gate.conditions.join(" / ")}` : ""}; (3) if they asked for it "for" a condition, say plainly that you built the general version instead${what === "week" ? `; (4) end with when to stop: ${stopLine(gate) ?? "if it gets worse, stop and get seen"}` : ""}. You may offer once to keep their limitation, in their own words, in their training profile (update_training_profile).`;

/* --------------------------------- tools --------------------------------- */

export const generateWorkout = defineTool({
  name: "generate_workout",
  description:
    "Design ONE training session for the user (gym or anywhere) from what they ask — length, focus (strength / hypertrophy / conditioning / mobility / endurance / mixed), muscle groups, place, equipment — using their profile, training profile, plan, the last 7 days and their own last loads. Returns a card with exercises, sets × reps, rest and a load from their history (never an invented weight); nothing is saved. Pass `date` (and `replaceSessionId`) to make it a swap for a day of their training week. Not for logging something they already did — that is log_workout.",
  schema: z.object({
    durationMin: z.number().int().min(10).max(180).optional().describe("Whole session incl. warm-up; defaults to their training profile, else 45"),
    focus: z.enum(FOCUS).optional(),
    muscleGroups: z.array(z.string().max(40)).max(6).optional().describe("As the user said them: 'upper body', 'legs', 'chest and back', 'core'"),
    place: z.enum(PLACE).optional(),
    equipment: z.array(z.enum(EQUIPMENT)).max(12).optional().describe("Only when the user names what they have right now (hotel gym, dumbbells at home…)"),
    request: z.string().max(600).optional().describe("Anything else verbatim: 'I'm tired', 'no jumping', 'want to hit PRs', 'sore knee today'"),
    date: dayString.optional().describe("Day this session is for; default today. Never in the past."),
    replaceSessionId: z.string().optional().describe("Id of the planned session this replaces (from the snapshot or get_workouts status=planned)"),
    subjectId: subjectField,
  }),
  risk: "generate",
  async run(ctx, input) {
    const subject = await ctx.resolveSubject(input.subjectId);
    if (!subject.isSelf) return { result: { error: "Workouts are designed for the account holder only for now." } };
    const { profile, durationMin, place, needsPlace } = await askDefaults(ctx.patientId, input);
    if (needsPlace)
      return {
        result: {
          needsInfo: true,
          question: "Ask ONE question: where they'll train and what they have (a gym, or home/outdoor with dumbbells, bands, a bar, or just bodyweight). Then call generate_workout again with place/equipment, and offer to remember it with update_training_profile.",
        },
      };
    const gate = await encounterService.trainingGate(ctx.patientId, ctx.threadId);
    if (gate?.level === "hold") return heldResult(gate);
    const caution = gate?.level === "general" ? gate : null;
    const date = input.date && input.date >= ctx.today ? input.date : ctx.today;
    const brief = await buildBrief(ctx.patientId, { today: ctx.today, timeZone: ctx.timeZone, client: ctx.client });
    let replaces: { id: string; title: string; date: string } | null = null;
    if (input.replaceSessionId) {
      const row = await WorkoutService.get(ctx.patientId, input.replaceSessionId);
      if (row && row.status === "PLANNED") replaces = { id: row.id, title: row.title ?? activityByKey(row.activityKey).label, date: row.plannedFor ?? date };
    }
    const designed = await designSession({ durationMin, focus: input.focus ?? null, muscleGroups: input.muscleGroups ?? [], place, equipment: input.equipment ?? profile?.equipment ?? [], request: input.request ?? null, date: replaces?.date ?? date, caution }, brief);
    const draftId = randomUUID();
    const display = sessionDisplay(designed.session);
    const active = await WorkoutPlanService.getActive(ctx.patientId);
    const inWeek = !!active && designed.session.plannedFor! >= active.startDate && designed.session.plannedFor! <= active.endDate;
    const cardData = { draftId, session: designed.session, display, fit: designed.fit, assumptions: designed.assumptions, slot: { date: designed.session.plannedFor, replaces, planId: inWeek ? active!.id : null, inWeek }, lastLoads: Object.fromEntries(designed.session.exercises!.filter((e) => brief.lastLoads[e.exerciseKey]).map((e) => [e.exerciseKey, brief.lastLoads[e.exerciseKey]])), timeZone: ctx.timeZone, caution: caution ? { about: caution.about, stopIf: caution.stopIf } : null };
    registerSessionDraft(draftId, designed.session, cardData);
    return {
      result: {
        draftId,
        session: sessionLine(designed.session),
        why: designed.session.why,
        warmup: designed.session.warmup,
        assumptions: designed.assumptions,
        fit: designed.fit.ok ? { ok: true } : { ok: false, issues: designed.fit.issues, note: "Say plainly what still misses; do not claim it fits." },
        ...(caution ? { caution: cautionNote(caution, "session") } : {}),
        cardActions: `The card has 'Log it as done' (when they've done it), 'Put in plan · ${moment.utc(designed.session.plannedFor!, "YYYY-MM-DD").format("ddd D")}' (writes it onto that day of their week — direct, no proposal) and 'Something else'. Nothing is saved and nothing needs confirming: it is a plan to do, not a log — never call log_workout for it unless they say they did it, and don't ask them to confirm. Keep your text to the highlights: the split, the one or two key lifts with their loads, and the why.`,
        design: { model: designed.model, latencyMs: designed.latencyMs },
      },
      cards: [{ type: "workout", title: designed.session.title!, data: cardData }],
    };
  },
});

export const generateWorkoutPlan = defineTool({
  name: "generate_workout_plan",
  description:
    "Lay out a training week (1–7 days) for the user: which days train, what each session is, then every session designed in full (exercises, sets × reps, rest, loads from their history). Uses their plan's sessions-per-week target, training profile, recent sessions and preferences. Returns a card; nothing is saved until save_workout_plan (or the card's Save). Not for changing a week already drafted in this conversation (move a day, add or change a session) — that is edit_workout_plan, which keeps the rest as it is.",
  schema: z.object({
    days: z.number().int().min(1).max(7).default(7),
    sessionsPerWeek: z.number().int().min(1).max(7).optional().describe("Defaults to the plan's exercise target (else 3)"),
    sessionMinutes: z.number().int().min(10).max(180).optional(),
    focus: z.enum(FOCUS).optional().describe("Overall emphasis when the user states one"),
    place: z.enum(PLACE).optional(),
    startDate: dayString.optional().describe("Day 1; default today (or the day they named). Never in the past."),
    request: z.string().max(600).optional().describe("Their wishes verbatim: 'I can only do mornings', 'no running', 'football on Saturdays'…"),
    subjectId: subjectField,
  }),
  risk: "generate",
  async run(ctx, input) {
    const subject = await ctx.resolveSubject(input.subjectId);
    if (!subject.isSelf) return { result: { error: "Training weeks are designed for the account holder only for now." } };
    const { profile, durationMin, place, needsPlace } = await askDefaults(ctx.patientId, { durationMin: input.sessionMinutes, place: input.place });
    if (needsPlace)
      return {
        result: {
          needsInfo: true,
          question: "Ask ONE question: where they'll train and what they have (a gym, or home/outdoor with dumbbells, bands, a bar, or just bodyweight). Then call generate_workout_plan again with place, and offer to remember it with update_training_profile.",
        },
      };
    const gate = await encounterService.trainingGate(ctx.patientId, ctx.threadId);
    if (gate?.level === "hold") return heldResult(gate);
    const caution = gate?.level === "general" ? gate : null;
    const brief = await buildBrief(ctx.patientId, { today: ctx.today, timeZone: ctx.timeZone, client: ctx.client });
    const sessionsPerWeek = input.sessionsPerWeek ?? brief.plan?.sessionsPerWeek ?? 3;
    const startDate = input.startDate && input.startDate >= ctx.today ? input.startDate : ctx.today;
    const week = await designWeek({ startDate, days: input.days, sessionsPerWeek: Math.min(sessionsPerWeek, input.days), sessionMinutes: durationMin, focus: input.focus ?? null, place, request: input.request ?? null, caution }, brief);
    // Saved with the week. The week card does not print notes today, so the reply carries the same line (cautionNote).
    const notes = caution ? [week.notes, generalSessionLine(caution, "week"), stopLine(caution)].filter(Boolean).join("\n") : week.notes;
    const draftId = randomUUID();
    const active = await WorkoutPlanService.getActive(ctx.patientId);
    const sessions = week.sessions.map((s) => ({ day: s.day, date: s.session.plannedFor, session: s.session, display: sessionDisplay(s.session), fit: s.fit, assumptions: s.assumptions }));
    const cardData = {
      draftId,
      title: week.title,
      notes,
      caution: caution ? { about: caution.about, stopIf: caution.stopIf } : null,
      // The day to keep if only one happens — the card tags it "Priority".
      priorityDay: week.keepDay,
      startDate,
      days: input.days,
      brief: { sessionsPerWeek, sessionMinutes: durationMin, focus: input.focus ?? null, place, request: input.request ?? null },
      fit: week.fit,
      sessions,
      rest: Array.from({ length: input.days }, (_, i) => i + 1).filter((d) => !sessions.some((s) => s.day === d)).map((d) => ({ day: d, date: shiftDay(startDate, d - 1) })),
      replaces: active ? { id: active.id, title: active.title, startDate: active.startDate } : null,
      timeZone: ctx.timeZone,
    };
    try {
      registerWeekDraft(draftId, weekInputFromCard(cardData), cardData);
    } catch (e) {
      console.error("generate_workout_plan: draft not registrable", e);
    }
    return {
      result: {
        draftId,
        title: week.title,
        startDate,
        days: input.days,
        sessions: sessions.map((s) => `day ${s.day} (${moment.utc(s.date!, "YYYY-MM-DD").format("ddd")}): ${sessionLine(s.session)}`),
        notes: week.notes,
        fit: week.fit.ok ? { ok: true } : { ok: false, issues: week.fit.issues, note: "Say plainly which days miss and why; offer to adjust. Do not claim it fits." },
        ...(caution ? { caution: cautionNote(caution, "week") } : {}),
        replaces: cardData.replaces,
        cardActions: "The card shows every day with its exercises, a 'Save this week' button and per-day Log/Swap once saved. Nothing is saved yet: if the user asks to save/keep/use it, call save_workout_plan with this draftId (a proposal they confirm) — otherwise mention once that the card has Save. Keep your text to the split, the days, and one highlight per session.",
        design: { model: week.model, latencyMs: week.latencyMs },
      },
      cards: [{ type: "workout_plan", title: week.title, data: cardData }],
    };
  },
});

/**
 * What an edited week still misses, for the model: an issue the previous card
 * already carried has been said once — repeating it after every edit is
 * nagging (seen in the first eval run: the same consecutive-days warning in
 * three replies running). Only what this edit introduced is to be raised.
 */
export const weekFitForModel = (issues: string[], previous: string[]) => {
  if (!issues.length) return { ok: true as const };
  const fresh = issues.filter((i) => !previous.includes(i));
  const told = issues.filter((i) => previous.includes(i));
  return {
    ok: false as const,
    ...(fresh.length ? { issues: fresh } : {}),
    ...(told.length ? { alreadyTold: told } : {}),
    note: fresh.length
      ? `Say plainly what \`issues\` lists and offer to adjust; do not claim the week fits.${told.length ? " `alreadyTold` was on the previous card and they have heard it — do not raise it again unless they ask." : ""}`
      : "Nothing new misses. `alreadyTold` was on the previous card and they have heard it — do not raise it again unless they ask; do not claim the week fits either.",
  };
};

const weekDay = z.enum(WEEKDAYS);
const designFields = {
  request: z.string().min(1).max(600).describe("What they asked for this session, verbatim"),
  durationMin: z.number().int().min(10).max(180).optional().describe("Only when they gave a length for this session"),
  focus: z.enum(FOCUS).optional(),
  muscleGroups: z.array(z.string().max(40)).max(6).optional(),
};

export const editWorkoutPlan = defineTool({
  name: "edit_workout_plan",
  description:
    "Change the training week draft already on the table in this conversation — move a session to another day, add a session, remove one, or change ONE session. Every session the user did not mention stays exactly as it is (same exercises, sets, reps). Use this for ANY change request to a drafted week; generate_workout_plan is only for a first week or when they ask for a different week altogether. Returns the updated card; nothing is saved. Not for a week that is already saved (move_workout / generate_workout with replaceSessionId).",
  schema: z.object({
    draftId: z.string().optional().describe("The draftId of the week to change. Omit for the latest week card in this conversation."),
    edits: z
      .array(
        z.discriminatedUnion("op", [
          z.object({ op: z.literal("move"), from: weekDay.describe("Weekday the session is on now"), to: weekDay.describe("Weekday it goes to; if that day has a session the two swap") }),
          z.object({ op: z.literal("remove"), day: weekDay }),
          z.object({ op: z.literal("add"), day: weekDay.describe("A day with no session"), ...designFields }),
          z.object({ op: z.literal("change"), day: weekDay.describe("The day of the session to change"), ...designFields }),
        ])
      )
      .min(1)
      .max(7)
      .describe("Applied in order. 'Sessions on Mon, Wed and Thu' when they are on Mon, Wed, Fri = ONE move (fri → thu)."),
  }),
  risk: "generate",
  async run(ctx, input) {
    const card = await findWeekCard(ctx.threadId, input.draftId);
    if (!card) return { result: { error: "No training week draft in this conversation to change — call generate_workout_plan first (for a saved week: move_workout, or generate_workout with replaceSessionId)." } };
    const gate = await encounterService.trainingGate(ctx.patientId, ctx.threadId);
    if (gate?.level === "hold") return heldResult(gate);
    const caution = gate?.level === "general" ? gate : null;
    const startDate: string = card.startDate ?? card.sessions[0].date;
    const days: number = Number(card.days) || 7;
    const place = card.brief?.place ?? null;
    let brief: Awaited<ReturnType<typeof buildBrief>> | null = null;
    let edited: Awaited<ReturnType<typeof applyWeekEdits>>;
    try {
      edited = await applyWeekEdits(
        { startDate, days, priorityDay: Number(card.priorityDay) || null, sessions: (card.sessions as any[]).map((s) => ({ day: s.day, session: s.session, fit: s.fit ?? { ok: true, issues: [] }, assumptions: s.assumptions ?? [] })) },
        input.edits as WeekEdit[],
        async (spec) => {
          brief = brief ?? (await buildBrief(ctx.patientId, { today: ctx.today, timeZone: ctx.timeZone, client: ctx.client }));
          const d = await designSession(
            {
              durationMin: spec.durationMin ?? spec.previous?.durationMin ?? card.brief?.sessionMinutes ?? DEFAULT_SESSION_MIN,
              focus: spec.focus ?? (spec.previous?.focus as (typeof FOCUS)[number] | undefined) ?? null,
              muscleGroups: spec.muscleGroups ?? spec.previous?.muscleGroups ?? [],
              place,
              // The week's original wishes still hold for a new session (their limits, what the week is for).
              request: [spec.request, card.brief?.request ? `The week was asked for as: ${card.brief.request}` : null].filter(Boolean).join(" "),
              date: spec.date,
              weekContext: spec.others.map((o) => ({ date: dateOfDay(startDate, o.day), title: o.session.title ?? "", focus: o.session.focus ?? "mixed", muscleGroups: o.session.muscleGroups ?? [] })),
              caution,
              previous: spec.previous ? asPrevious(spec.previous) : null,
            },
            brief
          );
          return { session: d.session, fit: d.fit, assumptions: d.assumptions };
        }
      );
    } catch (e) {
      if (e instanceof WeekEditError) return { result: { error: `${e.message}. The week is unchanged. Its sessions: ${(card.sessions as any[]).map((s) => `${moment.utc(s.date, "YYYY-MM-DD").format("ddd").toLowerCase()} "${s.session?.title}"`).join(", ")}.` } };
      throw e;
    }
    const draftId = randomUUID();
    const before = new Map<WeekSession["session"], any>((card.sessions as any[]).map((s) => [s.session, s]));
    const sessions = edited.sessions.map((s) => {
      const date = dateOfDay(startDate, s.day);
      // An untouched or moved session keeps its display rows as they were.
      const kept = [...before.values()].find((b) => b.session === s.session || (b.day !== s.day && JSON.stringify({ ...b.session, plannedFor: null }) === JSON.stringify({ ...s.session, plannedFor: null })));
      return { day: s.day, date, session: s.session, display: kept?.display ?? sessionDisplay(s.session), fit: s.fit, assumptions: s.assumptions };
    });
    const shape = weekShapeIssues(sessions.map((s) => ({ day: s.day, focus: s.session.focus, muscleGroups: s.session.muscleGroups })), !!caution);
    const issues = [...shape, ...sessions.flatMap((s) => (s.fit?.issues ?? []).map((i: string) => `day ${s.day}: ${i}`))];
    const cardData = {
      ...card,
      draftId,
      caution: caution ? { about: caution.about, stopIf: caution.stopIf } : card.caution ?? null,
      priorityDay: edited.priorityDay,
      startDate,
      days,
      brief: { ...(card.brief ?? {}), sessionsPerWeek: sessions.length },
      fit: { ok: issues.length === 0, issues },
      sessions,
      rest: Array.from({ length: days }, (_, i) => i + 1).filter((d) => !sessions.some((s) => s.day === d)).map((d) => ({ day: d, date: dateOfDay(startDate, d) })),
      timeZone: ctx.timeZone,
    };
    try {
      registerWeekDraft(draftId, weekInputFromCard(cardData), cardData);
    } catch (e) {
      console.error("edit_workout_plan: draft not registrable", e);
    }
    return {
      result: {
        draftId,
        title: cardData.title,
        changed: edited.log,
        sessions: sessions.map((s) => `${moment.utc(s.date, "YYYY-MM-DD").format("ddd")}: ${edited.designed.includes(s.day) ? sessionLine(s.session) : `${s.session.title} — unchanged`}`),
        fit: weekFitForModel(issues, card.fit?.issues ?? []),
        ...(caution && edited.designed.length ? { caution: cautionNote(caution, "week") } : {}),
        note: "What is true: only the changes listed in `changed` were made; every other session is exactly as it was on the previous card. Say what changed (for a designed session, its key moves) and that the rest is untouched — do not list the unchanged sessions again. The new card replaces the previous one; nothing is saved until they ask (save_workout_plan with this draftId) or tap Save on the card.",
      },
      cards: [{ type: "workout_plan", title: cardData.title, data: cardData }],
    };
  },
});

export const saveWorkoutPlan = defineTool({
  name: "save_workout_plan",
  description:
    "Save a generated training week as the user's active plan (replaces the current one; its sessions already done stay in history). Call only after generate_workout_plan and when the user asks to save/keep/use it. The user confirms in the app.",
  schema: z.object({
    draftId: z.string().optional().describe("The draftId from the generate_workout_plan result. Omit to use the latest week card in this conversation."),
    startDate: dayString.optional().describe("Day 1, if the user wants a different start than the card. Never in the past."),
  }),
  risk: "write",
  async run(ctx, input) {
    if (input.startDate && input.startDate < ctx.today) return { result: { error: "startDate is in the past — use today or later" } };
    const draft = await findWeekDraft(ctx.threadId, input.draftId);
    if (!draft) return { result: { error: "No training week draft to save — call generate_workout_plan first." } };
    const startDate = input.startDate ?? draft.plan.startDate ?? ctx.today;
    const plan = { ...draft.plan, startDate };
    const endDate = shiftDay(startDate, plan.days - 1);
    const active = await WorkoutPlanService.getActive(ctx.patientId);
    const preview = {
      title: plan.title,
      startDate,
      endDate,
      days: plan.days,
      sessions: plan.sessions.map((s) => `${moment.utc(shiftDay(startDate, s.day - 1), "YYYY-MM-DD").format("ddd D")} · ${s.title} · ${s.durationMin} min`),
      sessionCount: plan.sessions.length,
      replaces: active ? { id: active.id, title: active.title, startDate: active.startDate, planned: active.planned, done: active.done } : null,
      plan,
    };
    return {
      result: { previewOf: { title: plan.title, startDate, endDate, sessions: preview.sessions, replaces: preview.replaces } },
      proposal: {
        title: `Save "${plan.title}"`,
        summary: `${plan.sessions.length} sessions, ${startDate === endDate ? startDate : `${startDate} → ${endDate}`}${active ? ` — replaces "${active.title}"` : ""}`,
        preview,
      },
    };
  },
  async commit(ctx, input, preview: any) {
    const plan: WorkoutPlanInput = WorkoutPlanInput.parse(preview?.plan ?? (await findWeekDraft(ctx.threadId, input.draftId))?.plan);
    const startDate = input.startDate ?? preview?.startDate ?? plan.startDate ?? ctx.today;
    const saved = await WorkoutPlanService.create(ctx.patientId, { ...plan, startDate });
    const result = { id: saved.id, title: saved.title, startDate: saved.startDate, endDate: saved.endDate, days: saved.days, sessions: saved.planned };
    return { result, cards: [{ type: "workout_plan_saved", title: "Training week saved", data: result }] };
  },
});

export const moveWorkout = defineTool({
  name: "move_workout",
  description: "Move a planned session to another day of the user's training week (same session, same time of day). Pass the planned session id (from the snapshot or get_workouts status=planned) and the new day. The user confirms in the app.",
  schema: z.object({
    sessionId: z.string(),
    plannedFor: dayString.describe("The new day. Never in the past."),
  }),
  risk: "write",
  async run(ctx, input) {
    if (input.plannedFor < ctx.today) return { result: { error: "that day is in the past" } };
    const row = await WorkoutService.get(ctx.patientId, input.sessionId);
    if (!row || row.status !== "PLANNED") return { result: { error: "No planned session with that id — get_workouts status=planned lists them." } };
    const title = row.title ?? activityByKey(row.activityKey).label;
    const from = row.plannedFor ?? moment(row.startedAt).tz(ctx.timeZone).format("YYYY-MM-DD");
    const clash = (await WorkoutService.listPlanned(ctx.patientId, input.plannedFor, input.plannedFor)).filter((s) => s.id !== row.id);
    const preview = { sessionId: row.id, title, from, to: input.plannedFor, fromLabel: moment.utc(from, "YYYY-MM-DD").format("ddd D MMM"), toLabel: moment.utc(input.plannedFor, "YYYY-MM-DD").format("ddd D MMM"), clash: clash.map((s) => s.title ?? activityByKey(s.activityKey).label) };
    return {
      result: { previewOf: { title, from, to: input.plannedFor, alsoThatDay: preview.clash } },
      proposal: { title: `Move ${title}`, summary: `${preview.fromLabel} → ${preview.toLabel}${clash.length ? ` (that day already has ${preview.clash.join(", ")})` : ""}`, preview },
    };
  },
  async commit(ctx, input) {
    const moved = await WorkoutService.movePlanned(ctx.patientId, input.sessionId, input.plannedFor);
    if (!moved) throw new Error("planned session not found");
    const result = { id: moved.id, title: moved.title, plannedFor: moved.plannedFor };
    return { result, cards: [{ type: "workout_moved", title: "Session moved", data: result }] };
  },
});

export const updateTrainingProfile = defineTool({
  name: "update_training_profile",
  description:
    "Remember how the user trains, structurally: where (gym/home/outdoor/mixed), equipment they have, experience, usual session length, preferred days and time, and any limitation IN THEIR OWN WORDS (a sore knee, 'no overhead pressing'). Only the fields you pass change. Use it when they tell you these things, or after you had to ask. The user confirms in the app. Never turn a symptom into advice — a limitation is repeated, not interpreted.",
  schema: z.object({
    place: z.enum(["gym", "home", "outdoor", "mixed"]).optional(),
    equipment: z.array(z.enum(EQUIPMENT)).max(12).optional().describe("Full list they have (replaces the previous list)"),
    experience: z.enum(EXPERIENCE).optional(),
    sessionMinutes: z.number().int().min(10).max(180).optional(),
    preferredDays: z.array(z.enum(WEEKDAYS)).max(7).optional(),
    preferredTime: timeString.optional().describe("HH:mm local"),
    limitations: z.string().max(400).optional().describe("Their words verbatim; empty string clears it"),
  }),
  risk: "write",
  async run(ctx, input) {
    const keys = Object.keys(input).filter((k) => (input as any)[k] !== undefined);
    if (!keys.length) return { result: { error: "nothing to update" } };
    const before = await TrainingProfileService.get(ctx.patientId);
    const changes = keys.map((k) => `${k}: ${before ? JSON.stringify((before as any)[k] ?? null) : "—"} → ${JSON.stringify((input as any)[k])}`);
    const preview = { before: before ? { place: before.place, equipment: before.equipment, experience: before.experience, sessionMinutes: before.sessionMinutes, preferredDays: before.preferredDays, preferredTime: before.preferredTime, limitations: before.limitations } : null, after: input, changes };
    return { result: { previewOf: { changes } }, proposal: { title: "Update how you train", summary: changes.join("; "), preview } };
  },
  async commit(ctx, input) {
    const saved = await TrainingProfileService.upsert(ctx.patientId, input);
    const result = { updated: true, training: TrainingProfileService.render(saved) };
    return { result, cards: [{ type: "training_profile_saved", title: "Training profile updated", data: result }] };
  },
});
