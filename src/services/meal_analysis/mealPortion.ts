import { PORTION_STOPS, PortionStop } from "./mealAnalysis.schema";

/**
 * The meal portion dial — "how much of it", as one coarse choice per meal.
 *
 * The analyser already reports a plausible range for every item
 * (`gramsLow` ≤ `grams` ≤ `gramsHigh`, see mealAnalysis.prompt.ts Step 2). The
 * dial moves inside that band instead of inventing new numbers, so a person can
 * say "I ate a lot" rather than quantifying five ingredients.
 *
 * Two rules keep it honest:
 *  - a portion the user stated (`portionSource` "user") or a branded item's own
 *    size ("brand") NEVER moves, at any stop;
 *  - grams are always recomputed from the pristine `gramsBase` and band, never
 *    from the current grams, so the dial is idempotent AND reversible: moving
 *    to "hearty" and back to "normal" restores the analyser's own number
 *    (`gramsBase`/`gramsLow`/`gramsHigh` are left untouched by `rescaleTo`).
 *
 * Pure — unit tested in ./tests/mealPortion.test.ts.
 */

export { PORTION_STOPS, type PortionStop };

export const DEFAULT_PORTION_STOP: PortionStop = "normal";

/** Portions these came from are the user's own words: the dial leaves them alone. */
export const FIXED_PORTION_SOURCES = new Set(["user", "brand"]);

/** "A lot" sits above the band's top — the only stop that leaves the model's range. */
export const LOTS_OVER_HIGH = 1.25;

/**
 * Used per side when the model gave no band there (gramsLow === grams, or
 * gramsHigh === grams). Mirrors the size-word scale in mealAnalysis.prompt.ts
 * so the dial and the words ("a big plate") agree.
 */
export const FALLBACK_FACTORS: Record<PortionStop, number> = {
  light: 0.7,
  normal: 1,
  hearty: 1.4,
  lots: 1.8,
};

/** Matches the bounds MealEditsSchema accepts for an explicit gram edit. */
export const MIN_GRAMS = 1;
export const MAX_GRAMS = 5000;

export type PortionIngredient = {
  grams: number;
  /** The analyser's own grams, stamped once and never rescaled. Falls back to `grams`. */
  gramsBase?: number | null;
  gramsLow?: number | null;
  gramsHigh?: number | null;
  portionSource?: string | null;
};

/** The number every stop is derived from — set once, before the dial is ever applied. */
export const portionBase = (ing: PortionIngredient): number => {
  const base = Number(ing.gramsBase);
  return isFinite(base) && base > 0 ? base : Math.max(0, Number(ing.grams) || 0);
};

/** Stamp `gramsBase` on ingredients that don't have it yet (mutates; call on copies). */
export function ensurePortionBase(ings: any[]): void {
  for (const ing of ings) {
    if (!(isFinite(Number(ing.gramsBase)) && Number(ing.gramsBase) > 0)) {
      ing.gramsBase = Math.max(0, Number(ing.grams) || 0);
    }
  }
}

export const isPortionStop = (v: unknown): v is PortionStop =>
  typeof v === "string" && (PORTION_STOPS as readonly string[]).includes(v);

/**
 * True when the dial may move this item — i.e. the analyser assumed the amount
 * AND there is a weight to scale. Legacy rows backfilled from a bare FoodEntry
 * carry no grams, so they can never scale and must not make a meal look dial-able.
 */
export const isPortionScalable = (ing: PortionIngredient): boolean =>
  portionBase(ing) > 0 && !FIXED_PORTION_SOURCES.has(String(ing.portionSource ?? ""));

/** A meal is dial-able when at least one of its items was assumed. */
export const isMealPortionScalable = (ings: PortionIngredient[]): boolean =>
  ings.some(isPortionScalable);

/** Small amounts (a tsp of oil) keep a decimal; anything else is whole grams. */
const roundGrams = (g: number): number =>
  g < 20 ? Math.round(g * 10) / 10 : Math.round(g);

const clamp = (g: number): number => Math.min(MAX_GRAMS, Math.max(MIN_GRAMS, g));

/** Grams for one item at one stop. Fixed portions return their own grams unchanged. */
export function scaledGrams(ing: PortionIngredient, stop: PortionStop): number {
  const base = portionBase(ing);
  if (!base) return base;
  if (!isPortionScalable(ing)) return base;
  if (stop === "normal") return base;

  const low = Number(ing.gramsLow);
  const high = Number(ing.gramsHigh);
  const hasLow = isFinite(low) && low > 0 && low < base;
  const hasHigh = isFinite(high) && high > base;

  let target: number;
  if (stop === "light") target = hasLow ? low : base * FALLBACK_FACTORS.light;
  else if (stop === "hearty") target = hasHigh ? high : base * FALLBACK_FACTORS.hearty;
  else target = hasHigh ? high * LOTS_OVER_HIGH : base * FALLBACK_FACTORS.lots;

  return roundGrams(clamp(target));
}

/** Every stop at once — sent to the app so the card never does this arithmetic itself. */
export function gramsAtEveryStop(ing: PortionIngredient): Record<PortionStop, number> {
  return {
    light: scaledGrams(ing, "light"),
    normal: scaledGrams(ing, "normal"),
    hearty: scaledGrams(ing, "hearty"),
    lots: scaledGrams(ing, "lots"),
  };
}

/**
 * Scale one ingredient (already a copy) to an absolute gram target: quantity,
 * calories and every numeric nutrient move with it. `gramsBase`/`gramsLow`/
 * `gramsHigh` are left alone — they are the pristine reference the dial keeps
 * recomputing from.
 * `portionSource` is the caller's business: an explicit edit becomes "user",
 * the dial leaves it as it found it.
 */
export function rescaleTo(ing: any, targetGrams: number): void {
  const from = Number(ing.grams) || 0;
  const factor = from > 0 ? targetGrams / from : 1;
  if (factor === 1) return;
  ing.grams = targetGrams;
  ing.quantity = Math.round((Number(ing.quantity) || 1) * factor * 100) / 100;
  ing.calories = Math.round((Number(ing.calories) || 0) * factor * 10) / 10;
  if (ing.nutrients && typeof ing.nutrients === "object") {
    for (const k of Object.keys(ing.nutrients)) {
      if (typeof ing.nutrients[k] === "number") {
        ing.nutrients[k] = Math.round(ing.nutrients[k] * factor * 1000) / 1000;
      }
    }
  }
}

/**
 * Apply a stop to a meal's ingredients in place (they must already be copies).
 * Idempotent: every target is derived from the untouched band.
 */
export function applyPortionStop(ings: any[], stop: PortionStop): void {
  ensurePortionBase(ings);
  for (const ing of ings) rescaleTo(ing, scaledGrams(ing, stop));
}

/** Total kcal a meal would carry at one stop, without mutating anything. */
export function caloriesAtStop(
  ings: (PortionIngredient & { calories?: number | null })[],
  stop: PortionStop
): number {
  return ings.reduce((acc, i) => {
    const grams = Math.max(0, Number(i.grams) || 0);
    const kcal = Number(i.calories) || 0;
    if (!grams) return acc + kcal;
    return acc + (kcal * scaledGrams(i, stop)) / grams;
  }, 0);
}
