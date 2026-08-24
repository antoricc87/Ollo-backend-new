/**
 * Phase 3 — ingredient rows under a FoodEntry.
 * Pure helpers: normalise whatever the clients send (analysis items from the
 * app/agent, or MealIngredient rows being re-logged) and derive entry totals.
 */

export const NUTRIENT_KEYS = [
  "carbohydrates",
  "proteins",
  "fats",
  "saturatedFats",
  "fiber",
  "sodium",
  "naturalSugar",
  "addedSugar",
  "calcium",
  "magnesium",
  "iron",
  "potassium",
  "omega_3",
  "cholesterol",
  "zinc",
  "vitaminD",
  "vitaminB12",
  "vitaminC",
  "vitaminE",
] as const;
export type NutrientKey = (typeof NUTRIENT_KEYS)[number];
export type NutrientMap = Record<NutrientKey, number>;

export interface MealIngredientInput {
  name: string;
  searchTerm: string | null;
  brand: string | null;
  quantity: number;
  unit: string;
  grams: number;
  gramsLow: number | null;
  gramsHigh: number | null;
  portionSource: string | null;
  portionAssumption: string | null;
  confidence: number | null;
  foodGroup: string | null;
  isProcessedFood: boolean;
  glycemicIndex: number;
  vegetableServings: number;
  fruitServings: number;
  calories: number;
  nutrients: NutrientMap;
  per100g: Record<string, number> | null;
  nutrientSource: string | null;
  referenceSource: string | null;
  referenceId: string | null;
  referenceDescription: string | null;
}

