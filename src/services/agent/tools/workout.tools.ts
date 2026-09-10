import moment from "moment-timezone";
import { z } from "zod";
import { clampRange, dateRange, dayString, defineTool, shiftDay, subjectField } from "./registry";
import type { Card } from "./registry";
import { dayKey } from "../memory/dates";
import WorkoutService from "../../workouts/model/workouts.model";
import { parseWorkout } from "../../workouts/parsing/workoutParse.service";
import { matchWatchWorkout } from "../../workouts/domain/workout.matching";
import { activityByKey, activityKeyFromHealthKit } from "../../workouts/domain/activity.catalog";
import { estimateCalories, fmtDuration, fmtSets, summarizeSession, tonnage, workingSets } from "../../workouts/domain/workout.metrics";
import { PreviewEdits, SessionInput, WatchWorkoutSummary, type ExerciseInput } from "../../workouts/domain/workout.schema";
import WorkoutPlanService, { fmtTargets } from "../../workouts/model/plan.model";
import { savedWeekCard, sessionDraft } from "./workoutplan.tools";

/**
 * Training sessions. `log_workout` is a confirm-gated write: the description
 * is parsed into exercises/sets by the workouts parsing service, matched to a
 * watch workout the phone sent in the client context (heart rate + calories
 * come from there), and returned as a preview the user edits and confirms.
 * `get_workouts` reads what was saved, including per-exercise history.
 */

const DEFAULT_DURATION_SEC = 45 * 60;

const watchLine = (w: WatchWorkoutSummary, tz: string) =>
  `${activityByKey(activityKeyFromHealthKit(w.activityName)).label} ${moment(w.startedAt).tz(tz).format("ddd HH:mm")}–${moment(w.endedAt).tz(tz).format("HH:mm")} (${fmtDuration(w.durationSec)}${w.calories ? `, ${Math.round(w.calories)} kcal` : ""}${w.avgHr ? `, avg ${w.avgHr} bpm` : ""})`;

/** What the card renders. `session` is the exact payload commit() persists. */
const buildPreview = (session: SessionInput, opts: { tz: string; calories: number | null; matchKind: string; assumptions: string[]; vsLast: { name: string; last: string }[]; subject: string; subjectId: string; completes?: { sessionId: string; title: string; date: string; source: "planned" | "draft" } | null }) => ({
  session,
  /** The planned row this log completes (same record, no duplicate), when there is one. */
  completes: opts.completes ?? null,
  subject: opts.subject,
  subjectId: opts.subjectId,
  activityLabel: activityByKey(session.activityKey).label,
  title: session.title ?? activityByKey(session.activityKey).label,
  day: moment(session.startedAt).tz(opts.tz).format("YYYY-MM-DD"),
  timeLabel: opts.assumptions.includes("time") ? null : `${moment(session.startedAt).tz(opts.tz).format("HH:mm")}–${moment(session.endedAt).tz(opts.tz).format("HH:mm")}`,
  durationLabel: fmtDuration(session.durationSec),
  calories: opts.calories,
  metricsSource: session.watch ? "watch" : opts.calories != null ? "estimate" : null,
  avgHr: session.watch?.avgHr ?? null,
  peakHr: session.watch?.peakHr ?? null,
  matchKind: opts.matchKind,
  watchLabel: session.watch ? watchLine(session.watch, opts.tz) : null,
  exercises: session.exercises.map((e) => ({ name: e.name, exerciseKey: e.exerciseKey, setsLabel: fmtSets(e.sets), sets: e.sets })),
  workingSets: workingSets(session.exercises),
  tonnageKg: tonnage(session.exercises),
  vsLast: opts.vsLast,
  assumptions: opts.assumptions,
  summary: summarizeSession(session, opts.calories),
});

