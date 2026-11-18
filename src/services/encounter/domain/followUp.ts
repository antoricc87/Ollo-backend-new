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

/**
 * An answer given up to this many days before a scheduled day counts for it:
 * someone who said "no different" on day 4 is not asked again on day 5
 * (seen on the first simulator run: "I'll ask again on day 5 (tomorrow)").
 */
export const FOLLOW_UP_GRACE_DAYS = 1;

/** After this day an unanswered follow-up stops being due — the question is not left hanging for ever. */
export const FOLLOW_UP_WINDOW_DAYS = 14;

/** The scheduled day a follow-up on `day` belongs to (the latest one that has arrived), or null before the first. */
export const followUpSlot = (day: number): number | null => [...FOLLOW_UP_DAYS].reverse().find((d) => day >= d) ?? null;

/**
 * WORSE IS ASKED AGAIN THE NEXT DAY (ruling Nov 16 2026), not at the next
 * scheduled day: after a "worse" on day d, day d+1 is a follow-up day of its
 * own. Still worse then → the day after, and so on, inside the 14-day window.
 * The latest of the scheduled day and that day is the one due.
 */
export const slotFor = (day: number, checkIns: CheckInRecord[]): number | null => {
  const scheduled = followUpSlot(day);
  const latest = newestFirst(checkIns)[0];
  const afterWorse = latest?.trend === "WORSE" && day >= latest.day + 1 ? latest.day + 1 : null;
  if (scheduled === null) return afterWorse;
  if (afterWorse === null) return scheduled;
  return Math.max(scheduled, afterWorse);
};

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
  /** The day this due follow-up belongs to (a scheduled day, or the day after a "worse"); null when none has arrived. */
  slot: number | null;
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

  const slot = slotFor(day, sorted);
  // Due when its day has arrived and nothing has been recorded since. A
  // scheduled day takes an answer up to the grace day early; the day after a
  // "worse" is due as soon as that day comes.
  const afterWorse = slot !== null && sorted[0]?.trend === "WORSE" && slot === sorted[0].day + 1;
  const due = slot !== null && day <= FOLLOW_UP_WINDOW_DAYS && (afterWorse ? lastDay < slot : lastDay < slot - FOLLOW_UP_GRACE_DAYS);

  return {
    day,
    due,
    slot,
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

/* --------------------- how a check-in ends (Nov 16 2026) --------------------- */

/**
 * A check-in closes by itself (ruling Nov 16 2026) — it used to stay OPEN for
 * ever once the schedule ran out. The outcome is what THEY reported, counted:
 *   resolved   better twice in a row (any day), or better at the end
 *   persisted  past the window and the last answer was not better
 *   lapsed     past the window with no answer at all, or an interview left
 *              unfinished/paused for the whole window
 *   escalated  a warning sign matched — its route was the next step, and
 *              it is never followed up, so it closes at the window
 * No outcome is a verdict on the symptom; "resolved" means "they said better".
 */
export type CheckinOutcome = "resolved" | "persisted" | "lapsed" | "escalated";

/** Consecutive "better" answers that end the follow-up early. */
export const BETTER_TO_CLOSE = 2;

export const closeVerdict = (startedAt: string | Date, checkIns: CheckInRecord[], now: Date = new Date()): CheckinOutcome | null => {
  const sorted = newestFirst(checkIns);
  if (sorted.length >= BETTER_TO_CLOSE && sorted.slice(0, BETTER_TO_CLOSE).every((c) => c.trend === "BETTER")) return "resolved";
  if (dayOf(startedAt, now) <= FOLLOW_UP_WINDOW_DAYS) return null;
  if (!sorted.length) return "lapsed";
  return sorted[0].trend === "BETTER" ? "resolved" : "persisted";
};

/** A check-in that is not being followed (unfinished, paused, or a warning sign matched): when does it close? */
export const closeUnfollowed = (kind: "unfinished" | "red_flag", startedAt: string | Date, lastActivity: string | Date, now: Date = new Date()): CheckinOutcome | null =>
  kind === "red_flag"
    ? dayOf(startedAt, now) > FOLLOW_UP_WINDOW_DAYS
      ? "escalated"
      : null
    : dayOf(lastActivity, now) > FOLLOW_UP_WINDOW_DAYS
    ? "lapsed"
    : null;

/**
 * The day of the check-in on which Ollie will next ask, or null when nothing
 * more is scheduled: today when one is due, tomorrow after a "worse", else
 * the next scheduled day an earlier answer does not already cover. Day N
 * falls N days after the first report (the same arithmetic as `followUpAck`).
 */
export const nextAskDay = (startedAt: string | Date, checkIns: CheckInRecord[], now: Date = new Date()): number | null => {
  const fu = followUpFor(startedAt, checkIns, now);
  if (fu.day > FOLLOW_UP_WINDOW_DAYS) return null;
  if (fu.due) return fu.day;
  const latest = newestFirst(checkIns)[0];
  const lastDay = latest?.day ?? 0;
  if (latest?.trend === "WORSE" && latest.day + 1 > fu.day) return latest.day + 1 <= FOLLOW_UP_WINDOW_DAYS ? latest.day + 1 : null;
  return FOLLOW_UP_DAYS.find((d) => d > fu.day && lastDay < d - FOLLOW_UP_GRACE_DAYS) ?? null;
};

/** The one-line prompt for a due follow-up. Neutral: it asks, it does not suggest an answer. */
export const followUpQuestion = (state: EncounterState, day: number): string =>
  `Day ${day} of "${state.complaintText.trim().slice(0, 80)}". How is it now?`;

/* ------------------- the follow-up as a conversation (Oct 5 2026) ------------------- */

/**
 * The follow-up used to be three buttons on a separate page that answered
 * nothing back. It now happens in the Ollie chat: Ollie asks, the three
 * answers are chips, and the reply says what was recorded, the count so far
 * and when it will ask next. Everything said here is built in code, for the
 * same reason as the lines above — the friendly direction ("sounds like it's
 * clearing up") is the one a model drifts into.
 */

/** The three answers, in the words the chips show. */
export const FOLLOW_UP_CHOICES: { value: Trend; label: string }[] = [
  { value: "BETTER", label: "Better" },
  { value: "SAME", label: "No different" },
  { value: "WORSE", label: "Worse" },
];

const TREND_WORD: Record<Trend, string> = { BETTER: "better", SAME: "no different", WORSE: "worse" };

/** The next scheduled day an answer on `day` does not already cover, or null once the schedule is over. */
export const nextFollowUpDay = (day: number): number | null => FOLLOW_UP_DAYS.find((d) => d > day + FOLLOW_UP_GRACE_DAYS) ?? null;

const dateOfDay = (startedAt: string | Date, day: number) => new Date(new Date(startedAt).getTime() + day * 86400000);
const shortDate = (d: Date, timeZone?: string) => d.toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short", ...(timeZone ? { timeZone } : {}) });

/** "How is it now?" — the one question, naming the day and what it is about. Asks; suggests no answer. */
export const followUpAsk = (about: string, day: number, theirWords?: string | null): string =>
  // A check-in the catch-all protocol took has no name of its own ("Something else") — their words are its name.
  theirWords ? `Day ${day} of your check-in about "${theirWords.trim().slice(0, 80)}" — how is it now?` : `Day ${day} of your ${about.toLowerCase()} check-in — how is it now?`;

export type FollowUpAck = {
  /** What was written down, in one line. */
  recorded: string;
  /** Their reports so far, counted (REFLECT). */
  trajectory: string | null;
  /** Set when it has persisted: a REFLECT plus a ROUTE. */
  persistence: { line: string; action: string } | null;
  /** When the next question comes, or that the schedule is over. */
  next: string;
  nextDay: number | null;
  /** Set when this answer closed the check-in. */
  closed: CheckinOutcome | null;
  /** A route to offer — only when they said worse or it has persisted. Escalation is one-way. */
  offerRoute: boolean;
};

/**
 * What may be said back once an answer is recorded. `checkIns` includes the
 * one just recorded. Nothing here says what the change means.
 */
export const followUpAck = (startedAt: string | Date, checkIns: CheckInRecord[], now: Date = new Date(), timeZone?: string): FollowUpAck => {
  const sorted = newestFirst(checkIns);
  const latest = sorted[0];
  const day = dayOf(startedAt, now);
  const persistence = persistenceNudge(day, sorted);
  const closed = closeVerdict(startedAt, sorted, now);
  const tomorrow = latest.trend === "WORSE" && day + 1 <= FOLLOW_UP_WINDOW_DAYS ? day + 1 : null;
  const nextDay = closed ? null : tomorrow ?? nextFollowUpDay(day);
  return {
    recorded: `Written down for day ${latest.day}: ${TREND_WORD[latest.trend]}.`,
    trajectory: sorted.length > 1 ? trajectoryLine(sorted) : null,
    persistence,
    next:
      closed === "resolved"
        ? "That's better twice in a row, so I've closed this check-in. It stays on your record — tell me if it comes back."
        : nextDay && nextDay === tomorrow
        ? "I'll check in again tomorrow."
        : nextDay
        ? `I'll ask again on day ${nextDay} (${shortDate(dateOfDay(startedAt, nextDay), timeZone)}).`
        : "That was the last scheduled follow-up. It stays on your record — tell me any time it changes.",
    nextDay,
    closed,
    offerRoute: latest.trend === "WORSE" || !!persistence,
  };
};
