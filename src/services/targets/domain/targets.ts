/**
 * PROFILE TARGETS (Nov 22 2026, his ruling) — the person's own baseline, set
 * from who they are when onboarding ends, theirs to change, and independent of
 * any plan (a plan has a goal and an end; this is part of the profile). While a
 * HealthPlan is ACTIVE its targets win (resolve below).
 *
 * Pure. The numbers are general guidance, not a prescription:
 *   calories   Mifflin–St Jeor × activity (utils/calculateTDEE, as onboarding
 *              already did), rounded to 50
 *   protein    1.6 g/kg for people who train 3+ times a week, 1.2 g/kg below
 *              that; rounded to 5 g
 *   sleep      7 h — the adult minimum (AASM/SRS 2015)
 *   sessions   the days they train (training profile), else what they said
 *              about exercise, else 3
 *   active     150 min a week — the adult guideline (HHS 2018)
 */

export const TARGET_KEYS = ["calories", "proteinG", "sleepMinutes", "sessionsPerWeek", "activeMinutesWeek"] as const;
export type TargetKey = (typeof TARGET_KEYS)[number];
export type Targets = Record<TargetKey, number | null>;

export const SLEEP_MIN = 7 * 60;
export const ACTIVE_MIN_WEEK = 150;
export const DEFAULT_SESSIONS = 3;

/** Sane bounds for a value the person types (a typo never becomes a target). */
export const BOUNDS: Record<TargetKey, [number, number]> = {
  calories: [1000, 6000],
  proteinG: [30, 300],
  sleepMinutes: [300, 660],
  sessionsPerWeek: [0, 14],
  activeMinutesWeek: [0, 1500],
};

/** "Moderate exercise 2-3 times/week" → 3; "Every day" → 7; unknown → null. Takes the top of a range. */
export const sessionsFromFrequency = (frequency: string | null | undefined): number | null => {
  const f = (frequency ?? "").toLowerCase();
  if (!f) return null;
  if (/every day|daily|athlete/.test(f)) return 7;
  if (/never|little|no exercise|sedentary/.test(f)) return 0;
  const words: Record<string, number> = { once: 1, twice: 2, three: 3, four: 4, five: 5, six: 6 };
  for (const [w, n] of Object.entries(words)) if (f.includes(w)) return n;
  const nums = f.match(/\d+/g)?.map(Number).filter((n) => n <= 7);
  return nums?.length ? Math.max(...nums) : null;
};

export type TargetInput = {
  /** kg, cm, years; null when unknown. */
  weightKg: number | null;
  /** Mifflin–St Jeor result already computed (or the calorie target already on record). */
  calories: number | null;
  /** Training days from the training profile (preferredDays.length). */
  trainingDays: number | null;
  /** What they said about exercise in onboarding ("Moderate exercise 2-3 times/week"). */
  exerciseFrequency: string | null;
};

const round = (v: number, step: number) => Math.round(v / step) * step;

export const computeTargets = (i: TargetInput): Targets => {
  const sessions = i.trainingDays && i.trainingDays > 0 ? i.trainingDays : sessionsFromFrequency(i.exerciseFrequency) ?? DEFAULT_SESSIONS;
  const perKg = sessions >= 3 ? 1.6 : 1.2;
  return {
    calories: i.calories && i.calories >= 800 ? round(i.calories, 50) : null,
    proteinG: i.weightKg && i.weightKg > 25 ? round(i.weightKg * perKg, 5) : null,
    sleepMinutes: SLEEP_MIN,
    sessionsPerWeek: sessions,
    activeMinutesWeek: ACTIVE_MIN_WEEK,
  };
};

/** One line on where each computed number comes from — shown under it. */
export const whyOf = (key: TargetKey, t: Targets): string => {
  switch (key) {
    case "calories":
      return "From your age, sex, height, weight and how active you are";
    case "proteinG":
      return (t.sessionsPerWeek ?? 0) >= 3 ? "1.6 g per kg of body weight, for training 3 or more times a week" : "1.2 g per kg of body weight";
    case "sleepMinutes":
      return "The adult minimum: 7 hours a night";
    case "sessionsPerWeek":
      return "From how often you said you train";
    case "activeMinutesWeek":
      return "The adult guideline: 150 minutes of moderate activity a week";
  }
};

export type TargetFrom = "plan" | "you" | "profile";

/** The plan's target while one is active; otherwise the profile's (theirs or computed). */
export const resolveTarget = (plan: number | null | undefined, profile: number | null, editedByThem: boolean): { value: number | null; from: TargetFrom } =>
  plan !== null && plan !== undefined ? { value: plan, from: "plan" } : { value: profile, from: editedByThem ? "you" : "profile" };

export const inBounds = (key: TargetKey, v: number) => Number.isFinite(v) && v >= BOUNDS[key][0] && v <= BOUNDS[key][1];
