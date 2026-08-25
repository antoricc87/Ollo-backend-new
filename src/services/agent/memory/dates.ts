import moment from "moment-timezone";

/**
 * Date helpers for the agent. The tracker tables store dates as strings in
 * three different shapes (see CLAUDE.md / snapshot.ts), so every consumer
 * works with a plain local `YYYY-MM-DD` key and matches with `startsWith`
 * or lexicographic range comparisons — never with Date equality.
 */

export const DAY = "YYYY-MM-DD";

export const safeTz = (tz?: string | null): string =>
  tz && moment.tz.zone(tz) ? tz : "UTC";

export const nowIn = (tz: string) => moment().tz(tz);

/** Local calendar day, e.g. "2026-08-24". */
export const dayKey = (tz: string, at: moment.MomentInput = undefined) =>
  moment(at).tz(tz).format(DAY);

/** Monday–Sunday range containing `at`, as local day keys plus the day after. */
export const isoWeekRange = (tz: string, at: moment.MomentInput = undefined) => {
  const start = moment(at).tz(tz).startOf("isoWeek");
  const end = start.clone().endOf("isoWeek");
  return {
    start: start.format(DAY),
    end: end.format(DAY),
    next: start.clone().add(1, "week").format(DAY), // exclusive upper bound
  };
};

/** The BP / glucose daily trackers key their `date` as MM-DD-YYYY. */
export const usDayKey = (tz: string, at: moment.MomentInput = undefined) =>
  moment(at).tz(tz).format("MM-DD-YYYY");

/** Best-effort parse of the mixed createdAt/date strings the trackers store. */
export const parseStoredDate = (value: string | Date | null | undefined): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  const m = moment(value, [moment.ISO_8601, "MM-DD-YYYY", DAY], true);
  if (m.isValid()) return m.toDate();
  const loose = new Date(value);
  return isNaN(loose.getTime()) ? null : loose;
};

export const daysBetween = (a: Date, b: Date) =>
  Math.abs(moment(a).diff(moment(b), "days"));
