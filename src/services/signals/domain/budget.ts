import { detectorBy, suppressedBy } from "./registry";
import { Candidate } from "./types";

/**
 * THE BUDGET — the one knob.
 *
 * Ten detectors cannot be tuned one threshold at a time: tighten one and
 * another starts dominating, and nobody can say what the app's overall noise
 * level is by reading them. So instead every detector reports severity in
 * multiples of its own bar (types.ts), everything competing is ranked on that
 * shared scale, and only the top one is allowed through — at most twice a
 * week. A quiet week then produces silence with nobody deciding it should.
 *
 * Tune these numbers with the replay harness (`npm run signals:replay`), which
 * counts what WOULD have fired over real history. Do not tune them by
 * argument.
 */

/** Notifications a week, all detectors together. */
export const WEEKLY_BUDGET = 2;
/** Nothing below its own bar ever interrupts anyone. */
export const NOTIFY_FLOOR = 1;
/** Good news is worth saying, but not at the price of an ordinary week's
 *  attention: it needs to be further past its bar, and only one can land in a
 *  week (ruling 2026-09-24). */
export const POSITIVE_FLOOR = 1.5;
export const POSITIVE_PER_WEEK = 1;
/** A still-open episode may interrupt a second time only once it has got this
 *  much worse than when it was last mentioned. */
export const ESCALATION_STEP = 1;

export type NotifyState = {
  /** Notifications already sent in the current week. */
  sentThisWeek: { detectorKey: string; direction: Candidate["direction"] }[];
  /** Last notification per detector key, whenever it was. */
  lastNotifiedAt: Record<string, string | undefined>;
  /** Severity at which each key was last notified, for the escalation rule. */
  lastNotifiedSeverity: Record<string, number | undefined>;
  /** Today, YYYY-MM-DD local. */
  today: string;
};

const daysSince = (from: string | undefined, to: string) => (from ? Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) : Infinity);

/** Severity × the detector's clinical weight. The only ordering that exists. */
export const rankOf = (c: Candidate) => c.severity * (detectorBy(c.detectorKey)?.weight ?? 1);

export type Decision = { candidate: Candidate; notify: boolean; reason: string };

/**
 * Every candidate is RECORDED whatever happens here — the record is not the
 * notification (ruling 2026-09-24). This only decides what is worth
 * interrupting someone for.
 */
export const decide = (candidates: Candidate[], state: NotifyState): Decision[] => {
  const silenced = suppressedBy(candidates.map((c) => c.detectorKey));
  const ranked = [...candidates].sort((a, b) => rankOf(b) - rankOf(a));
  let room = WEEKLY_BUDGET - state.sentThisWeek.length;
  let positiveRoom = POSITIVE_PER_WEEK - state.sentThisWeek.filter((s) => s.direction === "POSITIVE").length;
  const out: Decision[] = [];

  for (const candidate of ranked) {
    const detector = detectorBy(candidate.detectorKey);
    const positive = candidate.direction === "POSITIVE";
    const last = state.lastNotifiedAt[candidate.detectorKey];
    const since = daysSince(last, state.today);
    const previous = state.lastNotifiedSeverity[candidate.detectorKey];

    /**
     * A cooldown exists to stop the same news being repeated — NOT to hide
     * worse news. The replay harness caught this on the first run: a marginal
     * 1.3σ dip silenced a 4.3σ one nine days later, which is the opposite of
     * what anyone wants. So a candidate that has got materially worse than
     * when it was last mentioned overrides its own cooldown, and the budget,
     * the floor and the suppression rules still hold.
     */
    const escalated = previous != null && candidate.severity >= previous + ESCALATION_STEP;

    const reason = silenced.has(candidate.detectorKey)
      ? "suppressed by a higher-order signal"
      : candidate.severity < (positive ? POSITIVE_FLOOR : NOTIFY_FLOOR)
      ? "below the floor"
      : room <= 0
      ? "weekly budget spent"
      : positive && positiveRoom <= 0
      ? "positive already sent this week"
      : escalated
      ? ""
      : since < (detector?.cooldownDays ?? 14)
      ? `cooldown (${since}d of ${detector?.cooldownDays}d)`
      : // Same episode, already mentioned and no worse: nothing new to say.
      previous != null
      ? "already mentioned, not materially worse"
      : "";

    const notify = reason === "";
    if (notify) {
      room -= 1;
      if (positive) positiveRoom -= 1;
    }
    out.push({ candidate, notify, reason: notify ? "top-ranked, within budget" : reason });
  }
  return out;
};
