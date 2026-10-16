import type { DayRow, WorkoutRow } from "../../signals/domain/types";
import type { NightRow } from "../../signals/domain/baseline";

/**
 * ONE NUMBER WORTH KNOWING — a comparison inside the person's own last four
 * weeks, picked in code for the weekly review (ruling Oct 16 2026).
 *
 * Each candidate splits the same measure into two groups (nights after a
 * training day vs after a rest day; weekend vs weekdays) and only counts when
 * BOTH groups have enough days and the gap clears a fixed bar. Severity is in
 * bars, like the signals, so different measures can be ranked; the top one
 * that was not last week's is the one said. Nothing clears → nothing is said.
 *
 * It is a difference between two averages, never a cause: the note may say
 * "on nights after training you slept 34 min longer", never "training makes
 * you sleep longer". Pure.
 */

export const WINDOW_DAYS = 28;

export type StatGroup = { name: string; mean: number; n: number };
export type WeekStat = {
  key: string;
  /** What is being compared, in plain words. */
  measure: string;
  unit: string;
  a: StatGroup;
  b: StatGroup;
  /** a.mean − b.mean, rounded. */
  diff: number;
  /** Multiples of this stat's bar. */
  severity: number;
  from: string;
  to: string;
};

export type StatsInput = { nights: NightRow[]; days: DayRow[]; workouts: WorkoutRow[]; from: string; to: string };

const shift = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const weekday = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay(); // 0 Sun … 6 Sat
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

type Spec = {
  key: string;
  measure: string;
  unit: string;
  bar: number;
  minA: number;
  minB: number;
  names: [string, string];
  /** Rows of [group, value]; group true = a, false = b. */
  rows: (s: StatsInput, trained: Set<string>) => [boolean, number][];
  digits?: number;
};

const inWindow = (s: StatsInput, date: string) => date >= s.from && date <= s.to;

const SPECS: Spec[] = [
  {
    key: "sleep_after_training",
    measure: "time asleep",
    unit: "min",
    bar: 20,
    minA: 5,
    minB: 5,
    names: ["nights after a training day", "nights after a rest day"],
    rows: (s, trained) => s.nights.filter((n) => inWindow(s, n.date) && n.asleepMinutes != null).map((n) => [trained.has(shift(n.date, -1)), n.asleepMinutes as number]),
  },
  {
    key: "hrv_after_training",
    measure: "overnight HRV",
    unit: "ms",
    bar: 5,
    minA: 5,
    minB: 5,
    names: ["nights after a training day", "nights after a rest day"],
    rows: (s, trained) => s.nights.filter((n) => inWindow(s, n.date) && n.hrvMs != null).map((n) => [trained.has(shift(n.date, -1)), n.hrvMs as number]),
  },
  {
    key: "protein_training_days",
    measure: "protein",
    unit: "g",
    bar: 20,
    minA: 4,
    minB: 4,
    names: ["training days", "rest days"],
    rows: (s, trained) => s.days.filter((d) => inWindow(s, d.date) && d.logged && d.proteinG != null).map((d) => [trained.has(d.date), d.proteinG as number]),
  },
  {
    key: "calories_weekend",
    measure: "calories",
    unit: "kcal",
    bar: 300,
    minA: 4,
    minB: 8,
    names: ["weekend days", "weekdays"],
    rows: (s) => s.days.filter((d) => inWindow(s, d.date) && d.logged && d.calories != null).map((d) => [[0, 6].includes(weekday(d.date)), d.calories as number]),
  },
  {
    key: "sleep_weekend",
    measure: "time asleep",
    unit: "min",
    bar: 30,
    minA: 4,
    minB: 8,
    // A night is keyed by the morning it ended: Saturday and Sunday mornings are the Friday and Saturday nights.
    names: ["Friday and Saturday nights", "weeknights"],
    rows: (s) => s.nights.filter((n) => inWindow(s, n.date) && n.asleepMinutes != null).map((n) => [[0, 6].includes(weekday(n.date)), n.asleepMinutes as number]),
  },
];

export const weekStats = (s: StatsInput): WeekStat[] => {
  const trained = new Set(s.workouts.filter((w) => w.status === "COMPLETED").map((w) => w.date));
  const out: WeekStat[] = [];
  for (const spec of SPECS) {
    const rows = spec.rows(s, trained);
    const a = rows.filter(([g]) => g).map(([, v]) => v);
    const b = rows.filter(([g]) => !g).map(([, v]) => v);
    if (a.length < spec.minA || b.length < spec.minB) continue;
    const diff = mean(a) - mean(b);
    const severity = Math.abs(diff) / spec.bar;
    if (severity < 1) continue;
    out.push({
      key: spec.key,
      measure: spec.measure,
      unit: spec.unit,
      a: { name: spec.names[0], mean: Math.round(mean(a)), n: a.length },
      b: { name: spec.names[1], mean: Math.round(mean(b)), n: b.length },
      diff: Math.round(diff),
      severity: Math.round(severity * 100) / 100,
      from: s.from,
      to: s.to,
    });
  }
  return out.sort((x, y) => y.severity - x.severity);
};

/** The one to say: the strongest that was not said last week. */
export const pickStat = (stats: WeekStat[], saidLastWeek: string | null) => stats.find((st) => st.key !== saidLastWeek) ?? null;

/** For the model: the two averages in words it can quote, no arithmetic left to do. */
export const statLine = (st: WeekStat) =>
  `${st.measure}: ${st.a.mean} ${st.unit} on ${st.a.name} (${st.a.n}) vs ${st.b.mean} ${st.unit} on ${st.b.name} (${st.b.n}), ${st.from} → ${st.to}`;
