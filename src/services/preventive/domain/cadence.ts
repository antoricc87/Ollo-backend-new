import { ServiceType } from "./types";

/**
 * CADENCE — how often each item comes back, and so when it is next due
 * (his rulings Nov 19 2026):
 *  - every item in the plan HAS a cadence, and the person can change it;
 *  - LABS: once a year, except tests done once in a lifetime, and except
 *    when a result was outside its range — then sooner;
 *  - everything else: the guideline's interval, and a RESULT can change it
 *    (a colonoscopy with findings comes back sooner than a normal one).
 * Order: the person's own choice > what a result calls for > the default.
 *
 * Intervals are in months; null = once, no repeat. NEEDS CLINICAL REVIEW
 * (intervals after findings especially: the specialist's own advice wins,
 * and the app says so).
 */

export type Outcome = "normal" | "findings" | "unknown";

export type LastDone = {
  /** YYYY-MM-DD, or null when the record says it was done but not when. */
  on: string | null;
  source: "lab" | "booking" | "person" | "clinician" | "record";
  outcome: Outcome;
  /** Lab values outside their range on that date, by name. */
  flagged?: string[];
};

export type Cadence = {
  /** null = once. */
  months: number | null;
  /** Where the interval comes from. */
  from: "plan" | "result" | "you";
  /** Why it differs from the default, in one line (a result, their choice). */
  reason: string | null;
  /** What the guideline says, for comparison ("Every 4–6 years"). */
  guideline: string;
};

/** Done once in a lifetime (or once as a series). */
export const ONCE = new Set([
  "hiv",
  "hepatitis_c",
  "lipoprotein_a",
  "aaa_ultrasound",
  "brca_assessment",
  "shingles",
  "pneumococcal",
  "hpv",
  "hepatitis_b",
  "rsv",
  "rsv_pregnancy",
  "cac",
  "genetic_panel",
  "celiac",
  "dexa_bone_opt",
]);

/** Guideline intervals for what is not a lab (months). */
const GUIDELINE_MONTHS: Record<string, number> = {
  mammography: 24,
  lung_ldct: 12,
  dxa: 24,
  colorectal: 120,
  colon_early: 120,
  flu: 12,
  covid: 12,
  tdap: 120,
  blood_pressure: 12,
  depression_screen: 12,
  dexa_body: 12,
  eye_exam: 24,
  skin_check: 12,
  hearing: 36,
  vo2max: 12,
};

/** The default interval, before any result or choice. `age` decides Pap vs HPV spacing. */
export const defaultMonths = (key: string, type: ServiceType, age: number | null): number | null => {
  if (ONCE.has(key)) return null;
  if (key === "cervical") return age !== null && age < 30 ? 36 : 60;
  if (type === "lab") return 12;
  return GUIDELINE_MONTHS[key] ?? 24;
};

/** What a result calls for, when it changes the interval. */
export const resultMonths = (key: string, type: ServiceType, last: LastDone | null): { months: number; reason: string } | null => {
  if (!last) return null;
  if (type === "lab" && last.flagged?.length) {
    const names = last.flagged.slice(0, 2).join(" and ");
    return { months: 3, reason: `${names} ${last.flagged.length === 1 ? "was" : "were"} outside the range last time` };
  }
  if (last.outcome !== "findings") return null;
  if (key === "colorectal" || key === "colon_early") return { months: 36, reason: "Findings last time: often 3 years; your gastroenterologist sets it" };
  if (key === "mammography") return { months: 6, reason: "Findings last time: follow-up as your clinician advised" };
  if (key === "cervical") return { months: 12, reason: "An abnormal result last time: usually a repeat in a year" };
  return { months: 6, reason: "Findings last time: follow-up as your clinician advised" };
};

export const cadenceFor = (key: string, type: ServiceType, age: number | null, last: LastDone | null, override: number | null | undefined, guideline: string): Cadence => {
  if (override !== null && override !== undefined) return { months: override === 0 ? null : override, from: "you", reason: "You set this", guideline };
  const byResult = resultMonths(key, type, last);
  if (byResult) return { months: byResult.months, from: "result", reason: byResult.reason, guideline };
  return { months: defaultMonths(key, type, age), from: "plan", reason: null, guideline };
};

const addMonths = (iso: string, months: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
};

/**
 * When it is next due: never done → now (null date, due); done with a date →
 * that date + the interval; done once and once is enough → never again.
 * `dueNow` = nothing on record, or the due date has come.
 */
export const nextDue = (last: LastDone | null, cadence: Cadence, today: string): { on: string | null; dueNow: boolean; done: boolean } => {
  if (!last) return { on: null, dueNow: true, done: false };
  if (cadence.months === null) return { on: null, dueNow: false, done: true };
  if (!last.on) return { on: null, dueNow: true, done: false }; // done before, date unknown: ask
  const on = addMonths(last.on, cadence.months);
  return { on, dueNow: on <= today, done: false };
};

/** "Every year", "Every 10 years", "Every 3 months", "Once". */
export const cadenceLabel = (months: number | null) => {
  if (months === null) return "Once";
  if (months % 12 === 0) return months === 12 ? "Every year" : `Every ${months / 12} years`;
  return months === 1 ? "Every month" : `Every ${months} months`;
};
