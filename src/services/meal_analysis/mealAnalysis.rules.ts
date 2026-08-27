import {
  AnalyzedIngredient,
  Ingredient,
  Warning,
} from "./mealAnalysis.schema";
import { IngredientResolution } from "./resolver/foodResolver.types";

export const LLM_ONLY_RESOLUTION: IngredientResolution = {
  nutrientSource: "llm",
  method: "fallback",
  reason: "resolver_disabled",
  matchScore: null,
  reference: null,
  per100g: null,
  portionNote: null,
};

/**
 * Deterministic rules applied on top of the model output (Stage C).
 * Pure functions — unit tested in ./tests.
 */

export const VEG_SERVING_G = 80; // ½ cup cooked / ~1 cup raw
export const FRUIT_SERVING_G = 150; // 1 medium fruit / 1 cup diced

export interface ConditionFlags {
  diabetes: boolean;
  hypertension: boolean;
  heart: boolean;
  kidney: boolean;
  ibs: boolean;
}

export const NO_CONDITIONS: ConditionFlags = {
  diabetes: false,
  hypertension: false,
  heart: false,
  kidney: false,
  ibs: false,
};

/** Map free-text condition names from the patient summary to rule flags. */
export function detectConditions(conditionNames: string[]): ConditionFlags {
  const t = conditionNames.join(" | ").toLowerCase();
  return {
    diabetes: /diabet|hyperglyc|insulin resist|prediabet/.test(t),
    hypertension: /hypertens|high blood pressure/.test(t),
    heart:
      /cholesterol|hyperlipid|dyslipid|heart|cardio|coronary|atheroscler/.test(
        t
      ),
    kidney: /kidney|renal|\bckd\b|nephro/.test(t),
    ibs: /\bibs\b|irritable bowel/.test(t),
  };
}

const r0 = (n: number) => Math.round(n);
export const round1 = (n: number) => Math.round(n * 10) / 10;

/** Condition-aware warnings for one ingredient. Thresholds are per item. */
export function warningsFor(
  ing: Ingredient,
  flags: ConditionFlags = NO_CONDITIONS
): Warning[] {
  const n = ing.nutrients;
  const out: Warning[] = [];
  const add = (warning: string, severity: number, condition: string | null) =>
    out.push({ warning, severity, condition });
  const sugar = (n.naturalSugar || 0) + (n.addedSugar || 0);

  if (flags.diabetes) {
    if (sugar > 15) {
      add(
        `High sugar (${r0(sugar)} g) — likely to raise blood glucose`,
        4,
        "Diabetes"
      );
    } else if (n.carbohydrates > 40) {
      add(
        `High carbohydrate (${r0(n.carbohydrates)} g) — watch the blood-sugar response`,
        3,
        "Diabetes"
      );
    }
    if (ing.glycemicIndex > 70 && n.carbohydrates >= 10) {
      add(
        `High glycemic index (${r0(ing.glycemicIndex)}) — fast-acting carbohydrate`,
        3,
        "Diabetes"
      );
    }
  }
  if (flags.hypertension && n.sodium > 600) {
    add(
      `High sodium (${r0(n.sodium)} mg) — can raise blood pressure`,
      4,
      "Hypertension"
    );
  }
  if (flags.heart) {
    if (n.saturatedFats > 8) {
      add(
        `High saturated fat (${r0(n.saturatedFats)} g) — raises LDL cholesterol`,
        4,
        "Heart health"
      );
    }
    if (n.cholesterol > 100) {
      add(
        `High dietary cholesterol (${r0(n.cholesterol)} mg)`,
        3,
        "Heart health"
      );
    }
  }
  if (flags.kidney) {
    if (n.sodium > 500) {
      add(`High sodium (${r0(n.sodium)} mg) — adds to kidney load`, 3, "Kidney disease");
    }
    if (n.potassium > 700) {
      add(
        `High potassium (${r0(n.potassium)} mg) — risk of electrolyte imbalance`,
        4,
        "Kidney disease"
      );
    }
    if (n.proteins > 25) {
      add(
        `High protein (${r0(n.proteins)} g) — increases kidney workload`,
        3,
        "Kidney disease"
      );
    }
  }
  if (flags.ibs && n.fiber > 10) {
    add(
      `High fiber (${r0(n.fiber)} g) — may trigger digestive symptoms`,
      2,
      "IBS"
    );
  }

  // General warnings only when no condition-specific one fired for this item.
  if (out.length === 0) {
    if (n.sodium > 800) {
      add(`High in sodium (${r0(n.sodium)} mg); consume in moderation`, 3, null);
    }
    if (n.addedSugar > 20) {
      add(
        `High in added sugar (${r0(n.addedSugar)} g); consume in moderation`,
        3,
        null
      );
    }
    if (n.saturatedFats > 10) {
      add(
        `High in saturated fat (${r0(n.saturatedFats)} g); consume in moderation`,
        3,
        null
      );
    } else if (n.fats > 30) {
      add(`High in fat (${r0(n.fats)} g); consume in moderation`, 2, null);
    }
  }
  return out;
}

