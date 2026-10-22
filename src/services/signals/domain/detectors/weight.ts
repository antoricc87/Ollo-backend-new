import { Candidate, Detector, daysBetween, round, SignalInput } from "../types";

/**
 * WEIGHT CHANGED SUBSTANTIALLY — a HEALTH finding (user ruling Oct 12 2026):
 * body weight against the person's own recent weight, whatever their plan
 * says. `weight.off_track` in habits.ts is the other question (the pace a plan
 * aims for) and stays a habit.
 *
 * Fires on a change of CHANGE_BAR (5%) or more between the latest weigh-in and
 * one 14–30 days before it — the earliest in that window, so a slow slide over
 * the month is seen whole. Two weigh-ins that far apart are the minimum: one
 * odd reading, or two on consecutive days, say nothing. Loss and gain both
 * count. A weight-loss plan does not silence it (5% in a month is fast even
 * then); the evidence says the plan aims for loss so the row can say so.
 *
 * ⚠ The bar is drafted, not clinical guidance: the usual clinical reference
 * is UNINTENDED loss of 5% over 6–12 months. On the clinical-review list.
 */
export const CHANGE_BAR = 0.05;
const WINDOW_DAYS = 30;
const MIN_SPAN_DAYS = 14;
/** The latest weigh-in has to be recent, or the finding describes a month long gone. */
const FRESH_DAYS = 10;
const KG_PER_LB = 0.453_592;
/** One decimal: these figures are read by a person, not compared. */
const r1 = (n: number) => Math.round(n * 10) / 10;

export const weightChange: Detector = {
  key: "weight.change",
  version: 1,
  weight: 1.2,
  resolveAfterDays: 7,
  cooldownDays: 30,
  against: "usual",
  domain: "health",
  run: ({ weights, plan, today, weightUnit }: SignalInput): Candidate | null => {
    const sorted = [...weights].sort((a, b) => a.date.localeCompare(b.date));
    const latest = sorted[sorted.length - 1];
    if (!latest || daysBetween(latest.date, today) > FRESH_DAYS) return null;
    const reference = sorted.find((w) => {
      const span = daysBetween(w.date, latest.date);
      return span >= MIN_SPAN_DAYS && span <= WINDOW_DAYS;
    });
    if (!reference || reference.kg <= 0) return null;
    const fraction = (latest.kg - reference.kg) / reference.kg;
    if (Math.abs(fraction) < CHANGE_BAR) return null;
    const unit = weightUnit === "lb" ? "lb" : "kg";
    const inUnit = (kg: number) => r1(unit === "lb" ? kg / KG_PER_LB : kg);
    const days = daysBetween(reference.date, latest.date);
    return {
      detectorKey: "weight.change",
      detectorVersion: 1,
      direction: "CONCERN",
      severity: round(Math.min(Math.abs(fraction) / CHANGE_BAR, 4)),
      evidence: {
        direction: fraction < 0 ? "down" : "up",
        change: Math.abs(inUnit(latest.kg - reference.kg)),
        changePercent: r1(Math.abs(fraction) * 100),
        unit,
        days,
        from: { date: reference.date, value: inUnit(reference.kg) },
        to: { date: latest.date, value: inUnit(latest.kg) },
        planAimsForLoss: plan?.outcome === "LOSE_WEIGHT",
      },
      baseline: { reference: inUnit(reference.kg), unit, on: reference.date, barPercent: CHANGE_BAR * 100 },
      label: `weight ${fraction < 0 ? "down" : "up"} ${r1(Math.abs(fraction) * 100)}% in ${days} days`,
    };
  },
};
