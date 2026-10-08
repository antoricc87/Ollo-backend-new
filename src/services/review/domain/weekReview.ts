import moment from "moment-timezone";
import { Baseline, isUsable } from "../../signals/domain/baseline";

/**
 * THE WEEKLY REVIEW CARD — one week against the one before it, built in code.
 *
 * The rule this file exists for: a number on the card is either backed by
 * enough of the week to mean something, or it is not printed. Half of these
 * rows depend on the person doing something (logging food, stepping on a
 * scale, wearing the watch to bed), and an average over two logged days reads
 * exactly like an average over seven. So every row carries its own coverage:
 *   - enough data  → the average, and a "vs last" only when LAST week also had
 *                    enough (a delta against a thin week is two guesses);
 *   - some, too few → the row stays, the value is a dash and the line under the
 *                    name says how much was recorded;
 *   - a source the person never uses (no nights on record at all, no weigh-in
 *                    this week) → no row.
 * A row is only ever flagged, and only ever counts toward the title, when it
 * has enough data. Missing data is stated, never judged.
 *
 * The strings are formatted here so the app does no arithmetic and the model
 * reads the same facts the card shows. Pure module — no I/O.
 */

/** Days (or nights) of the seven needed before an average is printed. */
export const MIN_DAYS = 5;
/** How far off a target still reads as on it (calories either way, protein and sessions below). */
export const TOLERANCE = 0.1;
/** Minutes under the sleep target that still read as on it. */
export const SLEEP_SLACK_MIN = 30;
/** Tags on the card: the two that matter most, not a list. */
export const MAX_FLAGS = 2;

export type Range = { min: number | null; max: number | null };

export type WeekDay = {
  date: string;
  /** Meal types logged that day (null = an untyped legacy entry). Empty = nothing logged. */
  mealTypes: (string | null)[];
  calories: number;
  proteinG: number;
};

export type WeekNight = { date: string; asleepMinutes: number | null; hrvMs: number | null };

export type WeekData = {
  days: WeekDay[];
  nights: WeekNight[];
  /** Completed sessions. */
  sessions: { date: string; minutes: number | null }[];
  /** Sessions the saved training week put on these days, done or not. */
  planned: number;
  weights: { date: string; value: number }[];
};

export type WeekReviewInput = {
  /** Monday and Sunday of the week under review, local YYYY-MM-DD. */
  from: string;
  to: string;
  week: WeekData;
  /** The week before, same shape — only ever used for "vs last". */
  previous: WeekData;
  targets: { calories: Range | null; proteinG: Range | null; sleepMinutes: number | null; sessionsPerWeek: number | null };
  /** The person's usual HRV from the nights BEFORE this week (baseline.ts). */
  hrvBaseline: Baseline | null;
  /** Whether any night is on record at all — no watch at night means no sleep rows, not empty ones. */
  hasNights: boolean;
  weightUnit: "kg" | "lb";
};

export type RowKey = "sleep" | "hrv" | "train" | "food" | "kcal" | "protein" | "weight";

export type ReviewRow = {
  key: RowKey;
  /** Mono key column: SLEEP · RECOV · TRAIN · KCAL · PROT · WT. */
  label: string;
  name: string;
  /** The ONE line under the name. */
  sub: string;
  /** Null = not enough recorded; the card prints a dash. */
  value: string | null;
  delta: string | null;
  deltaTone: "good" | "flag" | "neutral";
  flagged: boolean;
  /** full = the whole week · partial = enough to average · thin = too little to say. */
  coverage: "full" | "partial" | "thin";
};

export type StripDay = { date: string; letter: string; state: "on" | "off" | "part" | "none" };

export type WeekReview = {
  from: string;
  to: string;
  /** "Mon 21–Sun 27 Sep" */
  range: string;
  title: string;
  flags: { key: RowKey; text: string }[];
  /** Days with a full food log (two meal types or more — the Health Score's rule). */
  logged: { days: number; of: number; partDays: number };
  rows: ReviewRow[];
  strip: StripDay[];
  /** What each strip mark means this week, for the model — the card has no legend. */
  stripMeans: string;
  /** Rows that could not be judged and why, for the model: say it, never estimate it. */
  notJudged: string[];
};

/* --------------------------------- helpers -------------------------------- */

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const int = (n: number) => Math.round(n).toLocaleString("en-US");
const signed = (n: number, text: string) => (n > 0 ? `+${text}` : n < 0 ? `−${text}` : text);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const present = <T>(v: T | null | undefined): v is T => v !== null && v !== undefined;

