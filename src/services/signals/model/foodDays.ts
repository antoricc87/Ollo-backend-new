import { DayRow } from "../domain/types";

type FoodRow = { date: string; foodEntries: { calories: number | null; proteins: number | null }[] };

const nextDay = (date: string) => new Date(Date.parse(date) + 86_400_000).toISOString().slice(0, 10);

/**
 * The food log as one row per CALENDAR day, `from` → `today` inclusive.
 *
 * A day with no DailyFood row and a day with an empty one both mean "nothing
 * logged" — so the series is built from the calendar, not from the rows, or a
 * gap would simply be absent and `logging.stopped` could never see it.
 *
 * Rows are matched on the first ten characters of `date`: the app stores
 * "YYYY-MM-DDT00:00:00.000+00:00" (local midnight), older seeds a bare
 * "YYYY-MM-DD" (snapshot.ts lists the shapes). Matching the whole string made
 * every app-logged day read as empty — the note that said "50 days" two days
 * after a logged meal (Oct 8 2026). More than one row for a day is summed.
 */
export const foodDays = (rows: FoodRow[], from: string, today: string): DayRow[] => {
  const byDay = new Map<string, FoodRow["foodEntries"]>();
  for (const row of rows) {
    const day = row.date.slice(0, 10);
    byDay.set(day, [...(byDay.get(day) ?? []), ...row.foodEntries]);
  }
  const days: DayRow[] = [];
  for (let date = from; date <= today; date = nextDay(date)) {
    const entries = byDay.get(date) ?? [];
    days.push({
      date,
      logged: entries.length > 0,
      calories: entries.length ? entries.reduce((acc, e) => acc + (e.calories ?? 0), 0) : null,
      proteinG: entries.length ? entries.reduce((acc, e) => acc + (e.proteins ?? 0), 0) : null,
    });
  }
  return days;
};
