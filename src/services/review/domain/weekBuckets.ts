import moment from "moment-timezone";
import { Baseline, isUsable } from "../../signals/domain/baseline";
import { activityByKey } from "../../workouts/domain/activity.catalog";
import { exerciseByKey } from "../../workouts/domain/exercise.catalog";
import { isFullDay, MIN_DAYS, SLEEP_SLACK_MIN, TOLERANCE, type Range, type WeekDay } from "./weekReview";

/**
 * THE WEEKLY SUMMARY'S THREE CARDS (Nov 22 2026, his mockup "Weekly Summary
 * Buckets"): Exercise · Sleep and recovery · Nutrition. Each is a ring, one
 * big number and a few facts, and a status tag. The rules are the review
 * card's (weekReview.ts): a number needs enough of the week behind it (5 of
 * 7), missing data is said, never judged, and a thin week gets no tag.
 *
 * His rulings: the strength/cardio split is ESTIMATED from the exercises'
 * categories (cardio = its minutes; strength and core ≈ 2.5 min per working
 * set; scaled to the session's real length; a watch workout without exercises
 * takes its activity's kind). Tags: Exercise ON PLAN / BEHIND · Sleep ON PLAN /
 * SHORT, BELOW USUAL when HRV was low · Nutrition PROTEIN LOW / OVER / UNDER /
 * ON PLAN · none without enough data. Pure — no I/O.
 */

export type Kind = "strength" | "cardio" | "other";
export type BucketPart = { exerciseKey: string; workSets: number; durationSec: number };
export type BucketSession = { date: string; title: string | null; activityKey: string; minutes: number | null; calories: number | null; done: boolean; planned: boolean; parts: BucketPart[] };
export type BucketNight = { date: string; asleepMinutes: number | null; hrvMs: number | null; restingHr: number | null };
export type BucketWeek = { days: WeekDay[]; nights: BucketNight[]; sessions: BucketSession[] };

export type BucketInput = {
  week: BucketWeek;
  previous: BucketWeek;
  targets: { calories: Range | null; proteinG: Range | null; sleepMinutes: number | null; sessionsPerWeek: number | null };
  baselines: { asleepMinutes: Baseline | null; hrvMs: Baseline | null; restingHr: Baseline | null };
  hasNights: boolean;
};

const STRENGTH_SET_MIN = 2.5;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const present = <T>(v: T | null | undefined): v is T => v !== null && v !== undefined;
const dayName = (date: string) => moment.utc(date, "YYYY-MM-DD").format("ddd").toUpperCase();

/* -------------------------------- exercise -------------------------------- */

const kindOfExercise = (key: string): Kind => {
  const c = exerciseByKey(key)?.category;
  return c === "cardio" ? "cardio" : c === "strength" || c === "core" ? "strength" : "other";
};
const kindOfActivity = (key: string): Kind => {
  const a = activityByKey(key);
  if (a.key === "hiit") return "cardio";
  return a.shape === "strength" ? "strength" : a.shape === "endurance" || a.shape === "sport" ? "cardio" : "other";
};

/** One session's minutes split by kind: estimated from its exercises, scaled to its real length. */
export const splitSession = (s: BucketSession): Record<Kind, number> => {
  const total = s.minutes ?? 0;
  const est: Record<Kind, number> = { strength: 0, cardio: 0, other: 0 };
  for (const p of s.parts) {
    const k = kindOfExercise(p.exerciseKey);
    est[k] += p.durationSec > 0 ? p.durationSec / 60 : p.workSets * (k === "other" ? 1 : STRENGTH_SET_MIN);
  }
  const sum = est.strength + est.cardio + est.other;
  if (!sum) return { strength: 0, cardio: 0, other: 0, [kindOfActivity(s.activityKey)]: total } as Record<Kind, number>;
  const scale = total ? total / sum : 1;
  return { strength: Math.round(est.strength * scale), cardio: Math.round(est.cardio * scale), other: Math.round(est.other * scale) };
};

const mainKind = (split: Record<Kind, number>): Kind => (split.strength >= split.cardio && split.strength >= split.other ? "strength" : split.cardio >= split.other ? "cardio" : "other");

export type ExerciseBucket = {
  tag: "ON PLAN" | "BEHIND" | null;
  done: number;
  outOf: number;
  /** One segment per session (done, by its main kind) and per missed one; the rest of the ring is open. */
  ring: (Kind | "missed")[];
  totalMin: number;
  split: Record<Kind, number>;
  sessions: { date: string; day: string; title: string; minutes: number; split: Record<Kind, number> }[];
  kcal: number | null;
  kcalDelta: number | null;
  sub: string;
};

