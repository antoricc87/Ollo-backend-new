import { BOUNDS, TARGET_KEYS, type TargetKey, type Targets } from "./targets";

/**
 * THE HYBRID (Nov 22 2026, his ruling): code computes the starting numbers
 * (targets.ts); Ollie adjusts them from the Health ID (goals, conditions,
 * medications, lifestyle) and says why; CODE CHECKS the result — limits around
 * the starting numbers and fixed rules for the cases where a target is risky.
 * A number that fails a check is pulled back to the nearest safe value, and
 * the violation is recorded (the persona eval counts them).
 *
 * Fixed rules (general guidance; NEEDS CLINICAL REVIEW before launch):
 *   kidney disease     protein ≤ 0.8 g/kg (KDOQI 2020, non-dialysis CKD)
 *   pregnancy          calories never below the starting estimate; no deficit
 *   eating disorder    calories never below the starting estimate (history counts)
 *   pregnancy weeks    the starting estimate gets +340 kcal (weeks 14–27) or +450
 *                      (week 28 on) BEFORE Ollie sees it (ACOG / IOM)
 *   lean or normal     BMI < 22: no deficit at all, whatever they ask for; BMI 22–25:
 *                      at most 250 kcal under the estimate (rerun fix, Nov 22 2026)
 *   what they do now   workouts never below what they already do
 *   everyone           sleep ≥ 7 h; calories within ±25 % of the estimate and ≥ 1,200;
 *                      protein 0.6–2.2 g/kg
 */

export type Flags = { kidney: boolean; pregnant: boolean; eatingDisorder: boolean; pregnancyWeeks?: number | null };

/** What the record says, read from the Health ID text (and conditions) by code — never by the model. */
export const flagsFrom = (text: string): Flags => {
  const t = text.toLowerCase();
  return {
    kidney: /\b(ckd|chronic kidney|kidney disease|renal (disease|failure|insufficiency)|nephropathy|dialysis)\b/.test(t),
    pregnant: /\bpregnan(t|cy)\b/.test(t) && !/\b(not|no longer) pregnant\b/.test(t),
    eatingDisorder: /\b(anorexi|bulimi|eating disorder|binge[- ]eating disorder|arfid)/.test(t),
    pregnancyWeeks: pregnancyWeeksOf(t),
  };
};

/** "22 weeks", "week 30", "third trimester" → weeks (a trimester's first week); null when unsaid. */
export const pregnancyWeeksOf = (t: string): number | null => {
  if (!/\bpregnan/.test(t)) return null;
  const w = t.match(/\b(\d{1,2})\s*(?:weeks?|wks?)\b/) ?? t.match(/\bweek\s*(\d{1,2})\b/);
  if (w) return Number(w[1]);
  if (/third trimester/.test(t)) return 28;
  if (/second trimester/.test(t)) return 14;
  if (/first trimester/.test(t)) return 1;
  return null;
};

/** Extra energy in pregnancy by week: none in the first trimester. */
export const pregnancyExtra = (weeks: number | null | undefined) => (!weeks ? 0 : weeks >= 28 ? 450 : weeks >= 14 ? 340 : 0);

export type Body = { weightKg: number | null; heightCm: number | null };
export const bmiOf = (b: Body) => (b.weightKg && b.heightCm ? b.weightKg / (b.heightCm / 100) ** 2 : null);

/** What code changes in the starting numbers before Ollie sees them (pregnancy energy). */
export const prepareBase = (base: Targets, baseWhy: Record<TargetKey, string>, f: Flags): { base: Targets; baseWhy: Record<TargetKey, string> } => {
  const extra = f.pregnant ? pregnancyExtra(f.pregnancyWeeks) : 0;
  if (!extra || !base.calories) return { base, baseWhy };
  return {
    base: { ...base, calories: base.calories + extra },
    baseWhy: { ...baseWhy, calories: `Your estimate plus ${extra} kcal for this stage of pregnancy` },
  };
};

export type Proposed = Record<TargetKey, { value: number; why: string }>;
export type Checked = { targets: Targets; why: Record<TargetKey, string>; violations: { key: TargetKey; proposed: number; kept: number; rule: string }[] };

const round = (v: number, step: number) => Math.round(v / step) * step;
const STEP: Record<TargetKey, number> = { calories: 50, proteinG: 5, sleepMinutes: 15, sessionsPerWeek: 1, activeMinutesWeek: 5 };

/** Limits for one key given the starting numbers and what the record says: [min, max, rule name]. */
export const limitsFor = (key: TargetKey, base: Targets, body: Body, f: Flags): { min: number; max: number; rule: string }[] => {
  const weightKg = body.weightKg;
  const bmi = bmiOf(body);
  const out: { min: number; max: number; rule: string }[] = [{ min: BOUNDS[key][0], max: BOUNDS[key][1], rule: "bounds" }];
  if (key === "calories" && base.calories) {
    out.push({ min: Math.max(1200, base.calories * 0.75), max: base.calories * 1.25, rule: "±25% of the estimate" });
    if (f.pregnant) out.push({ min: base.calories, max: Infinity, rule: "pregnancy: no deficit" });
    if (f.eatingDisorder) out.push({ min: base.calories, max: Infinity, rule: "eating disorder: no deficit" });
    if (bmi !== null && bmi < 22) out.push({ min: base.calories, max: Infinity, rule: "BMI under 22: no deficit" });
    else if (bmi !== null && bmi < 25) out.push({ min: base.calories - 250, max: Infinity, rule: "BMI 22–25: at most 250 kcal under" });
  }
  if (key === "proteinG" && weightKg) {
    out.push({ min: 0.6 * weightKg, max: 2.2 * weightKg, rule: "0.6–2.2 g/kg" });
    if (f.kidney) out.push({ min: 0, max: 0.8 * weightKg, rule: "kidney disease: ≤ 0.8 g/kg" });
  }
  if (key === "sleepMinutes") out.push({ min: 420, max: 600, rule: "7–10 h" });
  if (key === "sessionsPerWeek") out.push({ min: Math.min(base.sessionsPerWeek ?? 0, 7), max: 7, rule: "not below what they do now, at most 7" });
  return out;
};

