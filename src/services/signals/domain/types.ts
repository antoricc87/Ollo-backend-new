import { Baseline, NightRow } from "./baseline";

/**
 * SIGNALS — the shapes every detector speaks in.
 *
 * The design decision that matters: a detector decides WHETHER something is
 * worth knowing; it never decides how to say it and it never sends anything.
 * It returns a candidate with the numbers that tripped it, and the budget
 * (budget.ts) decides whether that candidate is the one thing worth
 * interrupting someone for this week. The model only ever writes the words.
 * That is what makes this replayable over past data and testable at all —
 * the old `watch_out` run asked an LLM to find something to say, which can be
 * neither.
 */

export type Direction = "CONCERN" | "POSITIVE";

/**
 * SEVERITY IS IN BARS, NOT UNITS. Every detector reports how far past its OWN
 * trigger threshold it is: 1.0 = exactly at the bar, 2.0 = twice as far past
 * it. Sigma from a personal baseline and "40% short of your protein target"
 * are not otherwise comparable, and without a common scale you cannot rank a
 * sleep candidate against a training one — which is the whole point of having
 * one weekly budget instead of ten hand-tuned thresholds.
 *
 * Calibration therefore lives in the bars themselves, which is where the
 * replay harness tunes them. Clinical priority lives in the detector's
 * `weight`, kept separate and explicit so nobody smuggles it into a threshold.
 */
export type Candidate = {
  detectorKey: string;
  detectorVersion: number;
  direction: Direction;
  /** Multiples of this detector's own bar. Below 1.0 the detector returns null. */
  severity: number;
  /** The numbers that tripped it — goes on the record verbatim. */
  evidence: Record<string, unknown>;
  /** The yardstick as it stood today: the baseline, or the plan target. */
  baseline?: Record<string, unknown> | null;
  /** One plain line for the replay harness, logs and the clinician surface.
   *  NOT user-facing copy — the agent writes that from the evidence. */
  label: string;
};

/** Plan targets, flattened to what detectors need. Null when there is no plan. */
export type PlanTargets = {
  sleepMinutes: number | null;
  sessionsPerWeek: number | null;
  proteinG: number | null;
  calories: number | null;
  /** kg per week, signed: negative when the plan is a deficit. */
  weightRateKgPerWeek: number | null;
};

/** One day of logged nutrition, already summed. */
export type DayRow = {
  date: string;
  /** False when nothing at all was logged that day. */
  logged: boolean;
  calories: number | null;
  proteinG: number | null;
};

export type WorkoutRow = {
  /** Local day the session happened on. */
  date: string;
  status: "COMPLETED" | "PLANNED" | "SKIPPED";
  minutes: number | null;
};

/**
 * Everything a detector may look at, assembled once per run (collect.ts) so
 * ten detectors do not each hit the database. `nights` and `days` are ascending
 * by date and END on `today`.
 */
export type SignalInput = {
  patientId: string;
  /** The day being evaluated, YYYY-MM-DD in the patient's zone. */
  today: string;
  timeZone: string;
  nights: NightRow[];
  days: DayRow[];
  workouts: WorkoutRow[];
  weights: { date: string; kg: number }[];
  plan: PlanTargets | null;
  /** Episodes still open, so a POSITIVE detector can notice a return to
   *  normal ("HRV back to your usual") — the one case where a detector has to
   *  know what came before to say anything worth saying. */
  openFindings: { detectorKey: string; firstDetectedAt: string; peakSeverity: number }[];
};

export type Yardstick = "usual" | "plan" | "rule";

export type Detector = {
  key: string;
  /** Bump when the RULE changes, so old findings stay interpretable. */
  version: number;
  /** Ranking priority. 1.0 is ordinary; raise it for things a clinician would
   *  want surfaced ahead of an equally-severe lifestyle drift. */
  weight: number;
  /** Consecutive quiet days before the episode resolves itself. Resolution is
   *  derived from the data only — Ollie never asks (ruling 2026-09-24). */
  resolveAfterDays: number;
  /** Days after a notification before this key may interrupt again. */
  cooldownDays: number;
  /** What `baseline` IS, so the note never dresses one up as another: this
   *  person's own usual, their plan's target, or a fixed rule that is the same
   *  for everyone (a rule read as a habit produced "you typically go about 3
   *  days between logs"). */
  against: Yardstick;
  run: (input: SignalInput) => Candidate | null;
};

/* ----------------------------- small helpers ---------------------------- */

/** Baseline rendered for the `baseline` column — mean/std/n, nothing computed. */
export const baselineJson = (b: Baseline) => ({ n: b.n, mean: round(b.mean), std: round(b.std) });

export const round = (v: number, dp = 2) => Math.round(v * 10 ** dp) / 10 ** dp;

/** The last `count` rows, oldest first. */
export const lastN = <T>(rows: T[], count: number) => rows.slice(Math.max(0, rows.length - count));

/** Days from `from` to `to` inclusive as YYYY-MM-DD, both already local keys. */
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
