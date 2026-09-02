import prisma from "../../../utility/prismaClient";
import {
  MealIngredientInput,
  normalizeIngredientInput,
  normalizeIngredientInputs,
  totalsFromIngredients,
} from "../../calories_tracker/model/mealIngredients";

/**
 * Favourite meals, per ingredient.
 *
 * A favourite used to be a bag of `FoodEntry` rows (`FavMeal.legacyEntries`)
 * with no per-ingredient detail — no grams, no portion source, no USDA
 * reference. `FavMealIngredient` mirrors `MealIngredient` column for column, so
 * logging a favourite is a straight copy of stored rows: no model call, no
 * resolver call, and the same numbers every time. That determinism is the point
 * — a re-estimated breakfast makes the weekly trend jitter.
 *
 * Shared by `createFavMeal` and scripts/backfill-fav-meal-ingredients.ts so both
 * build the rows the same way.
 */

/** A FoodEntry with its ingredient rows, as this module needs it. */
type EntryWithIngredients = { id: string; ingredients?: any[] } & Record<string, any>;

/**
 * Ingredient rows for a favourite built from the food entries it was saved
 * from. A modern entry contributes its own `MealIngredient` rows; a legacy one
 * with no breakdown contributes a single ingredient synthesised from the entry
 * itself (name, quantity string and the macro columns) — the best that row can
 * give, and better than losing it.
 */
export function ingredientsFromFoodEntries(entries: EntryWithIngredients[]): MealIngredientInput[] {
  const out: MealIngredientInput[] = [];
  for (const entry of entries || []) {
    if (!entry) continue;
    const rows = Array.isArray(entry.ingredients) ? entry.ingredients : [];
    if (rows.length) {
      // MealIngredient stores the servings inside `nutrients`; unwrap them so a
      // round trip through normalizeIngredientInput keeps them.
      out.push(
        ...normalizeIngredientInputs(
          rows.map((r: any) => ({
            ...r,
            vegetableServings: r.vegetableServings ?? r.nutrients?.vegetableServings ?? 0,
            fruitServings: r.fruitServings ?? r.nutrients?.fruitServings ?? 0,
          }))
        )
      );
      continue;
    }
    const one = normalizeIngredientInput(entry);
    // A synthesised row is whatever the user logged, with no grams and no
    // assumption behind it. Marking it "user" keeps the portion dial off it —
    // there is nothing here we could honestly revise.
    if (one) out.push({ ...one, portionSource: one.portionSource ?? "user" });
  }
  return out;
}

/** Load the caller's food entries by id, newest field values, with ingredient rows. */
export async function loadEntriesForFavourite(entryIds: string[]): Promise<EntryWithIngredients[]> {
  const ids = [...new Set(entryIds.filter((id) => typeof id === "string" && id))];
  if (!ids.length) return [];
  const rows = await prisma.foodEntry.findMany({
    where: { id: { in: ids } },
    include: { ingredients: { orderBy: { sortOrder: "asc" } } },
  });
  // Preserve the order the caller sent.
  const byId = new Map(rows.map((r) => [r.id, r as EntryWithIngredients]));
  return ids.map((id) => byId.get(id)).filter((r): r is EntryWithIngredients => !!r);
}

/** Prisma `create` payload for one FavMealIngredient — same columns as MealIngredient. */
export function toPrismaFavIngredient(i: MealIngredientInput, sortOrder: number) {
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

/** The FavMeal scalar columns, recomputed from its ingredients (they are a cache). */
export function favMealTotals(ings: MealIngredientInput[]) {
  const t = totalsFromIngredients(ings);
  return {
    calories: t.calories,
    carbohydrates: t.nutrients.carbohydrates,
    proteins: t.nutrients.proteins,
    fats: t.nutrients.fats,
    fiber: t.nutrients.fiber,
    sodium: t.nutrients.sodium,
    naturalSugar: t.nutrients.naturalSugar,
    addedSugar: t.nutrients.addedSugar,
    calcium: t.nutrients.calcium,
    magnesium: t.nutrients.magnesium,
    iron: t.nutrients.iron,
    potassium: t.nutrients.potassium,
    omega_3: t.nutrients.omega_3,
    cholesterol: t.nutrients.cholesterol,
    zinc: t.nutrients.zinc,
    vitaminD: t.nutrients.vitaminD,
    vitaminC: t.nutrients.vitaminC,
    vitaminB12: t.nutrients.vitaminB12,
    vitaminE: t.nutrients.vitaminE,
    glycemicLoad: t.glycemicLoad,
    vegetableServings: t.vegetableServings,
    fruitServings: t.fruitServings,
    isProcessedFood: t.isProcessedFood,
  };
}

/** Everything a favourite needs to be read back and logged. */
export const FAV_MEAL_INCLUDE = {
  ingredients: { orderBy: { sortOrder: "asc" as const } },
};