export const applyWorkoutEdits = (preview: any, rawEdits: unknown) => {
  const edits = PreviewEdits.parse(rawEdits);
  const session: SessionInput = SessionInput.parse(preview?.session);
  if (edits.title !== undefined) session.title = edits.title?.trim() || null;
  if (edits.exercises) {
    const removed = new Set<number>();
    for (const ee of edits.exercises) {
      const ex = session.exercises[ee.index];
      if (!ex) throw new Error(`no exercise at index ${ee.index}`);
      if (ee.removed) {
        removed.add(ee.index);
        continue;
      }
      const removedSets = new Set<number>();
      for (const se of ee.sets ?? []) {
        const set = ex.sets[se.index];
        if (!set) throw new Error(`no set at index ${se.index}`);
        if (se.removed) {
          removedSets.add(se.index);
          continue;
        }
        if (se.reps !== undefined) set.reps = se.reps;
        if (se.weightKg !== undefined) set.weightKg = se.weightKg;
      }
      ex.sets = ex.sets.filter((_, i) => !removedSets.has(i));
    }
    session.exercises = session.exercises.filter((_, i) => !removed.has(i));
  }
  const calories = session.watch?.calories != null ? Math.round(session.watch.calories) : preview?.calories ?? null;
  return { ...buildPreview(session, { tz: preview?.tz ?? "UTC", calories, matchKind: preview?.matchKind ?? "none", assumptions: preview?.assumptions ?? [], vsLast: preview?.vsLast ?? [], subject: preview?.subject, subjectId: preview?.subjectId, completes: preview?.completes ?? null }), tz: preview?.tz, edited: true };
};

/** Planned exercises (targets) → the actual-set shape a log starts from: reps = target, kg = target. */
const actualsFromPlanned = (exercises: ExerciseInput[]): ExerciseInput[] =>
  exercises.map((e) => ({
    ...e,
    sets: (e.sets ?? []).map((s) => ({ ...s, reps: s.reps ?? s.targetReps ?? null, weightKg: s.weightKg ?? s.targetKg ?? null })),
  }));

const planLabel = (row: { title: string | null; activityKey: string; plannedFor: string | null }) => row.title ?? activityByKey(row.activityKey).label;

/** The planned session for a day when the model has no (or a wrong) id: the day's PLANNED row, if exactly one. */
const plannedOn = async (patientId: string, day: string) => {
  const rows = await WorkoutService.listPlanned(patientId, day, day);
  return rows.length === 1 ? rows[0] : null;
};