export function exerciseBucket(input: BucketInput): ExerciseBucket {
  const done = input.week.sessions.filter((s) => s.done).sort((a, b) => a.date.localeCompare(b.date));
  const planned = input.week.sessions.filter((s) => s.planned).length;
  const outOf = planned || input.targets.sessionsPerWeek || 0;
  const sessions = done.map((s) => {
    const split = splitSession(s);
    return { date: s.date, day: dayName(s.date), title: s.title ?? activityByKey(s.activityKey).label, minutes: s.minutes ?? 0, split };
  });
  const split = sessions.reduce((acc, s) => ({ strength: acc.strength + s.split.strength, cardio: acc.cardio + s.split.cardio, other: acc.other + s.split.other }), { strength: 0, cardio: 0, other: 0 });
  const missed = Math.max(0, planned - done.length);
  const kcalOf = (w: BucketWeek) => {
    const xs = w.sessions.filter((s) => s.done && present(s.calories)).map((s) => s.calories!);
    return xs.length ? xs.reduce((a, b) => a + b, 0) : null;
  };
  const kcal = kcalOf(input.week);
  const before = kcalOf(input.previous);
  return {
    tag: outOf ? (done.length >= outOf ? "ON PLAN" : "BEHIND") : null,
    done: done.length,
    outOf,
    ring: [...sessions.map((s) => mainKind(s.split)), ...Array.from({ length: missed }, () => "missed" as const)],
    totalMin: sessions.reduce((a, s) => a + s.minutes, 0),
    split,
    sessions,
    kcal,
    kcalDelta: present(kcal) && present(before) ? kcal - before : null,
    sub: outOf ? `${done.length} / ${outOf} workouts` : done.length ? `${done.length} workout${done.length === 1 ? "" : "s"}` : "None recorded",
  };
}

/* ----------------------------- sleep + recovery ----------------------------- */

export type BandFact = { avg: number; lo: number; hi: number; label: "Inside your usual" | "Below your usual" | "Above your usual" } | { avg: number; lo: null; hi: null; label: null };

const bandFact = (values: number[], b: Baseline | null): BandFact | null => {
  if (values.length < MIN_DAYS) return null;
  const avg = mean(values);
  if (!isUsable(b)) return { avg, lo: null, hi: null, label: null };
  const lo = b!.mean - b!.std;
  const hi = b!.mean + b!.std;
  return { avg, lo, hi, label: avg < lo ? "Below your usual" : avg > hi ? "Above your usual" : "Inside your usual" };
};

export type SleepBucket = {
  /** False = no watch at night ever: the card says so instead of showing empty numbers. */
  hasNights: boolean;
  tag: "ON PLAN" | "SHORT" | "BELOW USUAL" | null;
  recorded: number;
  of: number;
  /** Per night of the week: over the target, under it, or not recorded. */
  ring: ("over" | "under" | "none")[];
  target: number | null;
  overCount: number;
  avgMin: number | null;
  shortest: number | null;
  longest: number | null;
  /** The person's usual sleep, ±1 SD (null until 14 nights). */
  usual: { lo: number; hi: number } | null;
  hrv: BandFact | null;
  restingHr: BandFact | null;
  deltaMin: number | null;
  sub: string;
};