/** 438 → "7:18" */
export const clock = (minutes: number) => `${Math.floor(Math.round(minutes) / 60)}:${String(Math.round(minutes) % 60).padStart(2, "0")}`;
/** 190 → "3 h 10 m", 45 → "45 m", 420 → "7 h" */
export const span = (minutes: number) => {
  const m = Math.round(minutes);
  const h = Math.floor(m / 60);
  return h && m % 60 ? `${h} h ${m % 60} m` : h ? `${h} h` : `${m} m`;
};

const targetText = (r: Range, unit = "") => {
  const u = unit ? ` ${unit}` : "";
  if (present(r.min) && present(r.max) && r.min !== r.max) return `${int(r.min)}–${int(r.max)}${u}`;
  return `${int((r.min ?? r.max) as number)}${u}`;
};

/** A full food day: two kinds of meal or more, or an untyped legacy entry (the Health Score's rule). */
export const isFullDay = (d: WeekDay) => d.mealTypes.length > 0 && (d.mealTypes.some((t) => t === null) || new Set(d.mealTypes).size >= 2);

/** −1 under, 0 on, +1 over. A missing bound is not a bound. */
const against = (value: number, r: Range, tolerance = TOLERANCE) =>
  present(r.min) && value < r.min * (1 - tolerance) ? -1 : present(r.max) && value > r.max * (1 + tolerance) ? 1 : 0;

const coverageOf = (n: number, of: number): ReviewRow["coverage"] => (n >= of ? "full" : n >= MIN_DAYS ? "partial" : "thin");

/** "vs last" only when both weeks had enough behind them. */
const delta = (now: number | null, before: number | null) => (present(now) && present(before) ? now - before : null);

const foodAverages = (w: WeekData) => {
  const full = w.days.filter(isFullDay);
  const enough = full.length >= MIN_DAYS;
  return { full, enough, calories: enough ? mean(full.map((d) => d.calories)) : null, proteinG: enough ? mean(full.map((d) => d.proteinG)) : null };
};

const nightAverage = (w: WeekData, key: "asleepMinutes" | "hrvMs") => {
  const xs = w.nights.map((n) => n[key]).filter(present);
  return { n: xs.length, values: xs, avg: xs.length >= MIN_DAYS ? mean(xs) : null };
};

const nightsLine = (n: number, of: number) => (n ? `${n} of ${of} nights recorded` : "No nights recorded this week");

/* ---------------------------------- rows ---------------------------------- */

function sleepRow(input: WeekReviewInput, of: number): ReviewRow | null {
  if (!input.hasNights) return null;
  const now = nightAverage(input.week, "asleepMinutes");
  const base = { key: "sleep" as const, label: "SLEEP", name: "Time asleep", deltaTone: "neutral" as const, flagged: false, coverage: coverageOf(now.n, of) };
  if (!present(now.avg)) return { ...base, sub: nightsLine(now.n, of), value: null, delta: null };
  const target = input.targets.sleepMinutes;
  const over = target ? now.values.filter((v) => v >= target).length : 0;
  const sub = target
    ? now.n >= of
      ? `${plural(over, "night")} over ${span(target)}`
      : `${now.n} of ${of} nights · ${over} over ${span(target)}`
    : now.n >= of
      ? `${of} nights recorded`
      : `${now.n} of ${of} nights recorded`;
  const flagged = !!target && now.avg < target - SLEEP_SLACK_MIN;
  const d = delta(now.avg, nightAverage(input.previous, "asleepMinutes").avg);
  const dm = present(d) ? Math.round(d) : null;
  return {
    ...base,
    sub,
    value: clock(now.avg),
    delta: present(dm) ? signed(dm, Math.abs(dm) >= 60 ? span(Math.abs(dm)).replace(/ /g, "") : `${Math.abs(dm)}m`) : null,
    deltaTone: flagged ? "flag" : present(dm) && dm > 0 ? "good" : "neutral",
    flagged,
  };
}

function hrvRow(input: WeekReviewInput, of: number): ReviewRow | null {
  if (!input.hasNights) return null;
  const now = nightAverage(input.week, "hrvMs");
  // A watch that records sleep but no HRV: nothing to show, and nothing missing either.
  if (!now.n && !nightAverage(input.previous, "hrvMs").n) return null;
  const base = { key: "hrv" as const, label: "RECOV", name: "HRV", deltaTone: "neutral" as const, flagged: false, coverage: coverageOf(now.n, of) };
  if (!present(now.avg)) return { ...base, sub: nightsLine(now.n, of), value: null, delta: null };
  const b = input.hrvBaseline;
  // Against the person's own usual, in the readiness card's words — an observation, never a grade.
  const band = isUsable(b) ? (now.avg < b!.mean - b!.std ? "Below your usual band" : now.avg > b!.mean + b!.std ? "Above your usual band" : "Inside your usual band") : null;
  const sub = now.n >= of ? (band ?? `${of} nights recorded`) : band ? `${now.n} of ${of} nights · ${band.toLowerCase().replace(" band", "")}` : `${now.n} of ${of} nights recorded`;
  const d = delta(now.avg, nightAverage(input.previous, "hrvMs").avg);
  const dr = present(d) ? Math.round(d) : null;
  return { ...base, sub, value: `${Math.round(now.avg)} ms`, delta: present(dr) ? signed(dr, String(Math.abs(dr))) : null, deltaTone: present(dr) && dr > 0 ? "good" : "neutral" };
}

