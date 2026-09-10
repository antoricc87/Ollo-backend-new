import { EncounterState } from "./types";

/**
 * The follow-up loop: does this episode need checking on, and what does its
 * trajectory look like?
 *
 * COMPLIANCE, carefully. Escalation is one-way, so raising concern because
 * something has dragged on is allowed and useful. What is NOT allowed is the
 * reason: we may say "you've told me it's the same or worse for ten days"
 * (REFLECT) and "here's how to get it looked at" (ROUTE). We may never say
 * what that means, how serious it is, whether it is unusual, or how long it
 * "should" take — that is PROGNOSE and DIAGNOSE.
 *
 * The other direction is the subtle one. When someone reports BETTER we must
 * not congratulate the episode away ("sounds like it's clearing up") — that is
 * PROGNOSE and REASSURE wearing a friendly face. Improvement gets a plain
 * acknowledgement and nothing more.
 */

export type Trend = "BETTER" | "SAME" | "WORSE";

export type CheckInRecord = { day: number; trend: Trend; note?: string | null; createdAt: string | Date };

/** Days after the check-in on which we ask how it's going. */
export const FOLLOW_UP_DAYS = [2, 5, 10] as const;

/** Consecutive non-improving reports before the episode is surfaced for a visit. */
export const PERSISTENCE_REPORTS = 2;
/** …and the day from which that nudge can appear at all. */
export const PERSISTENCE_DAYS = 5;

export const dayOf = (startedAt: string | Date, now: Date = new Date()): number =>
  Math.max(1, Math.round((now.getTime() - new Date(startedAt).getTime()) / 86400000));

/** Newest first, defensively — callers have handed us either order. */
const newestFirst = (checkIns: CheckInRecord[]): CheckInRecord[] =>
  [...checkIns].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

export type FollowUp = {
  /** Day of the episode, 1-based. */
  day: number;
  /** True when a scheduled follow-up day has passed with nothing recorded since. */
  due: boolean;
  /** REFLECT only — what they have reported, never what it means. */
  trajectory: string | null;
  /** Set when the episode has persisted: a REFLECT plus a ROUTE, no verdict. */
  persistence: { line: string; action: string } | null;
};

export const followUpFor = (
  startedAt: string | Date,
  checkIns: CheckInRecord[],
  now: Date = new Date()
): FollowUp => {
  const day = dayOf(startedAt, now);
  const sorted = newestFirst(checkIns);
  const lastDay = sorted.length ? sorted[0].day : 0;

  // Due when a scheduled day has arrived and nothing has been recorded on or after it.
  const passed = FOLLOW_UP_DAYS.filter((d) => day >= d);
  const due = passed.length > 0 && lastDay < passed[passed.length - 1];

  return {
    day,
    due,
    trajectory: trajectoryLine(sorted),
    persistence: persistenceNudge(day, sorted),
  };
};

/** "You've said it's the same twice, and worse once." Their words, counted. */
export const trajectoryLine = (checkIns: CheckInRecord[]): string | null => {
  if (!checkIns.length) return null;
  const count = (t: Trend) => checkIns.filter((c) => c.trend === t).length;
  const parts: string[] = [];
  const phrase = (n: number, word: string) => `${word} ${n === 1 ? "once" : n === 2 ? "twice" : `${n} times`}`;
  if (count("WORSE")) parts.push(phrase(count("WORSE"), "worse"));
  if (count("SAME")) parts.push(phrase(count("SAME"), "no different"));
  if (count("BETTER")) parts.push(phrase(count("BETTER"), "better"));
  const latest = checkIns[0];
  const last =
    latest.trend === "BETTER" ? "Last time you said it was better." : latest.trend === "WORSE" ? "Last time you said it was worse." : "Last time you said it was no different.";
  return `Since you started this, you've reported ${parts.join(", ")}. ${last}`;
};

/**
 * The persistence nudge. Fires only on consecutive NON-IMPROVING reports, so a
 * single bad day does not trigger it and an improving episode never does.
 */
export const persistenceNudge = (day: number, checkIns: CheckInRecord[]): FollowUp["persistence"] => {
  if (day < PERSISTENCE_DAYS || checkIns.length < PERSISTENCE_REPORTS) return null;
  const recent = checkIns.slice(0, PERSISTENCE_REPORTS);
  if (!recent.every((c) => c.trend === "SAME" || c.trend === "WORSE")) return null;
  return {
    line: `It's day ${day}, and the last ${PERSISTENCE_REPORTS} times you've told me this is no better.`,
    action: "That's worth putting in front of a clinician. Everything you've told me is already written up.",
  };
};

/** The one-line prompt for a due follow-up. Neutral: it asks, it does not suggest an answer. */
export const followUpQuestion = (state: EncounterState, day: number): string =>
  `Day ${day} of "${state.complaintText.trim().slice(0, 80)}". How is it now?`;
