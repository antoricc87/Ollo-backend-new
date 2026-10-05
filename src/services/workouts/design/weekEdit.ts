/**
 * Editing a drafted training week (Oct 5 2026). A change to a week on the
 * table touches only what the person named: moving a session is done here in
 * code, adding or changing one session designs that session alone, and every
 * other session comes back byte-for-byte as it was. Before this, every change
 * request redesigned the whole week ("sessions should be Mon, Wed and Thu"
 * came back with all three sessions rewritten).
 *
 * Pure: the designer is passed in, so the rule is testable without a model.
 */
import moment from "moment-timezone";
import type { FOCUS, PlannedSessionInput, WEEKDAYS } from "../domain/workout.schema";

const DAY = "YYYY-MM-DD";
type Weekday = (typeof WEEKDAYS)[number];
type Focus = (typeof FOCUS)[number];

/** One session of a week draft, as the `workout_plan` card carries it (display is rebuilt by the caller). */
export type WeekSession = { day: number; session: PlannedSessionInput; fit: { ok: boolean; issues: string[]; revised?: boolean }; assumptions: string[] };

export type WeekDraftState = { startDate: string; days: number; priorityDay: number | null; sessions: WeekSession[] };

type DesignFields = { request: string; durationMin?: number; focus?: Focus; muscleGroups?: string[] };
export type WeekEdit =
  | { op: "move"; from: Weekday; to: Weekday }
  | { op: "remove"; day: Weekday }
  | ({ op: "add"; day: Weekday } & DesignFields)
  | ({ op: "change"; day: Weekday } & DesignFields);

/** What the designer is asked for: one session on one day, with the rest of the week fixed around it. */
export type SessionSpec = DesignFields & { day: number; date: string; previous: PlannedSessionInput | null; others: WeekSession[] };
export type DesignOne = (spec: SessionSpec) => Promise<Omit<WeekSession, "day">>;

export class WeekEditError extends Error {}

export const dateOfDay = (startDate: string, day: number) => moment.utc(startDate, DAY).add(day - 1, "days").format(DAY);

/** "thu" → its day number in this week (day 1 = startDate), or null when the week doesn't reach it. */
export const dayOfWeekday = (startDate: string, days: number, weekday: Weekday): number | null => {
  for (let d = 1; d <= days; d++) if (moment.utc(dateOfDay(startDate, d), DAY).format("ddd").toLowerCase() === weekday) return d;
  return null;
};

const dayLabel = (startDate: string, day: number) => moment.utc(dateOfDay(startDate, day), DAY).format("ddd D");

/**
 * Apply the edits in order. Returns the new week plus which days were
 * designed (`designed`) and one plain line per edit (`log`). Sessions no edit
 * names are the same objects that came in.
 */
export const applyWeekEdits = async (week: WeekDraftState, edits: WeekEdit[], design: DesignOne): Promise<WeekDraftState & { designed: number[]; log: string[] }> => {
  let sessions = [...week.sessions];
  let priorityDay = week.priorityDay;
  const designed: number[] = [];
  const log: string[] = [];
  const at = (weekday: Weekday) => {
    const day = dayOfWeekday(week.startDate, week.days, weekday);
    if (!day) throw new WeekEditError(`this week (${dayLabel(week.startDate, 1)} → ${dayLabel(week.startDate, week.days)}) has no ${weekday}`);
    return day;
  };
  const onDay = (day: number) => sessions.find((s) => s.day === day) ?? null;
  const placed = (s: WeekSession, day: number): WeekSession => ({ ...s, day, session: { ...s.session, plannedFor: dateOfDay(week.startDate, day) } });

  for (const edit of edits) {
    if (edit.op === "move") {
      const from = at(edit.from), to = at(edit.to);
      const moving = onDay(from);
      if (!moving) throw new WeekEditError(`no session on ${dayLabel(week.startDate, from)} to move`);
      if (from === to) continue;
      const there = onDay(to);
      sessions = sessions.filter((s) => s !== moving && s !== there).concat(placed(moving, to), there ? [placed(there, from)] : []);
      if (priorityDay === from) priorityDay = to;
      else if (priorityDay === to) priorityDay = there ? from : priorityDay;
      designed.forEach((d, i) => (designed[i] = d === from ? to : d === to && there ? from : d));
      log.push(there ? `"${moving.session.title}" and "${there.session.title}" swapped days (${dayLabel(week.startDate, from)} ↔ ${dayLabel(week.startDate, to)}), both unchanged` : `"${moving.session.title}" moved ${dayLabel(week.startDate, from)} → ${dayLabel(week.startDate, to)}, unchanged`);
    } else if (edit.op === "remove") {
      const day = at(edit.day);
      const gone = onDay(day);
      if (!gone) throw new WeekEditError(`no session on ${dayLabel(week.startDate, day)} to remove`);
      if (sessions.length === 1) throw new WeekEditError("a week needs at least one session");
      sessions = sessions.filter((s) => s !== gone);
      if (priorityDay === day) priorityDay = null;
      log.push(`"${gone.session.title}" (${dayLabel(week.startDate, day)}) removed`);
    } else {
      const day = at(edit.day);
      const existing = onDay(day);
      if (edit.op === "add" && existing) throw new WeekEditError(`${dayLabel(week.startDate, day)} already has "${existing.session.title}" — use op "change" to alter it, or pick a free day`);
      if (edit.op === "change" && !existing) throw new WeekEditError(`no session on ${dayLabel(week.startDate, day)} to change — use op "add"`);
      const others = sessions.filter((s) => s !== existing);
      const { op: _op, day: _weekday, ...fields } = edit;
      const made = await design({ ...fields, day, date: dateOfDay(week.startDate, day), previous: existing?.session ?? null, others });
      sessions = others.concat({ ...made, day, session: { ...made.session, plannedFor: dateOfDay(week.startDate, day) } });
      designed.push(day);
      log.push(existing ? `"${existing.session.title}" (${dayLabel(week.startDate, day)}) changed → "${made.session.title}"` : `"${made.session.title}" added on ${dayLabel(week.startDate, day)}`);
    }
  }
  sessions.sort((a, b) => a.day - b.day);
  return { startDate: week.startDate, days: week.days, priorityDay, sessions, designed: Array.from(new Set(designed)).sort((a, b) => a - b), log };
};
