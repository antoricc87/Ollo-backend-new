import moment from "moment-timezone";

/**
 * THE GATE — what Ollie's own background work may push, and when (user ruling
 * Oct 16 2026: "go with the digest").
 *
 * Every task leaves its work in the app first (a note, a draft card); the push
 * is an optional extra, and this decides it. Pure — the outbox gathers the
 * counts, this returns the verdict.
 *
 *   digest   held, then merged into ONE morning push ("Ollie did 3 things…")
 *   now      pushed on its own — only for work that would be stale by the
 *            next morning (next week's plan on Sunday evening, labs just read,
 *            a lighter option for today)
 *
 * Messages from people (care team, bookings) never pass through here: a
 * clinician's message is not Ollie's to hold back.
 */

/** Ollie's own notification kinds. Anything else is sent as before. */
export const AGENT_KINDS = new Set(["weekly_review", "signal", "watch_out", "plan_week", "missed_session", "lighter_today", "digest"]);

export const isAgentKind = (kind: string) => AGENT_KINDS.has(kind);

/** Local hour the digest goes out — right after the 09:00 scan in the same tick. */
export const DIGEST_HOUR = 9;
/** Quiet hours, local, [start, end). A `now` push in this window waits for the end. */
export const QUIET_START = "21:30";
export const QUIET_END = "07:30";
/** Pushes a day from Ollie's own work, digest included. */
export const DAILY_CAP = 1;
/** Pushes a week (Monday–Sunday, local) from Ollie's own work, digest included. */
export const WEEKLY_CAP = 5;

export type DeliveryMode = "now" | "digest";

export type GateInput = {
  mode: DeliveryMode;
  now: Date;
  timeZone: string;
  /** Agent pushes already sent or queued to send today (local). */
  pushedToday: number;
  /** Agent pushes already sent or queued to send this week (local, ISO week). */
  pushedThisWeek: number;
};

export type GateVerdict =
  | { status: "queued"; scheduledFor: Date; reason: null | "quiet_hours" }
  | { status: "held"; scheduledFor: Date; reason: "digest" | "daily_cap" | "weekly_cap" };

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** True inside quiet hours (the window wraps midnight). */
export const inQuietHours = (local: moment.Moment) => {
  const m = local.hours() * 60 + local.minutes();
  return m >= minutesOf(QUIET_START) || m < minutesOf(QUIET_END);
};

/** The end of the current quiet window, as a Date. */
export const quietEnd = (local: moment.Moment) => {
  const [h, m] = QUIET_END.split(":").map(Number);
  const end = local.clone().hours(h).minutes(m).seconds(0).milliseconds(0);
  return end.isAfter(local) ? end.toDate() : end.add(1, "day").toDate();
};

export const decideDelivery = (g: GateInput): GateVerdict => {
  if (g.mode === "digest") return { status: "held", scheduledFor: g.now, reason: "digest" };
  // Over a cap, the work still waits in the app and rides the next digest.
  if (g.pushedThisWeek >= WEEKLY_CAP) return { status: "held", scheduledFor: g.now, reason: "weekly_cap" };
  if (g.pushedToday >= DAILY_CAP) return { status: "held", scheduledFor: g.now, reason: "daily_cap" };
  const local = moment(g.now).tz(g.timeZone);
  if (inQuietHours(local)) return { status: "queued", scheduledFor: quietEnd(local), reason: "quiet_hours" };
  return { status: "queued", scheduledFor: g.now, reason: null };
};

/* ------------------------------- the digest ------------------------------ */

/**
 * What each kind of work is called inside a digest — it names the WORK, never
 * the finding (ruling default Oct 16 2026: a lock screen shows no symptom and
 * no lab value). Lower case: these are joined into one sentence.
 */
export const DIGEST_LINES: Record<string, string> = {
  weekly_review: "your weekly review",
  plan_week: "next week's training drafted",
  missed_session: "this week's training adjusted",
  lighter_today: "a lighter option for today's session",
  signal: "a note on something that changed",
  watch_out: "your new labs read",
};

/** On its own, each kind's push says this. */
export const SINGLE_LINES: Record<string, string> = {
  weekly_review: "Your weekly review is ready",
  plan_week: "Next week's training is drafted",
  missed_session: "This week's training is adjusted — take a look",
  lighter_today: "A lighter option for today's session is ready",
  signal: "A note on something that changed",
  watch_out: "Your new labs are read",
};

/** "a", "a and b", "a, b and c". */
const listOf = (parts: string[]) => (parts.length < 2 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`);

export type DigestItem = { kind: string; threadId: string | null };

/**
 * One push for everything held. One item reads as that item and opens it;
 * several read as a list and open the Ready list. Two of the same kind (two
 * signals) are one line — the list is what was done, not a count of notes.
 */
export const digestPush = (items: DigestItem[]): { body: string; route: string; threadId: string | null } | null => {
  if (!items.length) return null;
  const kinds = [...new Set(items.map((i) => i.kind))];
  if (items.length === 1) {
    const only = items[0];
    return { body: SINGLE_LINES[only.kind] ?? "Ollie left you a note", route: only.threadId ? `ollie?threadId=${only.threadId}` : "ollie/ready", threadId: only.threadId };
  }
  const lines = kinds.map((k) => DIGEST_LINES[k] ?? "a note");
  return { body: `Ready for you: ${listOf(lines)}.`, route: "ollie/ready", threadId: null };
};
