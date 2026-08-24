import { Unit } from "../mealAnalysis.schema";
import { ReferencePortion } from "./foodResolver.types";

/** Fixed conversions that never need a reference portion. */
export const FIXED_GRAMS: Partial<Record<Unit, number>> = {
  g: 1,
  ml: 1,
  oz: 28.3495,
  fl_oz: 29.5735,
  lb: 453.592,
};

const UNIT_PATTERNS: Partial<Record<Unit, RegExp[]>> = {
  cup: [/^1 cup$/, /^1 cup\b/],
  tbsp: [/^1 (tbsp|tablespoon)\b/],
  tsp: [/^1 (tsp|teaspoon)\b/],
  slice: [/^1 slice$/, /^1 slice\b/],
  serving: [/^1 serving\b/, /^1 (each|unit|piece)\b/],
};

/**
 * Find the reference portion for the model's unit. Returns grams for ONE unit,
 * or null when no suitable portion exists. Pure — unit tested.
 */
export function matchPortion(
  unit: Unit,
  foodName: string,
  portions: ReferencePortion[]
): { label: string; gramWeight: number } | null {
  if (!portions?.length) return null;
  const tryPatterns = (patterns: RegExp[]) => {
    for (const re of patterns) {
      const hit = portions.find((p) => re.test(p.label));
      if (hit) return hit;
    }
    return null;
  };
  if (unit === "whole" || unit === "piece") {
    const head = (foodName || "").toLowerCase().split(/\s+/)[0]?.replace(/[^a-z]/g, "");
    const base = head ? head.replace(/s$/, "") : "";
    // The label must name the food itself ("1 banana", "1 medium apple", "1 each taco");
    // bare "1 medium" / "1 piece" labels describe unrelated portions too often.
    if (!base) return null;
    const patterns: RegExp[] = [
      new RegExp(`^1 ${base}s?\\b`),
      new RegExp(`^1 (small|medium|large|regular) ${base}s?\\b`),
      new RegExp(`^1 (each|whole) ${base}s?\\b`),
      new RegExp(`^1 medium\\b.*\\b${base}`),
    ];
    return tryPatterns(patterns);
  }
  const patterns = UNIT_PATTERNS[unit];
  return patterns ? tryPatterns(patterns) : null;
}

/** Grams for `quantity` of `unit`, using fixed conversions or a matched reference portion. */
export function gramsFromReference(
  quantity: number,
  unit: Unit,
  foodName: string,
  portions: ReferencePortion[]
): { grams: number; label: string } | null {
  const fixed = FIXED_GRAMS[unit];
  if (fixed) return { grams: quantity * fixed, label: `1 ${unit} = ${fixed} g` };
  const hit = matchPortion(unit, foodName, portions);
  return hit ? { grams: quantity * hit.gramWeight, label: `${hit.label} = ${hit.gramWeight} g` } : null;
}
