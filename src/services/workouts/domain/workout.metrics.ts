/**
 * Pure derivations over a session: volume, calorie estimate, one-line summary.
 */
import { activityByKey } from "./activity.catalog";
import type { ExerciseInput, SessionInput } from "./workout.schema";

export const ZONE_LABELS = ["Easy", "Steady", "Moderate", "Hard", "Peak"] as const;

/** MET-based estimate when there is no watch. Null without a body weight. */
export const estimateCalories = (activityKey: string, durationSec: number, weightKg: number | null | undefined) => {
  if (!weightKg || weightKg <= 0) return null;
  const met = activityByKey(activityKey).met;
  return Math.round(met * weightKg * (durationSec / 3600));
};

export const toKg = (value: number | null | undefined, unit: string | null | undefined) => {
  if (value == null || !isFinite(value)) return null;
  return /lb/i.test(unit ?? "") ? value * 0.45359237 : value;
};

/** Total reps × kg across working sets. */
export const tonnage = (exercises: ExerciseInput[]) =>
  Math.round(exercises.reduce((a, e) => a + e.sets.filter((s) => !s.isWarmup).reduce((b, s) => b + (s.reps ?? 0) * (s.weightKg ?? 0), 0), 0));

export const workingSets = (exercises: ExerciseInput[]) => exercises.reduce((a, e) => a + e.sets.filter((s) => !s.isWarmup).length, 0);

export const fmtDuration = (sec: number) => {
  const m = Math.round(sec / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}`;
};

/** "4×8 @ 70 kg" style rendering of one exercise's sets, grouped when equal. */
export const fmtSets = (sets: ExerciseInput["sets"]) => {
  const work = sets.filter((s) => !s.isWarmup);
  if (!work.length) return "";
  const groups: { label: string; n: number }[] = [];
  for (const s of work) {
    const label = s.durationSec && !s.reps ? `${s.durationSec}s` : s.distanceM && !s.reps ? `${s.distanceM} m` : `${s.reps ?? ""}${s.weightKg ? ` @ ${trim(s.weightKg)} kg` : ""}${s.toFailure ? " to failure" : ""}`.trim() || "?";
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.n += 1;
    else groups.push({ label, n: 1 });
  }
  return groups.map((g) => `${g.n}×${/^\d/.test(g.label) ? "" : " "}${g.label}`).join(", ");
};

const trim = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ""));

/** One line for the proposal summary and the model. */
export const summarizeSession = (s: SessionInput, calories: number | null) => {
  const a = activityByKey(s.activityKey);
  const parts = [s.title ?? a.label, fmtDuration(s.durationSec)];
  if (s.exercises.length) parts.push(`${s.exercises.length} exercise${s.exercises.length === 1 ? "" : "s"}, ${workingSets(s.exercises)} sets`);
  const km = s.watch?.distanceKm ?? s.distanceKm;
  if (km) parts.push(`${km} km`);
  if (calories != null) parts.push(`${calories} kcal${s.watch ? " (watch)" : " (est.)"}`);
  if (s.watch?.avgHr) parts.push(`avg ${s.watch.avgHr} bpm`);
  return parts.join(" · ");
};
