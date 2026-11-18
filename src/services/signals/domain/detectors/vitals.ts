import { baselinesBefore, isUsable, NightRow, zOf } from "../baseline";
import { baselineJson, Candidate, dayBefore, Detector, lastN, round, SignalInput } from "../types";

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
export const RUN_NIGHTS = 3;
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

/** A night counts as recent when it ended today or yesterday: the scan runs at
 *  09:00 and last night may not have reached the server yet. */
const FRESH_NIGHT_DAYS = 1;

/** The newest night carrying any watched vital, if it is recent. */
export const latestVitalNight = (nights: NightRow[], today: string): string | null => {
  for (let i = nights.length - 1; i >= 0; i--) {
    const n = nights[i];
    if (n.hrvMs == null && n.sleepingHr == null && n.restingHr == null) continue;
    return n.date >= dayBefore(today, FRESH_NIGHT_DAYS) && n.date <= today ? n.date : null;
  }
  return null;
};

/**
 * The last `count` nights as CONSECUTIVE calendar nights ending on the newest
 * recent night, or null when one is missing. Rows are only stored for nights
 * that were uploaded, so `lastN` alone read "three nights running" across gaps
 * and, with no new uploads, kept judging the same old nights every morning.
 */
export const recentRun = (nights: NightRow[], today: string, count = RUN_NIGHTS): NightRow[] | null => {
  const end = latestVitalNight(nights, today);
  if (!end) return null;
  const byDate = new Map(nights.map((n) => [n.date, n]));
  const run: NightRow[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const night = byDate.get(dayBefore(end, i));
    if (!night) return null;
    run.push(night);
  }
  return run;
};

/** Mean |z| across the run when the vital is off on EVERY night of it, else null. */
const runSeverity = (nights: NightRow[], today: string, w: Watched): number | null => {
  const run = recentRun(nights, today);
  if (!run) return null;
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
 * Is one night inside the usual on every watched vital that can be judged?
 * "Off" is the same cut-off the dip itself uses (BAR_SIGMA, bad direction
 * only), so a night drawn amber on the Signals chart is exactly a night that
 * does not count toward "back to your usual". null when nothing could be
 * judged (no vitals, or no usable baseline yet).
 */
export const nightInside = (nights: NightRow[], date: string): boolean | null => {
  const night = nights.find((n) => n.date === date);
  if (!night) return null;
  const usual = baselinesBefore(nights, date);
  let judged = false;
  for (const w of WATCHED) {
    const value = night[w.key];
    if (value == null || !isUsable(usual[w.key])) continue;
    judged = true;
    if (zOf(value, usual[w.key]) * w.sign >= BAR_SIGMA) return false;
  }
  return judged ? true : null;
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
  domain: "health",
  dataAsOf: ({ nights, today }) => latestVitalNight(nights, today),
  insideUsual: ({ nights, today }) => {
    const latest = latestVitalNight(nights, today);
    return latest ? nightInside(nights, latest) : null;
  },
  run: ({ nights, today }: SignalInput): Candidate | null => {
    const hits = WATCHED.map((w) => ({ w, severity: runSeverity(nights, today, w) })).filter((h): h is { w: Watched; severity: number } => h.severity != null);
    if (!hits.length) return null;
    hits.sort((a, b) => b.severity - a.severity);
    const worst = hits[0];
    const agreement = hits.length > 1 ? 0.5 : 0;
    const run = recentRun(nights, today) as NightRow[];
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
 * RETIRED Nov 16 2026 — no longer run. "Back to your usual" is now the
 * follow-up of the dip's own episode closing (signals/domain/followups.ts),
 * so the same news cannot arrive twice. Kept registered as retired so the
 * rows it wrote still describe and still count as health findings.
 *
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
  domain: "health",
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
  domain: "habit",
  dataAsOf: ({ nights, today }) => {
    const last = [...nights].reverse().find((n) => n.asleepMinutes != null);
    return last && last.date >= dayBefore(today, FRESH_NIGHT_DAYS) ? last.date : null;
  },
  run: ({ nights, plan, today }: SignalInput): Candidate | null => {
    const target = plan?.sleepMinutes ?? null;
    if (!target) return null;
    const window = lastN(nights, 4).filter((n) => n.asleepMinutes != null);
    if (window.length < 4) return null;
    // Old nights are not this week's sleep: the newest must be recent.
    if (window[window.length - 1].date < dayBefore(today, FRESH_NIGHT_DAYS)) return null;
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
