/**
 * Text → structured session. This is the ONE place the workouts domain calls
 * the LLM, as a strict-schema service (same pattern as analyzeMeal). The
 * result is normalised in code: catalog resolution, unit conversion, time
 * resolution — the model only transcribes.
 */
import moment from "moment-timezone";
import { getLLM } from "../../agent/llm/openai.client";
import { activityByKey, activityKeyFromText } from "../domain/activity.catalog";
import { canonicalExercise } from "../domain/exercise.catalog";
import type { ExerciseInput, SetInput } from "../domain/workout.schema";
import { buildSystemPrompt, buildUserPrompt } from "./workoutParse.prompt";
import { PARSED_SESSION_SCHEMA, ParsedSession } from "./workoutParse.schema";

export type ParsedWorkout = {
  isWorkout: boolean;
  activityKey: string;
  title: string | null;
  /** Local YYYY-MM-DD, resolved (defaults to today). */
  day: string;
  /** Whether the day came from the user (vs. defaulted). */
  dayStated: boolean;
  startTime: string | null; // HH:mm
  durationSec: number | null;
  rpe: number | null;
  notes: string | null;
  exercises: ExerciseInput[];
  /** Sum of distances the parser found on the session itself (running 5 km…). */
  distanceKm: number | null;
  model: string;
  latencyMs: number;
};

const toSet = (s: ParsedSession["exercises"][number]["sets"][number]): SetInput => ({
  reps: s.reps ?? null,
  weightKg: s.weight == null || s.weightUnit === "none" ? null : s.weightUnit === "lb" ? Math.round(s.weight * 0.45359237 * 10) / 10 : s.weight,
  durationSec: s.durationSec ?? null,
  distanceM: s.distanceM ?? null,
  toFailure: !!s.toFailure,
  isWarmup: !!s.isWarmup,
});

export async function parseWorkout(text: string, opts: { today: string; timeZone: string; model?: string }): Promise<ParsedWorkout> {
  const started = Date.now();
  const llm = getLLM();
  const model = opts.model ?? process.env.WORKOUT_PARSE_MODEL ?? llm.defaultModel;
  const weekday = moment.tz(opts.today, "YYYY-MM-DD", opts.timeZone).format("dddd");
  const raw = await llm.json<ParsedSession>({
    system: buildSystemPrompt(),
    user: buildUserPrompt(text, opts.today, weekday, opts.timeZone),
    schema: PARSED_SESSION_SCHEMA as unknown as Record<string, unknown>,
    schemaName: "workout_session",
    model,
  });

  const dayOk = !!raw.dateReference && /^\d{4}-\d{2}-\d{2}$/.test(raw.dateReference) && raw.dateReference <= opts.today;
  const exercises: ExerciseInput[] = raw.exercises.map((e) => {
    const c = canonicalExercise(e.name, e.exerciseKey);
    return {
      exerciseKey: c.key,
      name: c.def ? c.def.name : c.name,
      muscleGroup: c.def?.muscleGroup ?? null,
      equipment: c.def?.equipment ?? null,
      notes: e.notes ?? null,
      sets: e.sets.map(toSet),
    };
  });
  const activityKey = raw.activityKey || activityKeyFromText(text) || (exercises.length ? "strength" : "other");
  // Endurance/sport sessions: "ran 5k" is the session, not an exercise inside
  // it. Fold set-less distance/duration rows into the session distance.
  let distanceKm: number | null = null;
  let kept = exercises;
  if (activityByKey(activityKey).shape !== "strength") {
    const isSelf = (e: ExerciseInput) => e.sets.every((s) => s.reps == null && s.weightKg == null);
    const folded = exercises.filter(isSelf);
    const metres = folded.reduce((a, e) => a + e.sets.reduce((b, s) => b + (s.distanceM ?? 0), 0), 0);
    if (metres > 0) distanceKm = Math.round(metres / 10) / 100;
    kept = exercises.filter((e) => !isSelf(e));
  }
  return {
    isWorkout: raw.isWorkout,
    activityKey,
    title: raw.title?.trim() || null,
    day: dayOk ? raw.dateReference! : opts.today,
    dayStated: dayOk,
    startTime: raw.startTime && /^\d{2}:\d{2}$/.test(raw.startTime) ? raw.startTime : null,
    durationSec: raw.durationMinutes ? Math.max(60, raw.durationMinutes * 60) : null,
    rpe: raw.rpe ?? null,
    notes: raw.notes?.trim() || null,
    exercises: kept,
    distanceKm,
    model,
    latencyMs: Date.now() - started,
  };
}
