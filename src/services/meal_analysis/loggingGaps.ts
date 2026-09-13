import { dayLabel } from "./mealDate";

/**
 * Which days in a range have no food logged, or only one kind of meal — the
 * list Ollie reads back before a catch-up. Date arithmetic lives here, never
 * in the model. "Part-logged" uses the Health Score's rule (one meal type or
 * fewer), so what Ollie calls a gap is what the score leaves out.
 *
 * Pure — unit tested in ./tests/loggingGaps.test.ts.
 */

export type LoggedDay = { date: string; mealTypes: (string | null)[] };

const MAIN_SLOTS = ["BREAKFAST", "LUNCH", "DINNER"];

const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export function computeLoggingGaps(logged: LoggedDay[], from: string, to: string, today: string, timeZone: string) {
  const byDate = new Map<string, Set<string>>();
  for (const d of logged) {
    const types = byDate.get(d.date) ?? new Set<string>();
    for (const t of d.mealTypes) types.add(t ?? "UNKNOWN");
    byDate.set(d.date, types);
  }

  const empty: { date: string; label: string }[] = [];
  const partial: { date: string; label: string; logged: string[]; missing: string[] }[] = [];
  let loggedDays = 0;
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const types = byDate.get(date);
    const label = dayLabel(date, today, timeZone);
    if (!types || !types.size) {
      empty.push({ date, label });
      continue;
    }
    loggedDays++;
    if (types.size <= 1 && !types.has("UNKNOWN")) {
      partial.push({ date, label, logged: [...types].map((t) => t.toLowerCase()), missing: MAIN_SLOTS.filter((s) => !types.has(s)).map((s) => s.toLowerCase()) });
    }
  }

  // Consecutive empty days read back as one span: "Sat 30 Aug → Thu 11 Sep (13 days)".
  const runs: { from: string; to: string; days: number; text: string }[] = [];
  for (const e of empty) {
    const last = runs[runs.length - 1];
    if (last && addDays(last.to, 1) === e.date) {
      last.to = e.date;
      last.days++;
    } else runs.push({ from: e.date, to: e.date, days: 1, text: "" });
  }
  for (const r of runs) {
    const a = dayLabel(r.from, today, timeZone);
    r.text = r.days === 1 ? a : `${a} → ${dayLabel(r.to, today, timeZone)} (${r.days} days)`;
  }

  const gapDates = [...empty.map((e) => e.date), ...partial.map((p) => p.date)].sort();
  return {
    from,
    to,
    days: empty.length + loggedDays,
    loggedDays,
    empty,
    emptyRuns: runs,
    partial,
    /** The span a catch-up would fill: first to last gap day. Null when nothing is missing. */
    fillWindow: gapDates.length ? { from: gapDates[0], to: gapDates[gapDates.length - 1] } : null,
  };
}
