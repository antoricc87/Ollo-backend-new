import { baselinesBefore, isUsable, NightRow, zOf } from "./baseline";
import { round } from "./types";

/**
 * LAST NIGHT, AGAINST YOUR USUAL — one night, judged the way the readiness
 * card labels its cells: a vital one standard deviation or more in the bad
 * direction is "below usual" (HRV) / "above usual" (sleeping heart rate).
 * Same baselines (baseline.ts is a port of the app's), same cut-off, so the
 * card and a note built on this can never disagree.
 *
 * This is NOT a signal: one night is not a pattern (vitals.ts waits for
 * three). It only decides whether today's planned session gets a lighter
 * alternative next to it. Pure.
 */

export const LOW_SIGMA = 1;

export type LowVital = { vital: "hrvMs" | "sleepingHr"; value: number; usual: number; sigma: number };
export type LastNightLow = { date: string; low: LowVital[] };

const WATCHED: { key: LowVital["vital"]; sign: -1 | 1 }[] = [
  { key: "hrvMs", sign: -1 },
  { key: "sleepingHr", sign: 1 },
];

/** Null unless the night of `today` (the morning they woke up) exists and at least one vital is off. */
export const lastNightLow = (nights: NightRow[], today: string): LastNightLow | null => {
  const night = nights.find((n) => n.date === today);
  if (!night) return null;
  const usual = baselinesBefore(nights, today);
  const low: LowVital[] = [];
  for (const w of WATCHED) {
    const value = night[w.key];
    if (value == null || !isUsable(usual[w.key])) continue;
    const z = zOf(value, usual[w.key]) * w.sign;
    if (z >= LOW_SIGMA) low.push({ vital: w.key, value: round(value, 0), usual: round(usual[w.key].mean, 0), sigma: round(z, 1) });
  }
  return low.length ? { date: today, low } : null;
};
