import { caloriesAtStop, ensurePortionBase, FALLBACK_FACTORS, isPortionScalable, rescaleTo } from "./mealPortion";
import type { AnalyzedIngredient, Unit } from "./mealAnalysis.schema";

/**
 * portion_check — "I'm having X, how much of it?" (Sep 21 2026).
 *
 * The person has already chosen the food; the question is the amount. So this
 * never swaps the dish, never offers alternatives and never bends the
 * nutrition toward a budget: it takes the analyser's grounded ingredients and
 * decides ONE scale factor, then says honestly where that leaves the day.
 *
 * Two modes, decided by what the person said:
 *  - on_hand: every item with calories was STATED ("a 400 g pizza", "this
 *    500 g box") → the answer is a fraction of what they have, snapped to a
 *    word people use (a third, half…), never more than all of it.
 *  - assumed: at least one amount was assumed by the analyser → the whole
 *    plate scales together, never below `minKcal` (300 for a main, 100 for a
 *    snack — the minimums suggest_meal uses; smaller is no meal at all, so we
 *    say how far over a small plate lands instead) and never above the
 *    portion dial's "hearty" (room left over is reported, not piled on the
 *    plate). The floor was first the dial's "light" stop; on real data that
 *    refused a sensible ~510 kcal pasta dinner because the analyser's light
 *    plate was 740 — the band describes plausible portions, not the smallest
 *    meal worth eating. A stated amount
 *    ("my 400 g pizza and a salad") is what they HAVE, so it shrinks with the
 *    plate but never grows past it.
 *
 * Pure — tests in tests/portionCheck.test.ts.
 */

export type PortionMode = "on_hand" | "assumed";
export type PortionVerdict =
  | "fits" // the portion lands on the aim
  | "all_fits" // on_hand: all of it fits, with room left
  | "light_over" // assumed: even the smallest sensible plate goes over the aim
  | "room_left" // assumed: a hearty plate still leaves room
  | "none_left" // on_hand: nothing left today
  | "no_target"; // no calorie target to size against

export type PortionIngredientOut = {
  name: string;
  /** "200 g", "4 slice", "1.5 cup" — in the person's own unit when they gave one. */
  amount: string;
  grams: number;
  calories: number;
  /** The amount they said they have, when stated. */
  onHand: string | null;
  stated: boolean;
};

export type PortionPlan = {
  mode: PortionMode;
  verdict: PortionVerdict;
  /** Scale applied to the scalable part (on_hand: the whole thing). */
  factor: number;
  /** "About half" / "A normal plate" / "All of it". */
  headline: string;
  ingredients: PortionIngredientOut[];
  totals: { calories: number; protein_g: number; carbs_g: number; fat_g: number };
  /** Calories of a normal (unscaled) portion — what the analyser read. */
  normalKcal: number;
};

const r0 = (n: number) => Math.round(n);
const r1 = (n: number) => Math.round(n * 10) / 10;
const sum = (xs: number[]) => xs.reduce((a, b) => a + (Number(b) || 0), 0);

/** Fractions people say, and how they say them. */
export const FRACTIONS: [number, string][] = [
  [0.25, "About a quarter"],
  [1 / 3, "About a third"],
  [0.5, "About half"],
  [2 / 3, "About two thirds"],
  [0.75, "About three quarters"],
  [1, "All of it"],
];

/** Snap a 0–1 share of what's on hand to the nearest spoken fraction. Below ~⅕ it stays a percentage. */
export const snapFraction = (f: number): { value: number; label: string } => {
  if (f >= 0.95) return { value: 1, label: "All of it" };
  if (f < 0.2) {
    const pct = Math.max(5, Math.round((f * 100) / 5) * 5);
    return { value: pct / 100, label: `About ${pct}%` };
  }
  let best = FRACTIONS[0];
  for (const fr of FRACTIONS) if (Math.abs(fr[0] - f) < Math.abs(best[0] - f)) best = fr;
  return { value: best[0], label: best[1] };
};

