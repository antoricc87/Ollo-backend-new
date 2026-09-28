/**
 * YOUR USUAL, server side — a straight port of the app's
 * `functionalities/readiness/usual.ts`, including the std floors from
 * `nights.ts`. The two MUST agree: the readiness card tells someone their HRV
 * is "below usual" and a signal fires off the same judgement, so a second
 * implementation with a different yardstick would contradict the card.
 *
 * Pure module — no I/O.
 */

export interface Baseline {
  /** Nights with a value. */
  n: number;
  mean: number;
  /** Sample standard deviation, never below the vital's floor. */
  std: number;
}

/** Nights needed before a baseline is scored (same as the app). */
export const MIN_BASELINE_NIGHTS = 5;

export const isUsable = (b: Baseline | null | undefined): boolean => !!b && b.n >= MIN_BASELINE_NIGHTS;

/** The floor keeps a handful of near-identical nights from turning a normal
 *  wobble into "well below usual". */
export const baselineOf = (values: (number | null | undefined)[], stdFloor: number): Baseline => {
  const xs = values.filter((v): v is number => v != null && Number.isFinite(v));
  const n = xs.length;
  if (n === 0) return { n: 0, mean: 0, std: stdFloor };
  const mean = xs.reduce((acc, v) => acc + v, 0) / n;
  const variance = n > 1 ? xs.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (n - 1) : 0;
  return { n, mean, std: Math.max(Math.sqrt(variance), stdFloor) };
};

export const zOf = (value: number, b: Baseline) => (value - b.mean) / b.std;

/** Std-dev floors per vital — same numbers as the app's `nights.ts`. */
export const STD_FLOOR = { asleepMinutes: 20, hrvMs: 5, sleepingHr: 1.5, restingHr: 1.5, wristTempC: 0.1, respiratoryRate: 0.5 } as const;

export type VitalKey = keyof typeof STD_FLOOR;

/** How many nights back the "usual" is drawn from (the app uses 60). */
export const BASELINE_NIGHTS = 60;

export type NightRow = { date: string } & { [K in VitalKey]?: number | null };

/**
 * Baselines from the nights BEFORE `upTo` (exclusive) — a night must never be
 * judged against a usual it is itself part of, or a long run of bad nights
 * quietly becomes the new normal and the signal stops firing.
 */
export const baselinesBefore = (nights: NightRow[], upTo: string, window = BASELINE_NIGHTS): Record<VitalKey, Baseline> => {
  const earlier = nights.filter((n) => n.date < upTo).slice(-window);
  const out = {} as Record<VitalKey, Baseline>;
  for (const key of Object.keys(STD_FLOOR) as VitalKey[]) out[key] = baselineOf(earlier.map((n) => n[key]), STD_FLOOR[key]);
  return out;
};