export function sleepBucket(input: BucketInput): SleepBucket {
  const of = input.week.days.length || 7;
  const byDate = new Map(input.week.nights.map((n) => [n.date, n]));
  const target = input.targets.sleepMinutes;
  const mins = input.week.nights.map((n) => n.asleepMinutes).filter(present);
  const enough = mins.length >= MIN_DAYS;
  const avg = enough ? mean(mins) : null;
  const prev = input.previous.nights.map((n) => n.asleepMinutes).filter(present);
  const hrv = bandFact(input.week.nights.map((n) => n.hrvMs).filter(present), input.baselines.hrvMs);
  const restingHr = bandFact(input.week.nights.map((n) => n.restingHr).filter(present), input.baselines.restingHr);
  const b = input.baselines.asleepMinutes;
  const short = present(avg) && !!target && avg < target - SLEEP_SLACK_MIN;
  const tag = !enough ? null : short ? "SHORT" : hrv?.label === "Below your usual" ? "BELOW USUAL" : target ? "ON PLAN" : null;
  return {
    hasNights: input.hasNights,
    tag,
    recorded: mins.length,
    of,
    ring: input.week.days.map((d) => {
      const m = byDate.get(d.date)?.asleepMinutes;
      return !present(m) ? "none" : target && m < target ? "under" : "over";
    }),
    target,
    overCount: target ? mins.filter((m) => m >= target).length : 0,
    avgMin: avg,
    shortest: enough ? Math.min(...mins) : null,
    longest: enough ? Math.max(...mins) : null,
    usual: isUsable(b) ? { lo: b!.mean - b!.std, hi: b!.mean + b!.std } : null,
    hrv,
    restingHr,
    deltaMin: present(avg) && prev.length >= MIN_DAYS ? Math.round(avg - mean(prev)) : null,
    sub: !input.hasNights ? "No watch data at night" : enough ? `${Math.floor(avg! / 60)}:${String(Math.round(avg!) % 60).padStart(2, "0")} a night` : `${mins.length} of ${of} nights recorded`,
  };
}

/* -------------------------------- nutrition -------------------------------- */

export type NutritionBucket = {
  tag: "ON PLAN" | "PROTEIN LOW" | "OVER" | "UNDER" | null;
  logged: number;
  of: number;
  /** Per day: on the targets, off them, part-logged, nothing. */
  ring: ("on" | "off" | "part" | "none")[];
  onTarget: number;
  avgKcal: number | null;
  kcalTarget: number | null;
  pctOfTarget: number | null;
  protein: { avg: number; target: number | null; low: boolean } | null;
  sub: string;
};

const side = (value: number, r: Range, tolerance = TOLERANCE) =>
  present(r.min) && value < r.min * (1 - tolerance) ? -1 : present(r.max) && value > r.max * (1 + tolerance) ? 1 : 0;

export function nutritionBucket(input: BucketInput): NutritionBucket {
  const { calories, proteinG } = input.targets;
  const of = input.week.days.length || 7;
  const full = input.week.days.filter(isFullDay);
  const enough = full.length >= MIN_DAYS;
  const ring = input.week.days.map((d) => {
    if (!d.mealTypes.length) return "none" as const;
    if (!isFullDay(d)) return "part" as const;
    const off = (calories && side(d.calories, calories) !== 0) || (proteinG && side(d.proteinG, { min: proteinG.min, max: null }) < 0);
    return off ? ("off" as const) : ("on" as const);
  });
  const avgKcal = enough ? mean(full.map((d) => d.calories)) : null;
  const avgProt = enough ? mean(full.map((d) => d.proteinG)) : null;
  const kcalTarget = calories ? (present(calories.min) && present(calories.max) ? (calories.min + calories.max) / 2 : calories.min ?? calories.max) : null;
  const protTarget = proteinG ? proteinG.min ?? proteinG.max : null;
  const low = present(avgProt) && !!proteinG && side(avgProt, { min: proteinG.min, max: null }) < 0;
  const kcalSide = present(avgKcal) && calories ? side(avgKcal, calories) : 0;
  const judged = !!calories || !!proteinG;
  return {
    tag: !enough || !judged ? null : low ? "PROTEIN LOW" : kcalSide > 0 ? "OVER" : kcalSide < 0 ? "UNDER" : "ON PLAN",
    logged: full.length,
    of,
    ring,
    onTarget: ring.filter((r) => r === "on").length,
    avgKcal: present(avgKcal) ? Math.round(avgKcal / 10) * 10 : null,
    kcalTarget: present(kcalTarget) ? Math.round(kcalTarget) : null,
    pctOfTarget: present(avgKcal) && kcalTarget ? Math.round((avgKcal / kcalTarget) * 100) : null,
    protein: present(avgProt) ? { avg: Math.round(avgProt), target: present(protTarget) ? Math.round(protTarget) : null, low } : null,
    sub: enough ? `${(Math.round(avgKcal! / 10) * 10).toLocaleString("en-US")} kcal a day` : full.length ? `${full.length} of ${of} days logged` : "Nothing logged this week",
  };
}

export type WeekBuckets = { exercise: ExerciseBucket; sleep: SleepBucket; nutrition: NutritionBucket };
export const buildBuckets = (input: BucketInput): WeekBuckets => ({ exercise: exerciseBucket(input), sleep: sleepBucket(input), nutrition: nutritionBucket(input) });