/** Words for a plate relative to a normal one (assumed mode). Steps of 0.05 so grams don't pretend precision. */
export const plateLabel = (f: number): string => {
  if (f >= 0.93 && f <= 1.07) return "A normal plate";
  if (f < 0.93) return `A smaller plate — about ${Math.round(f * 100 / 5) * 5}% of a normal one`;
  return `A bigger plate — about ${Math.round(f * 100 / 5) * 5}% of a normal one`;
};

const macros = (ings: AnalyzedIngredient[]) => ({
  calories: r0(sum(ings.map((i) => i.calories))),
  protein_g: r1(sum(ings.map((i) => i.nutrients.proteins))),
  carbs_g: r1(sum(ings.map((i) => i.nutrients.carbohydrates))),
  fat_g: r1(sum(ings.map((i) => i.nutrients.fats))),
});

const UNIT_WORD: Partial<Record<Unit, [string, string]>> = {
  whole: ["whole", "whole"],
  piece: ["piece", "pieces"],
  slice: ["slice", "slices"],
  cup: ["cup", "cups"],
  serving: ["serving", "servings"],
  tbsp: ["tbsp", "tbsp"],
  tsp: ["tsp", "tsp"],
  oz: ["oz", "oz"],
  fl_oz: ["fl oz", "fl oz"],
  lb: ["lb", "lb"],
};
/** Counts to the nearest half, written the way people say them: "2½ slices", "½ cup". */
export const countText = (quantity: number, unit: Unit): string => {
  const half = Math.round(quantity * 2) / 2;
  const whole = Math.floor(half);
  const n = half === 0 ? "a little" : `${whole || ""}${half % 1 ? "½" : ""}`;
  const [one, many] = UNIT_WORD[unit] ?? [unit, unit];
  return `${n} ${half > 1 ? many : one}`;
};

const amountText = (ing: { quantity?: number; unit?: Unit; grams?: number }) => {
  const g = r0(Number(ing.grams) || 0);
  return !ing.unit || ing.unit === "g" || ing.unit === "ml" || !ing.quantity ? `${g} ${ing.unit === "ml" ? "ml" : "g"}` : `${countText(ing.quantity, ing.unit)} (≈${g} g)`;
};

/**
 * Decide the portion. `aimKcal` = what this meal should carry (null when
 * there is no target at all). Input ingredients are not mutated.
 */
export function planPortion(input: AnalyzedIngredient[], aimKcal: number | null, minKcal = 300): PortionPlan {
  const ings: AnalyzedIngredient[] = input.map((i) => ({ ...i, nutrients: { ...i.nutrients } }));
  ensurePortionBase(ings as any[]);
  const normal = macros(ings);
  const withKcal = ings.filter((i) => (i.calories || 0) > 0);
  const scalable = ings.filter((i) => isPortionScalable(i as any));
  const mode: PortionMode = withKcal.length > 0 && scalable.length === 0 ? "on_hand" : "assumed";
  const stated = (i: AnalyzedIngredient) => !isPortionScalable(i as any);
  const onHand = new Map(ings.map((i) => [i, stated(i) ? amountText(i) : null] as const));

  let factor = 1;
  let verdict: PortionVerdict = "fits";
  let headline: string;

  if (aimKcal == null) {
    verdict = "no_target";
    headline = mode === "on_hand" ? "All of it" : "A normal plate";
  } else if (mode === "on_hand") {
    const total = normal.calories;
    if (aimKcal <= 0) {
      verdict = "none_left";
      factor = 0;
      headline = "Today's calories are already used";
    } else if (aimKcal >= total * 0.95) {
      verdict = "all_fits";
      headline = "All of it";
    } else {
      const snap = snapFraction(aimKcal / total);
      factor = snap.value;
      headline = snap.label;
    }
    if (factor !== 1) for (const i of ings) rescaleTo(i, Math.max(0, i.grams * factor));
  } else {
    // The band comes from the assumed items (the only ones with one).
    const scalableKcal = sum(scalable.map((i) => i.calories));
    const lightF = normal.calories > 0 ? Math.min(1, minKcal / normal.calories) : FALLBACK_FACTORS.light;
    const heartyF = scalableKcal > 0 ? caloriesAtStop(scalable as any, "hearty") / scalableKcal : FALLBACK_FACTORS.hearty;
    const want = normal.calories > 0 ? aimKcal / normal.calories : 1;
    if (want < lightF) {
      verdict = "light_over";
      factor = lightF;
    } else if (want > heartyF) {
      verdict = "room_left";
      factor = heartyF;
    } else {
      factor = want;
    }
    factor = Math.round(factor * 20) / 20 || lightF; // 5 % steps
    for (const i of ings) rescaleTo(i, Math.max(0, i.grams * (stated(i) ? Math.min(1, factor) : factor)));
    headline = plateLabel(factor);
  }

  return {
    mode,
    verdict,
    factor,
    headline,
    normalKcal: normal.calories,
    ingredients: ings.map((i) => ({
      name: i.name,
      amount: amountText(i),
      grams: r0(i.grams),
      calories: r0(i.calories),
      onHand: onHand.get(i) ?? null,
      stated: stated(i),
    })),
    totals: macros(ings),
  };
}

