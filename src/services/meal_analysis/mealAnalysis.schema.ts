import { z } from "zod";

/**
 * Structured-output schema for meal analysis (Phase 1).
 *
 * Stage A of the pipeline: the model identifies foods, decides portions in grams
 * (with provenance) and — until the USDA resolver lands in Phase 2 — also
 * reports nutrients for that portion. Everything derived (warnings, servings,
 * glycemic load) is computed in code, see mealAnalysis.rules.ts.
 *
 * Keep this schema strict-mode compatible: no optional fields (use nullable),
 * no min/max constraints, enums as z.enum.
 */

export const UNITS = [
  "g",
  "ml",
  "whole",
  "piece",
  "slice",
  "cup",
  "tbsp",
  "tsp",
  "oz",
  "fl_oz",
  "lb",
  "serving",
] as const;
export type Unit = (typeof UNITS)[number];

export const MEAL_TYPES = ["BREAKFAST", "LUNCH", "DINNER", "SNACK"] as const;
export type MealType = (typeof MEAL_TYPES)[number];

export const PORTION_SOURCES = [
  "user",
  "brand",
  "personalized_default",
  "standard_serving",
] as const;
export type PortionSource = (typeof PORTION_SOURCES)[number];

export const FOOD_GROUPS = [
  "vegetable",
  "fruit",
  "grain",
  "protein",
  "dairy",
  "fat_oil",
  "sweet",
  "beverage",
  "mixed_dish",
  "other",
] as const;
export type FoodGroup = (typeof FOOD_GROUPS)[number];

export const NutrientsSchema = z.object({
  carbohydrates: z.number().describe("grams"),
  proteins: z.number().describe("grams"),
  fats: z.number().describe("grams, total fat"),
  saturatedFats: z.number().describe("grams"),
  fiber: z.number().describe("grams"),
  sodium: z.number().describe("milligrams"),
  naturalSugar: z
    .number()
    .describe("grams of intrinsic sugar (fruit, milk, vegetables)"),
  addedSugar: z
    .number()
    .describe("grams of added sugar (sweeteners, syrups, honey count as added)"),
  calcium: z.number().describe("milligrams"),
  magnesium: z.number().describe("milligrams"),
  iron: z.number().describe("milligrams"),
  potassium: z.number().describe("milligrams"),
  omega_3: z.number().describe("grams (ALA + EPA + DHA)"),
  cholesterol: z.number().describe("milligrams"),
  zinc: z.number().describe("milligrams"),
  vitaminD: z.number().describe("micrograms (µg)"),
  vitaminB12: z.number().describe("micrograms (µg)"),
  vitaminC: z.number().describe("milligrams"),
  vitaminE: z.number().describe("milligrams"),
});
export type Nutrients = z.infer<typeof NutrientsSchema>;

export const IngredientSchema = z.object({
  name: z
    .string()
    .describe("Display name without any quantity, e.g. 'Scrambled eggs'"),
  searchTerm: z
    .string()
    .describe(
      "Canonical food-database style name, e.g. 'egg, whole, cooked, scrambled'"
    ),
  brand: z
    .string()
    .nullable()
    .describe("Brand or restaurant when the user named one, otherwise null"),
  quantity: z.number().describe("Numeric amount expressed in `unit`"),
  unit: z.enum(UNITS),
  grams: z
    .number()
    .describe(
      "Best estimate of the edible weight in grams for this item (treat ml as grams for drinks)"
    ),
  gramsLow: z.number().describe("Plausible lower bound of grams"),
  gramsHigh: z.number().describe("Plausible upper bound of grams"),
  portionSource: z.enum(PORTION_SOURCES),
  portionAssumption: z
    .string()
    .nullable()
    .describe(
      "When the amount was NOT stated by the user: one short sentence explaining the assumed portion (e.g. 'Assumed 1 cup (158 g) cooked rice'). Null when the user stated the amount."
    ),
  confidence: z
    .number()
    .describe("0–1 confidence in the identification and portion"),
  foodGroup: z.enum(FOOD_GROUPS),
  isProcessedFood: z
    .boolean()
    .describe("true for packaged / ultra-processed items and fast food"),
  glycemicIndex: z
    .number()
    .describe("Standard glycemic index 0–100; 0 when carbohydrate is negligible"),
  vegetableServings: z
    .number()
    .describe(
      "Only for mixed dishes: vegetable servings contained (1 serving = 80 g). Put 0 for plain vegetables — it is computed from grams."
    ),
  fruitServings: z
    .number()
    .describe(
      "Only for mixed dishes: fruit servings contained (1 serving = 150 g). Put 0 for plain fruit — it is computed from grams."
    ),
  calories: z.number().describe("kcal for `grams` of this item"),
  nutrients: NutrientsSchema.describe("Nutrients for `grams` of this item"),
});
export type Ingredient = z.infer<typeof IngredientSchema>;

export const MealSchema = z.object({
  mealName: z
    .string()
    .describe(
      "Short, descriptive of the actual foods (e.g. 'Scrambled eggs with toast'), never just the meal type"
    ),
  mealType: z.enum(MEAL_TYPES),
  mealDate: z
    .string()
    .describe(
      "'today' unless the user says otherwise; use their words ('yesterday', 'Monday', '2 days ago') or an ISO date"
    ),
  ingredients: z.array(IngredientSchema),
});
export type Meal = z.infer<typeof MealSchema>;

export const MealAnalysisSchema = z.object({
  meals: z.array(MealSchema),
  dateReference: z
    .string()
    .nullable()
    .describe("The overall date phrase used by the user, or null"),
  dateConfidence: z.number().describe("0–1"),
});
export type MealAnalysisOutput = z.infer<typeof MealAnalysisSchema>;

// ---------------------------------------------------------------------------
// Composed result (after code-side rules)
// ---------------------------------------------------------------------------

export interface Warning {
  warning: string;
  severity: number; // 1 (minor) – 5 (critical)
  condition: string | null; // null = general warning
}

export type NutrientSource = "usda" | "llm";

export interface ResolutionInfo {
  method: "cache" | "heuristic" | "rerank" | "fallback";
  reason: string | null;
  matchScore: number | null;
  portionNote: string | null;
}

export type AnalyzedIngredient = Ingredient & {
  warnings: Warning[];
  /** Where the nutrient numbers came from. */
  nutrientSource: NutrientSource;
  reference: {
    source: string;
    sourceId: string;
    dataType: string | null;
    description: string;
  } | null;
  /** Per-100 g reference vector (lets the client rescale on edit). */
  per100g: (Nutrients & { calories: number }) | null;
  resolution: ResolutionInfo;
};

export type AnalyzedMeal = Omit<Meal, "ingredients"> & {
  ingredients: AnalyzedIngredient[];
  glycemicLoad: number;
};

export interface MealAnalysisUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface MealAnalysisResult {
  meals: AnalyzedMeal[];
  dateReference: string | null;
  dateConfidence: number;
  model: string;
  latencyMs: number;
  usage: MealAnalysisUsage | null;
}
