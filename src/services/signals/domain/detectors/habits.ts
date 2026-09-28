import { Candidate, DayRow, Detector, daysBetween, lastN, round, SignalInput, WorkoutRow } from "../types";

/**
 * Training, logging, nutrition and weight — the detectors judged against the
 * PLAN rather than against a personal baseline. No plan target, no signal:
 * "you did not train this week" is only worth saying to someone who meant to.
 *
 * These need no warm-up period, which makes them the ones that work on day one
 * while the overnight baselines are still filling up.
 */

const completedIn = (workouts: WorkoutRow[], from: string, to: string) => workouts.filter((w) => w.status === "COMPLETED" && w.date >= from && w.date <= to);

const shiftDay = (date: string, days: number) => new Date(Date.parse(date) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * TRAINING STOPPED — a full week with nothing done, for someone whose plan
 * asks for two or more sessions. Severity grows with the drought rather than
 * sitting at 1.0 forever, so a third silent week outranks the first.
 */
export const trainingStopped: Detector = {
  key: "training.stopped",
  version: 1,
  weight: 1,
  resolveAfterDays: 1,
  cooldownDays: 14,
  run: ({ workouts, plan, today }: SignalInput): Candidate | null => {
    const target = plan?.sessionsPerWeek ?? 0;
    if (target < 2) return null;
    const weekStart = shiftDay(today, -6);
    if (completedIn(workouts, weekStart, today).length > 0) return null;
    const last = workouts.filter((w) => w.status === "COMPLETED" && w.date <= today).sort((a, b) => a.date.localeCompare(b.date)).pop();
    // Never trained at all is real, but it is a different conversation from
    // stopping — don't let an empty history score as an endless drought.
    const days = last ? daysBetween(last.date, today) : 10;
    return {
      detectorKey: "training.stopped",
      detectorVersion: 1,
      direction: "CONCERN",
      severity: round(Math.min(days / 7, 4)),
      evidence: { sessionsPerWeekTarget: target, lastCompleted: last?.date ?? null, daysSince: last ? days : null, windowFrom: weekStart, windowTo: today },
      baseline: { sessionsPerWeekTarget: target },
      label: last ? `no session in ${days} days (plan asks ${target}/week)` : `no session on record, plan asks ${target}/week`,
    };
  },
};

/**
 * TRAINING DRIFTING — at or under half the planned sessions two weeks running.
 * Catches the slide that `training.stopped` never sees, because doing one
 * session a week forever is not a drought.
 */
export const trainingDrifting: Detector = {
  key: "training.drifting",
  version: 1,
  weight: 0.9,
  resolveAfterDays: 7,
  cooldownDays: 21,
  run: ({ workouts, plan, today }: SignalInput): Candidate | null => {
    const target = plan?.sessionsPerWeek ?? 0;
    if (target < 2) return null;
    const weeks = [0, 1].map((back) => {
      const to = shiftDay(today, -7 * back);
      const from = shiftDay(to, -6);
      return { from, to, done: completedIn(workouts, from, to).length };
    });
    if (weeks.some((w) => w.done / target > 0.5)) return null;
    if (weeks.every((w) => w.done === 0)) return null; // that is `training.stopped`
    const meanRatio = weeks.reduce((acc, w) => acc + w.done / target, 0) / weeks.length;
    return {
      detectorKey: "training.drifting",
      detectorVersion: 1,
      direction: "CONCERN",
      severity: round((1 - meanRatio) / 0.5),
      evidence: { sessionsPerWeekTarget: target, weeks },
      baseline: { sessionsPerWeekTarget: target },
      label: `${weeks.map((w) => w.done).join(" and ")} of ${target} sessions over two weeks`,
    };
  },
};

/**
 * TRAINING CONSISTENT — the positive one: the plan's sessions met or beaten
 * three weeks running. Deliberately hard to trigger; the budget holds positives
 * to a higher bar again on top of this.
 */
export const trainingConsistent: Detector = {
  key: "training.consistent",
  version: 1,
  weight: 0.7,
  resolveAfterDays: 7,
  cooldownDays: 42,
  run: ({ workouts, plan, today }: SignalInput): Candidate | null => {
    const target = plan?.sessionsPerWeek ?? 0;
    if (target < 2) return null;
    const weeks = [0, 1, 2].map((back) => {
      const to = shiftDay(today, -7 * back);
      const from = shiftDay(to, -6);
      return { from, to, done: completedIn(workouts, from, to).length };
    });
    if (weeks.some((w) => w.done < target)) return null;
    return {
      detectorKey: "training.consistent",
      detectorVersion: 1,
      direction: "POSITIVE",
      severity: round(weeks.reduce((acc, w) => acc + w.done / target, 0) / weeks.length),
      evidence: { sessionsPerWeekTarget: target, weeks },
      baseline: { sessionsPerWeekTarget: target },
      label: `${target}+ sessions three weeks running`,
    };
  },
};

/**
 * LOGGING STOPPED — three days with nothing logged. This one is about the APP,
 * not the body: it says the data went dark, so the tone must stay away from
 * anything that sounds like a health claim, and every other nutrition detector
 * has to stand down while it is true (you cannot be short of protein on days
 * nobody recorded).
 */
const GAP_DAYS = 3;

export const loggingStopped: Detector = {
  key: "logging.stopped",
  version: 1,
  weight: 0.8,
  resolveAfterDays: 1,
  cooldownDays: 7,
  run: ({ days }: SignalInput): Candidate | null => {
    let streak = 0;
    for (let i = days.length - 1; i >= 0 && !days[i].logged; i--) streak += 1;
    if (streak < GAP_DAYS) return null;
    return {
      detectorKey: "logging.stopped",
      detectorVersion: 1,
      direction: "CONCERN",
      // Capped like `training.stopped`: a month of silence and a year of it are
      // the same message, and an unbounded score would outrank every real
      // clinical signal on the shared scale forever.
      severity: round(Math.min(streak / GAP_DAYS, 4)),
      evidence: { consecutiveDaysUnlogged: streak, lastLogged: days.filter((d) => d.logged).pop()?.date ?? null },
      baseline: { gapDays: GAP_DAYS },
      label: `nothing logged for ${streak} days`,
    };
  },
};

/** Days that actually carry a number — the only ones a nutrition rule may judge. */
const loggedDays = (days: DayRow[], count: number) => lastN(days, count).filter((d) => d.logged && d.proteinG != null);

/**
 * PROTEIN SHORT — under 80% of the plan's protein target on five of seven
 * logged days. Needs five logged days to say anything at all; below that
 * `logging.stopped` is the honest signal, not this.
 */
const PROTEIN_BAR = 0.8;

export const proteinShort: Detector = {
  key: "nutrition.protein_short",
  version: 1,
  weight: 0.9,
  resolveAfterDays: 4,
  cooldownDays: 14,
  run: ({ days, plan }: SignalInput): Candidate | null => {
    const target = plan?.proteinG ?? null;
    if (!target) return null;
    const window = loggedDays(days, 7);
    if (window.length < 5) return null;
    const short = window.filter((d) => (d.proteinG as number) < target * PROTEIN_BAR);
    if (short.length < 5) return null;
    const meanRatio = short.reduce((acc, d) => acc + (d.proteinG as number) / target, 0) / short.length;
    return {
      detectorKey: "nutrition.protein_short",
      detectorVersion: 1,
      direction: "CONCERN",
      severity: round((1 - meanRatio) / (1 - PROTEIN_BAR)),
      evidence: { targetG: target, loggedDays: window.length, shortDays: short.length, meanG: Math.round(short.reduce((acc, d) => acc + (d.proteinG as number), 0) / short.length) },
      baseline: { targetG: target, barFraction: PROTEIN_BAR },
      label: `${short.length} of ${window.length} logged days under ${Math.round(target * PROTEIN_BAR)}g protein`,
    };
  },
};

/**
 * WEIGHT OFF TRACK — the trend over three weeks against the rate the plan is
 * aiming for. The bar is a deviation of TWICE the target rate (so a plan
 * aiming at −0.5 kg/wk fires at −1.5 or +0.5), and moving the wrong way
 * always counts however small.
 */
export const weightOffTrack: Detector = {
  key: "weight.off_track",
  version: 1,
  weight: 1,
  resolveAfterDays: 7,
  cooldownDays: 21,
  run: ({ weights, plan, today }: SignalInput): Candidate | null => {
    const target = plan?.weightRateKgPerWeek ?? null;
    if (target == null || target === 0) return null;
    const window = weights.filter((w) => w.date >= shiftDay(today, -20) && w.date <= today).sort((a, b) => a.date.localeCompare(b.date));
    if (window.length < 2) return null;
    const first = window[0];
    const last = window[window.length - 1];
    const span = daysBetween(first.date, last.date);
    if (span < 14) return null;
    const observed = ((last.kg - first.kg) / span) * 7;
    const deviation = Math.abs(observed - target);
    const wrongWay = Math.sign(observed) !== 0 && Math.sign(observed) !== Math.sign(target);
    const severity = deviation / (2 * Math.abs(target));
    if (severity < 1 && !wrongWay) return null;
    return {
      detectorKey: "weight.off_track",
      detectorVersion: 1,
      direction: "CONCERN",
      severity: round(Math.max(severity, wrongWay ? 1 : 0)),
      evidence: { targetKgPerWeek: target, observedKgPerWeek: round(observed), from: first, to: last, spanDays: span, wrongDirection: wrongWay },
      baseline: { targetKgPerWeek: target },
      label: `weight moving ${round(observed)} kg/week against a plan of ${target} kg/week`,
    };
  },
};
