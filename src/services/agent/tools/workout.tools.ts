import moment from "moment-timezone";
import { z } from "zod";
import { clampRange, dateRange, dayString, defineTool, shiftDay, subjectField } from "./registry";
import { dayKey } from "../memory/dates";
import WorkoutService from "../../workouts/model/workouts.model";
import { parseWorkout } from "../../workouts/parsing/workoutParse.service";
import { matchWatchWorkout } from "../../workouts/domain/workout.matching";
import { activityByKey, activityKeyFromHealthKit } from "../../workouts/domain/activity.catalog";
import { estimateCalories, fmtDuration, fmtSets, summarizeSession, tonnage, workingSets } from "../../workouts/domain/workout.metrics";
import { PreviewEdits, SessionInput, WatchWorkoutSummary } from "../../workouts/domain/workout.schema";

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
const buildPreview = (session: SessionInput, opts: { tz: string; calories: number | null; matchKind: string; assumptions: string[]; vsLast: { name: string; last: string }[]; subject: string; subjectId: string }) => ({
  session,
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
  return { ...buildPreview(session, { tz: preview?.tz ?? "UTC", calories, matchKind: preview?.matchKind ?? "none", assumptions: preview?.assumptions ?? [], vsLast: preview?.vsLast ?? [], subject: preview?.subject, subjectId: preview?.subjectId }), tz: preview?.tz, edited: true };
};

export const logWorkout = defineTool({
  name: "log_workout",
  description:
    "Log a training session the user did (gym/strength with exercises, sets, reps and weights; a run, ride, swim, match, class…). Pass their words verbatim, including any time reference ('this morning', 'yesterday at 7'). The tool structures it, links it to the matching Apple Watch workout for heart rate and calories when the phone sent one, and returns a PREVIEW the user confirms in the app. Not for planned or hypothetical sessions. If the result lists several candidate watch workouts, ask the user which one and call again with `watchExternalId`.",
  schema: z.object({
    description: z.string().min(3).max(2000).describe("The session EXACTLY as the user wrote it — keep every time word (tonight, this morning, yesterday, Monday) and every number"),
    date: dayString.optional().describe("Only when the user named a day that is NOT in the description text. Never guess; never a future date."),
    watchExternalId: z.string().optional().describe("Pick a specific watch workout after an ambiguous match"),
    subjectId: subjectField,
  }),
  risk: "write",
  applyPreviewEdits: applyWorkoutEdits,
  async run(ctx, input) {
    const subject = await ctx.resolveSubject(input.subjectId);
    const tz = ctx.timeZone;
    const parsed = await parseWorkout(input.description, { today: ctx.today, timeZone: tz });
    if (!parsed.isWorkout) return { result: { error: "That doesn't read as a session that already happened — I can log workouts you've done, with exercises and sets if you have them." } };

    // The parser's reading of the user's own words wins; the model's `date`
    // only fills a gap, and nothing may land in the future.
    const day = [parsed.dayStated ? parsed.day : null, input.date, parsed.day].find((d) => d && d <= ctx.today) ?? ctx.today;
    const statedStart = parsed.startTime ? moment.tz(`${day} ${parsed.startTime}`, "YYYY-MM-DD HH:mm", tz) : null;
    const candidates = ctx.client?.recentWorkouts ?? [];
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

    const preview = { ...buildPreview(session, { tz, calories, matchKind, assumptions, vsLast, subject: subject.name, subjectId: subject.id }), tz, parser: { model: parsed.model, latencyMs: parsed.latencyMs } };
    const label = session.title ?? activityByKey(session.activityKey).label;
    return {
      result: {
        previewFor: subject.name,
        summary: preview.summary,
        day: preview.day,
        matchedWatchWorkout: preview.watchLabel,
        assumptions,
        exercises: preview.exercises.map((e) => `${e.name}: ${e.setsLabel || "no sets"}`),
        vsLast,
      },
      proposal: { title: `Log ${label}`, summary: `${preview.summary} on ${preview.day}${subject.isSelf ? "" : ` for ${subject.name}`}`, preview },
    };
  },
  async commit(ctx, input, preview: any) {
    let session: SessionInput | null = preview?.session ? SessionInput.parse(preview.session) : null;
    const subjectId: string = preview?.subjectId ?? (await ctx.resolveSubject(input.subjectId)).id;
    if (!session) {
      // Input was edited after the preview was built — re-derive without a watch link.
      const parsed = await parseWorkout(input.description, { today: ctx.today, timeZone: ctx.timeZone });
      if (!parsed.isWorkout) throw new Error("nothing to log");
      const day = [parsed.dayStated ? parsed.day : null, input.date, parsed.day].find((d) => d && d <= ctx.today) ?? ctx.today;
      const start = moment.tz(`${day} ${parsed.startTime ?? "12:00"}`, "YYYY-MM-DD HH:mm", ctx.timeZone);
      const durationSec = parsed.durationSec ?? DEFAULT_DURATION_SEC;
      session = SessionInput.parse({ activityKey: parsed.activityKey, title: parsed.title, startedAt: start.toISOString(), endedAt: start.clone().add(durationSec, "seconds").toISOString(), durationSec, rpe: parsed.rpe, notes: parsed.notes, description: input.description, distanceKm: parsed.distanceKm, exercises: parsed.exercises, watch: null });
    }
    const saved = await WorkoutService.createSession(subjectId, session, "OLLIE");
    const result = {
      id: saved.id,
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
    "Training sessions the user logged or synced from their watch in a date range (default: last 14 days; max 31), with exercises and sets when they were described. Pass exerciseKey to get the history of one exercise (weights/reps per session) for progression questions. For plain daily exercise minutes use get_activity.",
  schema: dateRange.extend({
    exerciseKey: z.string().optional().describe("Catalog key, e.g. bench_press — filters to sessions containing it"),
    subjectId: subjectField,
  }),
  risk: "read",
  async run(ctx, input) {
    const subject = await ctx.resolveSubject(input.subjectId);
    const range = clampRange({ from: input.from ?? shiftDay(input.to ?? ctx.today, -13), to: input.to }, ctx.today);
    const tz = ctx.timeZone;
    const from = moment.tz(range.from, "YYYY-MM-DD", tz).toDate();
    const to = moment.tz(range.next, "YYYY-MM-DD", tz).toDate();
    let sessions = await WorkoutService.list(subject.id, { from, to });
    if (input.exerciseKey) sessions = sessions.filter((s) => s.exercises.some((e) => e.exerciseKey === input.exerciseKey));
    const out = sessions.map((s) => ({
      id: s.id,
      date: moment(s.startedAt).tz(tz).format("YYYY-MM-DD"),
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
        sets: fmtSets(e.sets.map((x) => ({ reps: x.reps, weightKg: x.weightKg, durationSec: x.durationSec, distanceM: x.distanceM, toFailure: x.toFailure, isWarmup: x.isWarmup }))),
      })),
    }));
    const result = {
      subject: subject.name,
      from: range.from,
      to: range.to,
      sessions: out.length,
      totalMinutes: out.reduce((a, s) => a + s.durationMin, 0),
      withExercises: out.filter((s) => s.exercises.length).length,
      list: out,
    };
    return { result, cards: out.length ? [{ type: "workouts", title: "Sessions", data: result }] : [] };
  },
});
