import moment from "moment-timezone";
import { SignalInput } from "../domain/types";

/**
 * A planted history for `--demo`: ninety days of ordinary life with three
 * things deliberately buried in it — a four-night recovery dip, a fortnight of
 * half-done training, and a five-day logging gap.
 *
 * It is a smoke test, NOT calibration. Real tuning needs real nights; this
 * only answers "does the engine find what is definitely there, and stay quiet
 * the rest of the time".
 */

/** Deterministic noise, so a run is reproducible and a diff in the output
 *  means a change in the rules rather than a change in the dice. */
const rng = (seed: number) => () => {
  seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
  return seed / 2 ** 31;
};

export const synthetic = (days = 90, timeZone = "America/New_York"): SignalInput => {
  const random = rng(7);
  const end = moment.tz("2026-09-24", timeZone);
  const start = end.clone().subtract(days - 1, "days");
  const dayKeys: string[] = [];
  for (let c = start.clone(); c.format("YYYY-MM-DD") <= end.format("YYYY-MM-DD"); c.add(1, "day")) dayKeys.push(c.format("YYYY-MM-DD"));

  const dipStart = days - 6; // a dip four nights ago, still running
  const gapStart = days - 40; // a logging gap well in the past
  const nights = dayKeys.map((date, i) => {
    const dipping = i >= dipStart && i < dipStart + 4;
    return {
      date,
      asleepMinutes: Math.round(430 + (random() - 0.5) * 50 - (dipping ? 40 : 0)),
      hrvMs: Math.round(52 + (random() - 0.5) * 8 - (dipping ? 14 : 0)),
      sleepingHr: Math.round(54 + (random() - 0.5) * 4 + (dipping ? 6 : 0)),
      restingHr: Math.round(58 + (random() - 0.5) * 4 + (dipping ? 5 : 0)),
      respiratoryRate: Math.round((14 + (random() - 0.5) * 1.5) * 10) / 10,
      wristTempC: Math.round((33.5 + (random() - 0.5) * 0.4) * 10) / 10,
    };
  });

  const days_ = dayKeys.map((date, i) => {
    const gap = i >= gapStart && i < gapStart + 5;
    return { date, logged: !gap, calories: gap ? null : Math.round(1900 + (random() - 0.5) * 400), proteinG: gap ? null : Math.round(120 + (random() - 0.5) * 40) };
  });

  // Four sessions a week, except a fortnight in the middle at one a week.
  const driftStart = days - 35;
  const workouts = dayKeys
    .map((date, i) => ({ date, i }))
    .filter(({ i }) => {
      const drifting = i >= driftStart && i < driftStart + 14;
      return drifting ? i % 7 === 0 : i % 7 === 0 || i % 7 === 2 || i % 7 === 4 || i % 7 === 5;
    })
    .map(({ date }) => ({ date, status: "COMPLETED" as const, minutes: 45 }));

  return {
    patientId: "demo",
    today: dayKeys[dayKeys.length - 1],
    timeZone,
    nights,
    days: days_,
    workouts,
    weights: [],
    plan: { sleepMinutes: 450, sessionsPerWeek: 4, proteinG: 140, calories: 2000, weightRateKgPerWeek: null },
    openFindings: [],
  };
};