const num = (v: any, fallback = 0): number => {
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const UNIT_ALIASES: Record<string, string> = {
  pcs: "piece",
  pc: "piece",
  pieces: "piece",
  slices: "slice",
  cups: "cup",
  servings: "serving",
  "fl oz": "fl_oz",
  floz: "fl_oz",
  tablespoon: "tbsp",
  teaspoon: "tsp",
  grams: "g",
  gram: "g",
  milliliters: "ml",
  millilitres: "ml",
};

/** Parse legacy "2 slices" / "150 g" / "1 whole" quantity strings. */
export function parseQuantityString(q: unknown): { quantity: number; unit: string } | null {
  if (typeof q !== "string") return null;
  const m = q.trim().match(/^([\d.]+)\s*([a-zA-Z_ ]*)$/);
  if (!m) return null;
  const quantity = num(m[1], NaN);
  if (!Number.isFinite(quantity)) return null;
  const raw = m[2].trim().toLowerCase();
  const unit = UNIT_ALIASES[raw] ?? (raw || "serving");
  return { quantity, unit };
}

export function nutrientMap(src: any): NutrientMap {
  const out = {} as NutrientMap;
  for (const k of NUTRIENT_KEYS) out[k] = Math.max(0, num(src?.[k]));
  return out;
}

/**
 * Accepts an analysis ingredient (`description`/`quantity` string/`measurementUnit`…),
 * a MealIngredient row (`name`/`quantity` number/`unit`…), or a mix.
 */
export function normalizeIngredientInput(raw: any, index = 0): MealIngredientInput | null {
  if (!raw || typeof raw !== "object") return null;
  const name = String(raw.name ?? raw.description ?? "").trim();
  if (!name) return null;

  let quantity: number;
  let unit: string;
  if (typeof raw.quantity === "number" && raw.unit) {
    quantity = raw.quantity;
    unit = String(raw.unit);
  } else {
    const parsed = parseQuantityString(raw.quantity);
    quantity = parsed?.quantity ?? num(raw.quantity, 1);
    unit = String(raw.unit ?? raw.measurementUnit ?? parsed?.unit ?? "serving");
  }
  unit = UNIT_ALIASES[unit.toLowerCase()] ?? unit.toLowerCase();

  const grams = Math.max(0, num(raw.grams));
  return {
    name,
    searchTerm: raw.searchTerm ?? null,
    brand: raw.brand ?? null,
    quantity: Math.max(0, quantity),
    unit,
    grams,
    gramsLow: raw.gramsLow != null ? num(raw.gramsLow) : null,
    gramsHigh: raw.gramsHigh != null ? num(raw.gramsHigh) : null,
    portionSource: raw.portionSource ?? null,
    portionAssumption: raw.portionAssumption ?? null,
    confidence: raw.confidence != null ? num(raw.confidence) : null,
    foodGroup: raw.foodGroup ?? null,
    isProcessedFood: !!raw.isProcessedFood,
    glycemicIndex: Math.max(0, num(raw.glycemicIndex)),
    vegetableServings: Math.max(0, num(raw.vegetableServings)),
    fruitServings: Math.max(0, num(raw.fruitServings)),
    calories: Math.max(0, num(raw.calories)),
    nutrients: nutrientMap(raw.nutrients ?? raw),
    per100g: raw.per100g && typeof raw.per100g === "object" ? raw.per100g : null,
    nutrientSource: raw.nutrientSource ?? null,
    referenceSource: raw.referenceSource ?? raw.reference?.source ?? null,
    referenceId: raw.referenceId ?? raw.reference?.sourceId ?? null,
    referenceDescription: raw.referenceDescription ?? raw.reference?.description ?? null,
  };
}

export function normalizeIngredientInputs(list: any): MealIngredientInput[] {
  if (!Array.isArray(list)) return [];
  return list.map((r, i) => normalizeIngredientInput(r, i)).filter((x): x is MealIngredientInput => !!x);
}

export interface EntryTotals {
  calories: number;
  nutrients: NutrientMap;
  glycemicLoad: number;
  vegetableServings: number;
  fruitServings: number;
  isProcessedFood: boolean;
}

/** Entry-level totals derived from ingredients — the single source of truth after edits. */
export function totalsFromIngredients(ings: MealIngredientInput[]): EntryTotals {
  const nutrients = {} as NutrientMap;
  for (const k of NUTRIENT_KEYS) nutrients[k] = 0;
  let calories = 0;
  let glycemicLoad = 0;
  let vegetableServings = 0;
  let fruitServings = 0;
  let processed = false;
  for (const i of ings) {
    calories += i.calories;
    for (const k of NUTRIENT_KEYS) nutrients[k] += i.nutrients[k] || 0;
    glycemicLoad += (i.glycemicIndex * (i.nutrients.carbohydrates || 0)) / 100;
    vegetableServings += i.vegetableServings;
    fruitServings += i.fruitServings;
    processed = processed || i.isProcessedFood;
  }
  const r1 = (n: number) => Math.round(n * 10) / 10;
  for (const k of NUTRIENT_KEYS) nutrients[k] = Math.round(nutrients[k] * 1000) / 1000;
  return {
    calories: Math.round(calories),
    nutrients,
    glycemicLoad: r1(glycemicLoad),
    vegetableServings: r1(vegetableServings),
    fruitServings: r1(fruitServings),
    isProcessedFood: processed,
  };
}

/** Scale one ingredient to a new quantity (nutrients are linear in grams). */
export function rescaleIngredient(ing: MealIngredientInput, newQuantity: number): MealIngredientInput {
  if (!(ing.quantity > 0) || !(newQuantity >= 0)) return ing;
  const k = newQuantity / ing.quantity;
  const nutrients = {} as NutrientMap;
  for (const key of NUTRIENT_KEYS) nutrients[key] = Math.round((ing.nutrients[key] || 0) * k * 1000) / 1000;
  return {
    ...ing,
    quantity: newQuantity,
    grams: Math.round(ing.grams * k),
    gramsLow: ing.gramsLow != null ? Math.round(ing.gramsLow * k) : null,
    gramsHigh: ing.gramsHigh != null ? Math.round(ing.gramsHigh * k) : null,
    calories: Math.round(ing.calories * k),
    vegetableServings: Math.round(ing.vegetableServings * k * 10) / 10,
    fruitServings: Math.round(ing.fruitServings * k * 10) / 10,
    nutrients,
    portionSource: "user",
    portionAssumption: null,
  };
}

/** Prisma `create` payload for a MealIngredient. */
export function toPrismaIngredient(i: MealIngredientInput, sortOrder: number) {
  return {
    sortOrder,
    name: i.name,
    searchTerm: i.searchTerm,
    brand: i.brand,
    quantity: i.quantity,
    unit: i.unit,
    grams: i.grams,
    gramsLow: i.gramsLow,
    gramsHigh: i.gramsHigh,
    portionSource: i.portionSource,
    portionAssumption: i.portionAssumption,
    confidence: i.confidence,
    foodGroup: i.foodGroup,
    isProcessedFood: i.isProcessedFood,
    glycemicIndex: i.glycemicIndex,
    calories: i.calories,
    nutrients: { ...i.nutrients, vegetableServings: i.vegetableServings, fruitServings: i.fruitServings } as any,
    per100g: (i.per100g as any) ?? undefined,
    nutrientSource: i.nutrientSource,
    referenceSource: i.referenceSource,
    referenceId: i.referenceId,
    referenceDescription: i.referenceDescription,
  };
}