function trainRow(input: WeekReviewInput): ReviewRow {
  const done = input.week.sessions.length;
  // What "done" is out of: the saved week's sessions, else the plan's weekly target, else nothing.
  const outOf = input.week.planned || input.targets.sessionsPerWeek || 0;
  const minutes = input.week.sessions.reduce((acc, s) => acc + (s.minutes ?? 0), 0);
  const flagged = outOf > 0 && done < outOf;
  const d = done - input.previous.sessions.length;
  return {
    key: "train",
    label: "TRAIN",
    name: "Sessions done",
    sub: done ? (minutes ? `${span(minutes)} total` : plural(done, "session")) : "None recorded",
    value: outOf ? `${done} / ${Math.round(outOf)}` : String(done),
    // Sessions are recorded or they did not happen for the record — last week's count is always known.
    delta: signed(d, String(Math.abs(d))),
    deltaTone: flagged ? "flag" : d > 0 ? "good" : "neutral",
    flagged,
    coverage: "full",
  };
}

function foodRows(input: WeekReviewInput, of: number): ReviewRow[] {
  const now = foodAverages(input.week);
  const before = foodAverages(input.previous);
  const n = now.full.length;
  const coverage = coverageOf(n, of);
  if (!now.enough) {
    // Calories and protein would say the same missing thing twice — one row says it once.
    const part = input.week.days.filter((d) => d.mealTypes.length && !isFullDay(d)).length;
    const sub = n ? `${n} of ${of} days logged, too few to average` : part ? `${plural(part, "day")} part-logged, none in full` : "Nothing logged this week";
    return [{ key: "food", label: "FOOD", name: "Food log", sub, value: null, delta: null, deltaTone: "neutral", flagged: false, coverage }];
  }
  // Short enough to stay on one line beside the value.
  const lead = n >= of ? "" : `${n} of ${of} days · `;
  const cap = (s: string) => (lead ? lead + s.toLowerCase() : s);

  const kcalTarget = input.targets.calories;
  const kcalSide = kcalTarget ? against(now.calories!, kcalTarget) : 0;
  const dk = delta(now.calories, before.calories);
  const dkr = present(dk) ? Math.round(dk / 10) * 10 : null;
  const kcal: ReviewRow = {
    key: "kcal",
    label: "KCAL",
    name: "Energy per day",
    sub: kcalTarget ? cap(`Target ${targetText(kcalTarget)}`) : n >= of ? "No calorie target set" : `Avg of ${n} of ${of} days`,
    value: int(Math.round(now.calories! / 10) * 10),
    delta: present(dkr) ? signed(dkr, int(Math.abs(dkr))) : null,
    deltaTone: kcalSide ? "flag" : "neutral",
    flagged: kcalSide !== 0,
    coverage,
  };

  const protTarget = input.targets.proteinG;
  const protLow = !!protTarget && against(now.proteinG!, { min: protTarget.min, max: null }) < 0;
  const dp = delta(now.proteinG, before.proteinG);
  const dpr = present(dp) ? Math.round(dp) : null;
  const protein: ReviewRow = {
    key: "protein",
    label: "PROT",
    name: "Protein per day",
    sub: protTarget ? cap(`Target ${targetText(protTarget, "g")}`) : n >= of ? "No protein target set" : `Avg of ${n} of ${of} days`,
    value: `${Math.round(now.proteinG!)} g`,
    delta: present(dpr) ? signed(dpr, `${Math.abs(dpr)} g`) : null,
    deltaTone: protLow ? "flag" : present(dpr) && dpr > 0 && !!protTarget ? "good" : "neutral",
    flagged: protLow,
    coverage,
  };
  return [kcal, protein];
}

function weightRow(input: WeekReviewInput): ReviewRow | null {
  const now = input.week.weights;
  // Weighing in is optional: no weigh-in is not a gap worth a row.
  if (!now.length) return null;
  const avg = mean(now.map((w) => w.value));
  const before = input.previous.weights;
  const d = before.length ? Math.round((avg - mean(before.map((w) => w.value))) * 10) / 10 : null;
  return {
    key: "weight",
    label: "WT",
    name: "Body weight",
    sub: plural(now.length, "weigh-in"),
    value: `${avg.toFixed(1)} ${input.weightUnit}`,
    delta: present(d) ? signed(d, Math.abs(d).toFixed(1)) : null,
    // Up or down is only good or bad against a goal the card does not know — never coloured.
    deltaTone: "neutral",
    flagged: false,
    coverage: "full",
  };
}

