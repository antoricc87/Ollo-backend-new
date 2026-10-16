/**
 * WHERE A MISSED SESSION GOES — decided in code, so the background note only
 * explains a move it was handed (the same split as the signals: code finds,
 * the model writes). Pure.
 *
 * The rules, in order:
 *  - only a day from today to the end of the saved week, never the past;
 *  - only a day with nothing on it (no planned session, nothing done);
 *  - prefer a day with no session the day before or after, so the week keeps
 *    its rest days between sessions;
 *  - failing that, a day whose neighbours train different muscles — legs the
 *    day after legs is the one thing a moved session must not create;
 *  - the earliest day that qualifies.
 * No day qualifies → null: the week is full, and saying "skip it" is not work
 * done for anyone, so the task stays silent.
 */

export type DaySession = { date: string; muscleGroups: string[]; focus: string | null };

export type RescheduleInput = {
  missed: DaySession;
  /** Every other session of the saved week, planned or done, any day. */
  others: DaySession[];
  /** Local today, YYYY-MM-DD. */
  today: string;
  /** The saved week's last day, YYYY-MM-DD. */
  weekEnd: string;
};

export type Reschedule = { to: string; why: "free_with_rest_either_side" | "free_next_to_different_muscles" };

const shift = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Muscle groups as words, so "upper body" and "chest and back" can overlap on "back". */
const words = (groups: string[]) =>
  new Set(
    groups
      .flatMap((g) => g.toLowerCase().split(/[^a-z]+/))
      .filter((w) => w && !["and", "body", "the", "day", "full"].includes(w))
  );

/** Same muscles, or either side has no muscle list to tell (a full-body or untagged session overlaps everything). */
export const overlaps = (a: DaySession, b: DaySession) => {
  const wa = words(a.muscleGroups);
  const wb = words(b.muscleGroups);
  if (!wa.size || !wb.size) return true;
  for (const w of wa) if (wb.has(w)) return true;
  return false;
};

export const rescheduleMissed = (input: RescheduleInput): Reschedule | null => {
  const byDay = new Map<string, DaySession[]>();
  for (const s of input.others) byDay.set(s.date, [...(byDay.get(s.date) ?? []), s]);
  const free: string[] = [];
  for (let day = input.today; day <= input.weekEnd; day = shift(day, 1)) if (!byDay.has(day)) free.push(day);

  const neighbours = (day: string) => [...(byDay.get(shift(day, -1)) ?? []), ...(byDay.get(shift(day, 1)) ?? [])];
  const restful = free.find((d) => neighbours(d).length === 0);
  if (restful) return { to: restful, why: "free_with_rest_either_side" };
  const different = free.find((d) => neighbours(d).every((n) => !overlaps(input.missed, n)));
  if (different) return { to: different, why: "free_next_to_different_muscles" };
  return null;
};