/** Fruit / vegetable servings: computed from grams for plain produce, model value for mixed dishes. */
export function servingsFor(ing: Ingredient): {
  vegetableServings: number;
  fruitServings: number;
} {
  if (ing.foodGroup === "vegetable") {
    return {
      vegetableServings: round1(ing.grams / VEG_SERVING_G),
      fruitServings: 0,
    };
  }
  if (ing.foodGroup === "fruit") {
    return {
      vegetableServings: 0,
      fruitServings: round1(ing.grams / FRUIT_SERVING_G),
    };
  }
  return {
    vegetableServings: round1(Math.max(0, ing.vegetableServings || 0)),
    fruitServings: round1(Math.max(0, ing.fruitServings || 0)),
  };
}

/** Glycemic load = Σ GI × carbs / 100 (same formula the app used client-side). */
export function glycemicLoad(ings: Pick<Ingredient, "glycemicIndex" | "nutrients">[]): number {
  return round1(
    ings.reduce((acc, i) => {
      const gi = i.glycemicIndex || 0;
      const carbs = i.nutrients?.carbohydrates || 0;
      return acc + (gi * carbs) / 100;
    }, 0)
  );
}

/** Clamp / sanitise model output so downstream code never sees nonsense. */
export function normalizeIngredient(ing: Ingredient): Ingredient {
  const grams = Math.max(0, ing.grams || 0);
  const low = Math.min(Math.max(0, ing.gramsLow || grams), grams);
  const high = Math.max(ing.gramsHigh || grams, grams);
  const confidence = Math.min(1, Math.max(0, ing.confidence ?? 0.5));
  const nutrients = { ...ing.nutrients };
  for (const k of Object.keys(nutrients) as (keyof typeof nutrients)[]) {
    const v = nutrients[k];
    nutrients[k] = typeof v === "number" && isFinite(v) ? Math.max(0, v) : 0;
  }
  return {
    ...ing,
    quantity: Math.max(0, ing.quantity || 0),
    grams,
    gramsLow: low,
    gramsHigh: high,
    confidence,
    calories: Math.max(0, ing.calories || 0),
    glycemicIndex: Math.min(110, Math.max(0, ing.glycemicIndex || 0)),
    portionAssumption: ing.portionAssumption ?? null,
    nutrients,
  };
}

/** Drop exact duplicates the model occasionally emits (same name, quantity, unit and grams). */
export function dedupeIngredients<T extends Pick<Ingredient, "name" | "quantity" | "unit" | "grams">>(ings: T[]): T[] {
  const seen = new Set<string>();
  const exact = ings.filter((i) => {
    const key = `${(i.name || "").trim().toLowerCase()}|${i.quantity}|${i.unit}|${Math.round(i.grams)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  // A composite row that restates two or more of its own components
  // ("Greek yogurt with honey" next to "Greek yogurt" and "Honey") double-counts them.
  const names = exact.map((i) => (i.name || "").trim().toLowerCase());
  return exact.filter((_, idx) => {
    const own = names[idx];
    const contained = names.filter((n, j) => j !== idx && n.length >= 3 && own.includes(n)).length;
    return contained < 2;
  });
}

export function composeIngredient(
  raw: Ingredient,
  flags: ConditionFlags,
  hasProfile = false,
  resolution: IngredientResolution = LLM_ONLY_RESOLUTION
): AnalyzedIngredient {
  let ing = normalizeIngredient(raw);
  // With a profile available the default is by definition personalised.
  if (hasProfile && ing.portionSource === "standard_serving") {
    ing = { ...ing, portionSource: "personalized_default" };
  }
  const servings = servingsFor(ing);
  return {
    ...ing,
    ...servings,
    warnings: warningsFor(ing, flags),
    nutrientSource: resolution.nutrientSource,
    reference: resolution.reference,
    per100g: resolution.per100g,
    resolution: {
      method: resolution.method,
      reason: resolution.reason,
      matchScore: resolution.matchScore,
      portionNote: resolution.portionNote,
    },
  };
}