/** When code moved a number, the line says the rule that moved it — never the reason for the number it replaced. */
const RULE_WHY: Record<string, string> = {
  "kidney disease: ≤ 0.8 g/kg": "Kidney disease: at most 0.8 g per kg",
  "pregnancy: no deficit": "No calorie cut during pregnancy",
  "eating disorder: no deficit": "Kept at your estimate",
  "BMI under 22: no deficit": "Your weight is already in a healthy range",
  "BMI 22–25: at most 250 kcal under": "A small cut: your weight is near the healthy range",
  "±25% of the estimate": "A safe pace from your estimate",
  "7–10 h": "The adult minimum",
  "not below what they do now, at most 7": "Not below what you do now",
  "0.6–2.2 g/kg": "From your weight and training",
};

/** Pull each proposed number inside every limit; fall back to the starting number when the model gave none. */
export const checkAdjusted = (base: Targets, proposed: Partial<Proposed>, baseWhy: Record<TargetKey, string>, body: Body, flags: Flags): Checked => {
  const targets = { ...base };
  const why = { ...baseWhy };
  const violations: Checked["violations"] = [];
  for (const key of TARGET_KEYS) {
    const p = proposed[key];
    if (!p || !Number.isFinite(p.value)) continue;
    if (base[key] === null) continue; // nothing to start from (no weight, no estimate): never invented
    const limits = limitsFor(key, base, body, flags);
    const lo = Math.max(...limits.map((l) => l.min));
    const hi = Math.min(...limits.map((l) => l.max));
    let v = p.value;
    let broke: string | null = null;
    for (const l of limits) {
      if (v < l.min) (v = l.min), (broke = l.rule);
      if (v > l.max) (v = l.max), (broke = l.rule);
    }
    // Rounding must not step back over a limit: round, then nudge inward by a step if it did.
    let safe = round(v, STEP[key]);
    if (safe > hi) safe = Math.floor(hi / STEP[key]) * STEP[key];
    if (safe < lo) safe = Math.ceil(lo / STEP[key]) * STEP[key];
    targets[key] = safe;
    if (broke) {
      violations.push({ key, proposed: p.value, kept: safe, rule: broke });
      why[key] = RULE_WHY[broke] ?? (safe === base[key] ? baseWhy[key] : "Kept inside a safe range");
    } else why[key] = p.why?.trim() || baseWhy[key];
  }
  return { targets, why, violations };
};

/* --------------------------------- prompt --------------------------------- */

export const ADJUST_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [...TARGET_KEYS],
  properties: Object.fromEntries(
    TARGET_KEYS.map((k) => [k, { type: "object", additionalProperties: false, required: ["value", "why"], properties: { value: { type: "number" }, why: { type: "string" } } }])
  ),
} as const;

export const adjustPrompt = (input: { base: Targets; baseWhy: Record<TargetKey, string>; facts: string; healthId: string | null; bmi?: number | null }) => ({
  system: [
    "You set a person's daily and weekly health targets, like a careful coach who has read their profile.",
    "You get starting numbers computed by formulas (energy estimate, protein per kg, the adult sleep minimum, how often they train, the activity guideline) and their Health ID.",
    "Adjust a number ONLY when something in their profile gives a clear reason: a goal (losing or gaining weight, a race), a condition or medication, pregnancy, age, their job or schedule, what they already do. Otherwise keep the starting number exactly.",
    "Calories: a weight-loss goal with a BMI of 25 or more → a moderate deficit (about 300–500 kcal); BMI 22–25 → at most 250; BMI under 22 → no deficit, even if they ask (say kindly that their weight is already in a healthy range). Gaining muscle → a small surplus (about 200–300). Never a deficit in pregnancy or with any eating-disorder history; the pregnancy extra is already in the starting number. Protein: kidney disease → at most 0.8 g/kg. Sleep: never below 7 h.",
    "Workouts and active minutes: never below what their profile says they already do (6 runs a week stays 6; 55 km of running a week is well over 300 active minutes — set at least that). Someone starting from nothing builds up gradually: 2 sessions and about 90 active minutes to begin.",
    "Units: calories kcal a day, proteinG grams a day, sleepMinutes minutes a night, sessionsPerWeek workouts a week, activeMinutesWeek minutes a week.",
    "For each target write `why`, at most 90 characters, plain words, no filler. A CHANGED number names their reason (\"You want to lose 15 lb\", \"Kidney disease: protein kept low\", \"You already sleep 8 hours\"). A KEPT number names only its basis in 2–6 words (\"The adult minimum\", \"From your weight and training\", \"From your age, size and activity\"). Never start with \"This is\", \"Kept\" or \"Because\"; never say what they do not have. No diagnosis, no medical advice beyond the target, no lab numbers.",
  ].join("\n"),
  user: `${input.bmi ? `BMI: ${input.bmi.toFixed(1)}\n\n` : ""}Starting numbers:\n${TARGET_KEYS.map((k) => `- ${k}: ${input.base[k] ?? "unknown (leave as 0)"} — ${input.baseWhy[k]}`).join("\n")}\n\nAbout them:\n${input.facts}\n\nHealth ID:\n${input.healthId ?? "(nothing yet)"}`,
});
