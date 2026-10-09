import { baselinesBefore, isUsable, NightRow, zOf } from "../baseline";
import { baselineJson, Candidate, Detector, lastN, round, SignalInput } from "../types";

/**
 * Overnight detectors. Both judge a night against the patient's OWN usual —
 * HRV and heart rate vary far too much between people for an absolute number
 * to mean anything, which is the same reason the readiness card says "below
 * your usual" instead of a figure.
 *
 * Two rules keep these from firing on noise:
 *  - PERSISTENCE. A single off night is Tuesday, not a signal. Three nights
 *    running is the bar.
 *  - THE BASELINE EXCLUDES THE NIGHT IT JUDGES (and every night after it), so
 *    a long bad run cannot quietly become the new normal and silence itself.
 */

/** Nights in a row a vital must be off before it counts. */
const RUN_NIGHTS = 3;
/** Sigma from the usual that counts as "off" — the same cut-off the card
 *  uses for its "below usual" label, so the two can never disagree. */
const BAR_SIGMA = 1;

/** "a", "a and b", "a, b and c". */
const listOf = (parts: string[]) => (parts.length < 2 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`);

type Watched = { key: "hrvMs" | "sleepingHr" | "restingHr"; /** the bad direction */ sign: -1 | 1; label: string };

const WATCHED: Watched[] = [
  { key: "hrvMs", sign: -1, label: "HRV" },
  { key: "sleepingHr", sign: 1, label: "sleeping heart rate" },
  { key: "restingHr", sign: 1, label: "resting heart rate" },
];

/** Mean |z| across the run when the vital is off on EVERY night of it, else null. */
const runSeverity = (nights: NightRow[], w: Watched): number | null => {
  const run = lastN(nights, RUN_NIGHTS);
  if (run.length < RUN_NIGHTS) return null;
  let total = 0;
  for (const night of run) {
    const value = night[w.key];
    if (value == null) return null;
    const usual = baselinesBefore(nights, night.date)[w.key];
    if (!isUsable(usual)) return null;
    const z = zOf(value, usual) * w.sign; // positive = in the bad direction
    if (z < BAR_SIGMA) return null;
    total += z;
  }
  return total / run.length;
};

/**
 * RECOVERY DIP — HRV down, or heart rate up, for three nights running.
 * Two vitals agreeing is the stronger sign (a cold, a hard training block,
 * alcohol, a fever coming), so it gets a bump rather than a second
 * notification about the same night.
 */
export const recoveryDip: Detector = {
  key: "recovery.dip",
  version: 1,
  weight: 1.2,
  resolveAfterDays: 3,
  cooldownDays: 14,
  against: "usual",
  run: ({ nights }: SignalInput): Candidate | null => {
    const hits = WATCHED.map((w) => ({ w, severity: runSeverity(nights, w) })).filter((h): h is { w: Watched; severity: number } => h.severity != null);
    if (!hits.length) return null;
    hits.sort((a, b) => b.severity - a.severity);
    const worst = hits[0];
    const agreement = hits.length > 1 ? 0.5 : 0;
    const run = lastN(nights, RUN_NIGHTS);
    const usual = baselinesBefore(nights, run[0].date)[worst.w.key];
    return {
      detectorKey: "recovery.dip",
      detectorVersion: 1,
      direction: "CONCERN",
      severity: round(worst.severity / BAR_SIGMA + agreement),
      evidence: {
        nights: run.map((n) => ({ date: n.date, hrvMs: n.hrvMs ?? null, sleepingHr: n.sleepingHr ?? null, restingHr: n.restingHr ?? null })),
        vitals: hits.map((h) => ({ vital: h.w.key, meanSigma: round(h.severity) })),
      },
      baseline: { vital: worst.w.key, ...baselineJson(usual) },
      label: `${listOf(hits.map((h) => h.w.label))} away from usual ${RUN_NIGHTS} nights running (worst ${round(worst.severity)}σ)`,
    };
  },
};

/**
 * RECOVERY RESTORED — the positive counterpart: every watched vital back
 * inside the usual band for three nights while a dip is still open. Held to a
 * higher bar than a concern by the budget, not here (ruling 2026-09-24).
 */
export const recoveryRestored: Detector = {
  key: "recovery.restored",
  version: 1,
  weight: 0.8,
  resolveAfterDays: 1,
  cooldownDays: 30,
  against: "usual",
  run: ({ nights, openFindings }: SignalInput): Candidate | null => {
    const dip = openFindings.find((f) => f.detectorKey === "recovery.dip");
    if (!dip) return null;
    const run = lastN(nights, RUN_NIGHTS);
    if (run.length < RUN_NIGHTS) return null;
    for (const night of run) {
      for (const w of WATCHED) {
        const value = night[w.key];
        if (value == null) continue;
        const usual = baselinesBefore(nights, night.date)[w.key];
        if (!isUsable(usual)) continue;
        if (zOf(value, usual) * w.sign >= BAR_SIGMA) return null; // still off
      }
    }
    return {
      detectorKey: "recovery.restored",
      detectorVersion: 1,
      direction: "POSITIVE",
      severity: round(1 + Math.max(0, dip.peakSeverity - 1) / 2),
      evidence: { nights: run.map((n) => ({ date: n.date, hrvMs: n.hrvMs ?? null, sleepingHr: n.sleepingHr ?? null, restingHr: n.restingHr ?? null })), afterDipSince: dip.firstDetectedAt, dipPeakSeverity: dip.peakSeverity },
      baseline: null,
      label: `back inside usual on every overnight vital for ${RUN_NIGHTS} nights`,
    };
  },
};

/**
 * SLEEP DEBT — short of the plan's sleep target on three of the last four
 * nights. Judged against the TARGET, not the usual: someone who habitually
 * sleeps six hours has a usual that already is the problem.
 */
const SHORT_BY_MINUTES = 45;

export const sleepDebt: Detector = {
  key: "sleep.debt",
  version: 1,
  weight: 1,
  resolveAfterDays: 3,
  cooldownDays: 10,
  against: "plan",
  run: ({ nights, plan }: SignalInput): Candidate | null => {
    const target = plan?.sleepMinutes ?? null;
    if (!target) return null;
    const window = lastN(nights, 4).filter((n) => n.asleepMinutes != null);
    if (window.length < 4) return null;
    const short = window.filter((n) => (n.asleepMinutes as number) < target - SHORT_BY_MINUTES);
    if (short.length < 3) return null;
    const meanShortfall = short.reduce((acc, n) => acc + (target - (n.asleepMinutes as number)), 0) / short.length;
    return {
      detectorKey: "sleep.debt",
      detectorVersion: 1,
      direction: "CONCERN",
      severity: round(meanShortfall / SHORT_BY_MINUTES),
      evidence: { targetMinutes: target, nights: window.map((n) => ({ date: n.date, asleepMinutes: n.asleepMinutes ?? null })), shortNights: short.length, meanShortfallMinutes: Math.round(meanShortfall) },
      baseline: { targetMinutes: target, shortByMinutes: SHORT_BY_MINUTES },
      label: `${short.length} of ${window.length} nights short of the ${Math.round(target / 60)}h target by ${Math.round(meanShortfall)} min on average`,
    };
  },
};