/**
 * The one factual line about the day — the same shape suggest_meal's `fit`
 * uses. `kcalLeft` = what is left of today's MID target before this meal;
 * `range` = today's target range; `laterSlots` = meals still to come.
 */
export function portionLine(plan: PortionPlan, b: { eatenKcal: number; kcalLeft: number | null; aimKcal: number | null; range: [number | null | undefined, number | null | undefined] | null; laterSlots: string[] }): string {
  const kcal = plan.totals.calories;
  const [min, max] = b.range ?? [null, null];
  const rangeText = min != null && max != null ? `${min}–${max}` : `${min ?? max ?? "?"}`;
  const dayAfter = r0(b.eatenKcal + kcal);
  switch (plan.verdict) {
    case "no_target":
      return `About ${kcal} kcal — there's no calorie target to size it against.`;
    case "none_left":
      return `Today is already at ${r0(b.eatenKcal)} of ${rangeText} kcal. A quarter of it would add about ${r0(plan.normalKcal / 4)} kcal.`;
    case "light_over":
      // Meals still to come → talk about this meal's share, not where the day lands (it hasn't).
      return b.laterSlots.length && b.kcalLeft != null
        ? `Even a small plate is about ${kcal} kcal — ${r0(kcal - (b.aimKcal ?? 0))} over this meal's share, leaving about ${Math.max(0, r0(b.kcalLeft - kcal))} for ${b.laterSlots.map((s) => s.toLowerCase()).join(", ").replace(/, ([^,]*)$/, " and $1")}.`
        : `Even a small plate is about ${kcal} kcal — ${r0(kcal - (b.aimKcal ?? 0))} over what's left for this meal; the day would land near ${dayAfter} of ${rangeText}.`;
    case "all_fits":
    case "room_left":
    case "fits": {
      if (b.laterSlots.length && b.kcalLeft != null) {
        const later = Math.max(0, r0(b.kcalLeft - kcal));
        return `${kcal} kcal — leaves about ${later} for ${b.laterSlots.map((s) => s.toLowerCase()).join(", ").replace(/, ([^,]*)$/, " and $1")}.`;
      }
      const spare = b.kcalLeft != null ? r0(b.kcalLeft - kcal) : null;
      return plan.verdict === "fits" || spare == null || spare < 100
        ? `${kcal} kcal — the day lands at about ${dayAfter} of ${rangeText}.`
        : `${kcal} kcal — the day lands at about ${dayAfter} of ${rangeText}, with about ${spare} to spare.`;
    }
  }
}