/* ------------------------------ strip + title ----------------------------- */

const LETTERS = ["M", "T", "W", "T", "F", "S", "S"];

function stripOf(input: WeekReviewInput): { strip: StripDay[]; means: string } {
  const { calories, proteinG } = input.targets;
  const judged = !!calories || !!proteinG;
  const strip = input.week.days.map((d, i): StripDay => {
    const letter = LETTERS[i % 7];
    if (!d.mealTypes.length) return { date: d.date, letter, state: "none" };
    if (!isFullDay(d)) return { date: d.date, letter, state: "part" };
    const off = (calories && against(d.calories, calories) !== 0) || (proteinG && against(d.proteinG, { min: proteinG.min, max: null }) < 0);
    return { date: d.date, letter, state: off ? "off" : "on" };
  });
  const means = judged
    ? "Day strip = each day's food against the daily targets: filled = logged and inside them, amber ring = logged and outside them, dim ring = only part of the day logged, dash = nothing logged."
    : "Day strip = food logging: filled = logged, dim ring = only part of the day logged, dash = nothing logged (no daily food targets to judge against).";
  return { strip, means };
}

const FLAG_TEXT = (row: ReviewRow, input: WeekReviewInput): string => {
  if (row.key === "protein") return "PROTEIN LOW";
  if (row.key === "sleep") return "SLEEP SHORT";
  if (row.key === "train") return "SESSIONS MISSED";
  const avg = foodAverages(input.week).calories ?? 0;
  return input.targets.calories && against(avg, input.targets.calories) > 0 ? "ENERGY OVER" : "ENERGY UNDER";
};

function titleOf(rows: ReviewRow[], input: WeekReviewInput): string {
  // Judged = has enough data AND something to be judged against.
  const judged = rows.filter(
    (r) =>
      r.value !== null &&
      ((r.key === "sleep" && !!input.targets.sleepMinutes) ||
        (r.key === "train" && (input.week.planned > 0 || !!input.targets.sessionsPerWeek)) ||
        (r.key === "kcal" && !!input.targets.calories) ||
        (r.key === "protein" && !!input.targets.proteinG))
  );
  if (!judged.length) return "Not enough recorded to judge the week";
  const off = judged.filter((r) => r.flagged).length;
  // The food rows are most of the plan; without them "on plan" would overclaim.
  const foodMissing = rows.some((r) => r.key === "food") && (!!input.targets.calories || !!input.targets.proteinG);
  if (foodMissing) return off === 0 ? "On plan where it was recorded" : "Too little logged to judge the week";
  if (off === 0) return "A steady week, on plan";
  if (off === judged.length) return "An off-plan week";
  return off * 2 < judged.length ? "A steady week, mostly on plan" : "A mixed week against your plan";
}

/* ---------------------------------- build --------------------------------- */

export function buildWeekReview(input: WeekReviewInput): WeekReview {
  const of = input.week.days.length;
  const rows = [sleepRow(input, of), hrvRow(input, of), trainRow(input), ...foodRows(input, of), weightRow(input)].filter(present);
  const { strip, means } = stripOf(input);
  const full = input.week.days.filter(isFullDay).length;
  const a = moment(input.from, "YYYY-MM-DD");
  const b = moment(input.to, "YYYY-MM-DD");
  const notJudged = rows.filter((r) => r.value === null).map((r) => `${r.name}: ${r.sub}`);
  if (!input.hasNights) notJudged.push("Sleep and HRV: no nights on record (nothing synced from a watch)");
  if (!input.week.weights.length) notJudged.push("Body weight: no weigh-in this week");
  return {
    from: input.from,
    to: input.to,
    range: a.month() === b.month() ? `${a.format("ddd D")}–${b.format("ddd D MMM")}` : `${a.format("ddd D MMM")}–${b.format("ddd D MMM")}`,
    title: titleOf(rows, input),
    // In row order, which is also the order of what the week rests on.
    flags: rows.filter((r) => r.flagged).slice(0, MAX_FLAGS).map((r) => ({ key: r.key, text: FLAG_TEXT(r, input) })),
    logged: { days: full, of, partDays: input.week.days.filter((d) => d.mealTypes.length && !isFullDay(d)).length },
    rows,
    strip,
    stripMeans: means,
    notJudged,
  };
}