export const logWorkout = defineTool({
  name: "log_workout",
  description:
    "Log a training session the user did (gym/strength with exercises, sets, reps and weights; a run, ride, swim, match, class…). Pass their words verbatim, including any time reference ('this morning', 'yesterday at 7'). The tool structures it, links it to the matching Apple Watch workout for heart rate and calories when the phone sent one, and returns a PREVIEW the user confirms in the app. If a planned session exists for that day it is COMPLETED in place (the preview says so) — never a duplicate. To log a planned session as done ('did today's workout', 'did it as planned'), pass sessionId (from the snapshot / get_workouts status=planned) or draftId (a generate_workout card) instead of a description: the planned sets become the starting point and the card is editable. Not for planned or hypothetical sessions. If the result lists several candidate watch workouts, ask the user which one and call again with `watchExternalId`.",
  schema: z.object({
    description: z.string().min(3).max(2000).optional().describe("The session EXACTLY as the user wrote it — keep every time word (tonight, this morning, yesterday, Monday) and every number. Omit when passing sessionId or draftId."),
    sessionId: z.string().optional().describe("A PLANNED session id to complete with its planned sets (edit reps/kg on the card if they differ)"),
    draftId: z.string().optional().describe("A generate_workout draftId the user just did"),
    date: dayString.optional().describe("Only when the user named a day that is NOT in the description text. Never guess; never a future date."),
    watchExternalId: z.string().optional().describe("Pick a specific watch workout after an ambiguous match"),
    subjectId: subjectField,
  }),
  risk: "write",
  applyPreviewEdits: applyWorkoutEdits,
  async run(ctx, input) {
    const subject = await ctx.resolveSubject(input.subjectId);
    const tz = ctx.timeZone;
    const candidates = ctx.client?.recentWorkouts ?? [];

    /* ---- a planned session (row or draft) done as planned: no parsing ---- */
    if (input.sessionId || input.draftId) {
      let plannedExercises: ExerciseInput[] = [];
      let activityKey = "strength";
      let title: string | null = null;
      let durationSec = DEFAULT_DURATION_SEC;
      let day = ctx.today;
      let completes: NonNullable<Parameters<typeof buildPreview>[1]["completes"]> | null = null;
      if (input.sessionId) {
        const row = (await WorkoutService.get(subject.id, input.sessionId)) ?? (await plannedOn(subject.id, input.date ?? ctx.today));
        if (!row) return { result: { error: `No planned session with that id — use the sessionId from the snapshot's training week or get_workouts status=planned, or describe what they did.` } };
        if (row.status === "COMPLETED" && row.description) return { result: { error: `That session is already logged (${planLabel(row)} on ${row.plannedFor ?? moment(row.startedAt).tz(tz).format("YYYY-MM-DD")}).` } };
        plannedExercises = row.exercises.map((e) => ({ exerciseKey: e.exerciseKey, name: e.name, muscleGroup: e.muscleGroup, equipment: e.equipment, notes: e.notes, loadNote: e.loadNote, alternatives: e.alternatives, sets: e.sets.map((x) => ({ reps: x.reps, weightKg: x.weightKg, durationSec: x.durationSec, distanceM: x.distanceM, rpe: x.rpe, toFailure: x.toFailure, isWarmup: x.isWarmup, targetReps: x.targetReps, targetRepsMax: x.targetRepsMax, targetKg: x.targetKg, restSec: x.restSec })) }));
        activityKey = row.activityKey;
        title = row.title;
        durationSec = row.durationSec;
        day = row.plannedFor && row.plannedFor <= ctx.today ? row.plannedFor : ctx.today;
        completes = { sessionId: row.id, title: planLabel(row), date: row.plannedFor ?? day, source: "planned" };
      } else {
        const d = sessionDraft(input.draftId!);
        if (!d) return { result: { error: "That workout draft has expired — ask me to design it again, or describe what you did." } };
        plannedExercises = d.exercises ?? [];
        activityKey = d.activityKey!;
        title = d.title ?? null;
        durationSec = (d.durationMin ?? 45) * 60;
        day = d.plannedFor && d.plannedFor <= ctx.today ? d.plannedFor : ctx.today;
        completes = { sessionId: input.draftId!, title: d.title!, date: day, source: "draft" };
      }
      const assumptions: string[] = ["sets as planned — edit any you changed"];
      let watch: WatchWorkoutSummary | null = null;
      let matchKind = "none";
      if (input.watchExternalId) {
        watch = candidates.find((w) => w.externalId === input.watchExternalId) ?? null;
        matchKind = watch ? "chosen" : "none";
      } else if (candidates.length) {
        const m = matchWatchWorkout({ activityKey, day, startedAtMs: null, durationSec }, candidates, (iso) => dayKey(tz, iso));
        if (m.kind === "exact" || m.kind === "likely") {
          watch = m.workout;
          matchKind = m.kind;
        }
      }
      const startedAt = watch ? moment(watch.startedAt).tz(tz) : moment.tz(`${day} ${moment().tz(tz).format("HH:mm")}`, "YYYY-MM-DD HH:mm", tz).subtract(durationSec, "seconds");
      if (!watch) assumptions.push("time", "duration");
      const session: SessionInput = SessionInput.parse({
        activityKey,
        title,
        startedAt: startedAt.toISOString(),
        endedAt: startedAt.clone().add(watch?.durationSec ?? durationSec, "seconds").toISOString(),
        durationSec: watch?.durationSec ?? durationSec,
        description: `Did the planned session: ${title ?? activityByKey(activityKey).label}`,
        exercises: actualsFromPlanned(plannedExercises),
        watch,
      });
      const calories = watch?.calories != null ? Math.round(watch.calories) : estimateCalories(session.activityKey, session.durationSec, await WorkoutService.bodyWeightKg(subject.id));
      if (!watch && calories != null) assumptions.push("calories");
      const preview = { ...buildPreview(session, { tz, calories, matchKind, assumptions, vsLast: [], subject: subject.name, subjectId: subject.id, completes }), tz, plannedSessionId: completes.source === "planned" ? completes.sessionId : null };
      return {
        result: { previewFor: subject.name, completes: `${completes.title} (${completes.date})`, summary: preview.summary, exercises: preview.exercises.map((e) => `${e.name}: ${e.setsLabel || "no sets"}`), matchedWatchWorkout: preview.watchLabel, assumptions, note: "The card starts from the planned sets — the user edits reps/kg that differed, then confirms." },
        proposal: { title: `Log ${completes.title}`, summary: `${preview.summary} on ${preview.day} — completes the planned session`, preview },
      };
    }

    if (!input.description) return { result: { error: "Pass the user's description, or sessionId / draftId for a planned session." } };
    const parsed = await parseWorkout(input.description, { today: ctx.today, timeZone: tz });
    if (!parsed.isWorkout) {
      const fallbackDay = input.date && input.date <= ctx.today ? input.date : ctx.today;
      const plannedToday = /\b(planned|as planned|the plan|today'?s (session|workout)|did it)\b/i.test(input.description) ? await plannedOn(subject.id, fallbackDay) : null;
      if (plannedToday) return { result: { hint: `That reads as the planned session "${planLabel(plannedToday)}" (${plannedToday.plannedFor}). Call log_workout again with sessionId=${plannedToday.id}.`, sessionId: plannedToday.id } };
      return { result: { error: "That doesn't read as a session that already happened — I can log workouts you've done, with exercises and sets if you have them." } };
    }

    // The parser's reading of the user's own words wins; the model's `date`
    // only fills a gap, and nothing may land in the future.
    const day = [parsed.dayStated ? parsed.day : null, input.date, parsed.day].find((d) => d && d <= ctx.today) ?? ctx.today;
    const statedStart = parsed.startTime ? moment.tz(`${day} ${parsed.startTime}`, "YYYY-MM-DD HH:mm", tz) : null;
    const assumptions: string[] = [];

    let watch: WatchWorkoutSummary | null = null;
    let matchKind = "none";
    if (input.watchExternalId) {
      watch = candidates.find((w) => w.externalId === input.watchExternalId) ?? null;
      matchKind = watch ? "chosen" : "none";
    } else if (candidates.length) {
      const m = matchWatchWorkout(
        { activityKey: parsed.activityKey, day, startedAtMs: statedStart?.valueOf() ?? null, durationSec: parsed.durationSec },
        candidates,
        (iso) => dayKey(tz, iso)
      );
      if (m.kind === "ambiguous")
        return {
          result: {
            needsChoice: true,
            message: "Several watch workouts on that day could be this session — ask the user which one, then call log_workout again with watchExternalId.",
            candidates: m.candidates.map((w) => ({ watchExternalId: w.externalId, label: watchLine(w, tz) })),
          },
        };
      if (m.kind !== "none") {
        watch = m.workout;
        matchKind = m.kind;
      }
    }

    let startedAt: moment.Moment;
    let durationSec: number;
    if (watch) {
      startedAt = moment(watch.startedAt).tz(tz);
      durationSec = watch.durationSec;
    } else {
      durationSec = parsed.durationSec ?? DEFAULT_DURATION_SEC;
      if (!parsed.durationSec) assumptions.push("duration");
      if (statedStart) startedAt = statedStart;
      else {
        startedAt = moment.tz(`${day} 12:00`, "YYYY-MM-DD HH:mm", tz);
        assumptions.push("time");
      }
    }
    const endedAt = startedAt.clone().add(durationSec, "seconds");

    const session: SessionInput = SessionInput.parse({
      activityKey: parsed.activityKey,
      title: parsed.title,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationSec,
      rpe: parsed.rpe,
      notes: parsed.notes,
      description: input.description,
      distanceKm: parsed.distanceKm,
      exercises: parsed.exercises,
      watch,
    });

    const calories = watch?.calories != null ? Math.round(watch.calories) : estimateCalories(session.activityKey, durationSec, await WorkoutService.bodyWeightKg(subject.id));
    if (!watch && calories != null) assumptions.push("calories");

    const prev = await WorkoutService.previousExercises(subject.id, session.exercises.map((e) => e.exerciseKey), startedAt.toDate());
    const vsLast = session.exercises
      .filter((e) => prev.has(e.exerciseKey))
      .map((e) => {
        const p = prev.get(e.exerciseKey)!;
        return { name: e.name, last: `${fmtSets(p.sets.map((s) => ({ ...s, toFailure: false, isWarmup: false })))} (${moment(p.sessionDate).tz(tz).format("D MMM")})` };
      });

    // A planned session that day with a compatible activity is COMPLETED by this log (the service applies the same rule on commit).
    const plannedRow = await WorkoutService.adoptPlanned(subject.id, { day, activityKey: session.activityKey, startedAtMs: startedAt.valueOf(), durationSec });
    const completes = plannedRow ? { sessionId: plannedRow.id, title: planLabel(plannedRow), date: plannedRow.plannedFor ?? day, source: "planned" as const } : null;
    if (plannedRow && !session.exercises.length && plannedRow.exercises.length) {
      // "Did it as planned" with no sets stated: start the log from the prescription.
      session.exercises = actualsFromPlanned(plannedRow.exercises.map((e) => ({ exerciseKey: e.exerciseKey, name: e.name, muscleGroup: e.muscleGroup, equipment: e.equipment, notes: e.notes, loadNote: e.loadNote, alternatives: e.alternatives, sets: e.sets.map((x) => ({ reps: x.reps, weightKg: x.weightKg, durationSec: x.durationSec, distanceM: x.distanceM, rpe: x.rpe, toFailure: x.toFailure, isWarmup: x.isWarmup, targetReps: x.targetReps, targetRepsMax: x.targetRepsMax, targetKg: x.targetKg, restSec: x.restSec })) })));
      if (!session.title) session.title = plannedRow.title;
      assumptions.push("sets as planned — edit any you changed");
    }
    const preview = { ...buildPreview(session, { tz, calories, matchKind, assumptions, vsLast, subject: subject.name, subjectId: subject.id, completes }), tz, plannedSessionId: plannedRow?.id ?? null, parser: { model: parsed.model, latencyMs: parsed.latencyMs } };
    const label = session.title ?? plannedRow?.title ?? activityByKey(session.activityKey).label;
    return {
      result: {
        previewFor: subject.name,
        completes: completes ? `${completes.title} planned for ${completes.date} — this log completes it (same record, no duplicate)` : null,
        summary: preview.summary,
        day: preview.day,
        matchedWatchWorkout: preview.watchLabel,
        assumptions,
        exercises: preview.exercises.map((e) => `${e.name}: ${e.setsLabel || "no sets"}`),
        vsLast,
      },
      proposal: { title: `Log ${label}`, summary: `${preview.summary} on ${preview.day}${subject.isSelf ? "" : ` for ${subject.name}`}${completes ? " — completes the planned session" : ""}`, preview },
    };
  },
  async commit(ctx, input, preview: any) {
    let session: SessionInput | null = preview?.session ? SessionInput.parse(preview.session) : null;
    const subjectId: string = preview?.subjectId ?? (await ctx.resolveSubject(input.subjectId)).id;
    if (!session && !input.description) throw new Error("nothing to log");
    if (!session) {
      // Input was edited after the preview was built — re-derive without a watch link.
      const parsed = await parseWorkout(input.description, { today: ctx.today, timeZone: ctx.timeZone });
      if (!parsed.isWorkout) throw new Error("nothing to log");
      const day = [parsed.dayStated ? parsed.day : null, input.date, parsed.day].find((d) => d && d <= ctx.today) ?? ctx.today;
      const start = moment.tz(`${day} ${parsed.startTime ?? "12:00"}`, "YYYY-MM-DD HH:mm", ctx.timeZone);
      const durationSec = parsed.durationSec ?? DEFAULT_DURATION_SEC;
      session = SessionInput.parse({ activityKey: parsed.activityKey, title: parsed.title, startedAt: start.toISOString(), endedAt: start.clone().add(durationSec, "seconds").toISOString(), durationSec, rpe: parsed.rpe, notes: parsed.notes, description: input.description, distanceKm: parsed.distanceKm, exercises: parsed.exercises, watch: null });
    }
    const saved = await WorkoutService.createSession(subjectId, session, "OLLIE", { plannedId: preview?.plannedSessionId ?? input.sessionId ?? null });
    const result = {
      id: saved.id,
      completedPlanned: !!saved.planId || saved.status === "COMPLETED" && !!saved.plannedFor,
      title: saved.title ?? activityByKey(saved.activityKey).label,
      activity: activityByKey(saved.activityKey).label,
      date: moment(saved.startedAt).tz(ctx.timeZone).format("YYYY-MM-DD"),
      durationMin: Math.round(saved.durationSec / 60),
      calories: saved.calories,
      metricsSource: saved.metricsSource,
      avgHr: saved.avgHr,
      exercises: saved.exercises.length,
      linkedToWatch: !!saved.externalId,
    };
    return { result, cards: [{ type: "workout_logged", title: "Logged", data: result }] };
  },
});

export const getWorkouts = defineTool({
  name: "get_workouts",
  description:
    "Training sessions in a date range. status=completed (default): what the user did — logged or synced from their watch, last 14 days by default (max 31), with exercises and sets when described; exerciseKey gives one lift's history for progression questions. status=planned: the sessions designed for coming days (today → +13 by default) with their target sets, and the active training week as a card; status=all for both. For plain daily exercise minutes use get_activity.",
  schema: dateRange.extend({
    status: z.enum(["completed", "planned", "all"]).default("completed"),
    exerciseKey: z.string().optional().describe("Catalog key, e.g. bench_press — filters to sessions containing it"),
    subjectId: subjectField,
  }),
  risk: "read",
  async run(ctx, input) {
    const subject = await ctx.resolveSubject(input.subjectId);
    const tz = ctx.timeZone;
    const status = (input.status ?? "completed").toUpperCase() as "COMPLETED" | "PLANNED" | "ALL";
    // Planned sessions live in the future: don't clamp those ranges to today.
    const range =
      status === "COMPLETED"
        ? clampRange({ from: input.from ?? shiftDay(input.to ?? ctx.today, -13), to: input.to }, ctx.today)
        : (() => {
            const from = input.from ?? (status === "PLANNED" ? ctx.today : shiftDay(ctx.today, -6));
            const to = input.to ?? shiftDay(from, 13);
            return { from, to, next: shiftDay(to, 1), clamped: false };
          })();
    const from = moment.tz(range.from, "YYYY-MM-DD", tz).toDate();
    const to = moment.tz(range.next, "YYYY-MM-DD", tz).toDate();
    let sessions = await WorkoutService.list(subject.id, { from, to }, { status });
    if (input.exerciseKey) sessions = sessions.filter((s) => s.exercises.some((e) => e.exerciseKey === input.exerciseKey));
    const out = sessions.map((s) => ({
      id: s.id,
      status: s.status,
      plannedFor: s.plannedFor,
      inPlan: !!s.planId,
      focus: s.focus,
      place: s.place,
      date: s.status === "PLANNED" ? s.plannedFor ?? moment(s.startedAt).tz(tz).format("YYYY-MM-DD") : moment(s.startedAt).tz(tz).format("YYYY-MM-DD"),
      time: moment(s.startedAt).tz(tz).format("HH:mm"),
      activity: activityByKey(s.activityKey).label,
      title: s.title,
      durationMin: Math.round(s.durationSec / 60),
      calories: s.calories,
      metricsSource: s.metricsSource,
      avgHr: s.avgHr,
      peakHr: s.peakHr,
      distanceKm: s.distanceKm,
      source: s.source,
      exercises: (input.exerciseKey ? s.exercises.filter((e) => e.exerciseKey === input.exerciseKey) : s.exercises).map((e) => ({
        name: e.name,
        exerciseKey: e.exerciseKey,
        sets: s.status === "PLANNED" ? fmtTargets(e.sets) : fmtSets(e.sets.map((x) => ({ reps: x.reps, weightKg: x.weightKg, durationSec: x.durationSec, distanceM: x.distanceM, toFailure: x.toFailure, isWarmup: x.isWarmup }))),
        ...(s.status === "PLANNED" ? { loadNote: e.loadNote, restSec: e.sets[0]?.restSec ?? null } : {}),
      })),
    }));
    const result = {
      subject: subject.name,
      from: range.from,
      to: range.to,
      status: input.status ?? "completed",
      sessions: out.length,
      totalMinutes: out.reduce((a, s) => a + s.durationMin, 0),
      withExercises: out.filter((s) => s.exercises.length).length,
      list: out,
    };
    const cards: Card[] = [];
    if (status !== "COMPLETED" && subject.isSelf) {
      const week = await WorkoutPlanService.getActive(subject.id);
      if (week) cards.push(savedWeekCard(week, tz));
    }
    if (out.length && !(cards.length && status === "PLANNED")) cards.push({ type: "workouts", title: status === "PLANNED" ? "Planned sessions" : "Sessions", data: result });
    return { result, cards };
  },
});
