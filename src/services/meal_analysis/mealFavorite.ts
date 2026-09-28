import { z } from "zod";
import { AnalyzedIngredient, MEAL_TYPES, PORTION_STOPS, PortionStop } from "./mealAnalysis.schema";
import { applyPortionStop, DEFAULT_PORTION_STOP, ensurePortionBase } from "./mealPortion";
import { totalsFromIngredients, normalizeIngredientInputs } from "../calories_tracker/model/mealIngredients";
import type { BatchMeal } from "./mealBatch";

/**
 * Logging a saved meal ("my usual breakfast", "the tuna salad") by reference.
 *
 * The agent picks the favourite from the closed list in its snapshot and passes
 * its id — nothing here matches names fuzzily, because a false match silently
 * logs the wrong meal. The stored FavMealIngredient rows are copied verbatim: no
 * model call, no USDA call, the same numbers every time. Only an `add` ("plus a
 * banana") goes through the analyser, and only for the added words.
 *
 *   ref ─► stored rows ─► remove by name ─► portion stop ─► + analysed additions ─► BatchMeal
 *
 * `favoriteMeal` is pure (tests/mealFavorite.test.ts); the tool does the I/O.
 */

export const FavoriteRefSchema = z.object({
  favoriteId: z.string().min(1).describe("id of a saved meal from the snapshot's 'saved meals' line"),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("Day it was eaten, YYYY-MM-DD; omit for today"),
  mealType: z.enum(MEAL_TYPES).optional().describe("Only when it was eaten as a different meal than it is saved as"),
  portion: z.enum(PORTION_STOPS).optional().describe("'a bigger one' → hearty, 'a lot' → lots, 'a small one' → light"),
  remove: z
    .array(z.string().min(1))
    .max(20)
    .optional()
    .describe("Ingredients they skipped this time — exact names from the saved meal's list"),
  add: z
    .string()
    .min(2)
    .max(500)
    .optional()
    .describe("What they had on top of it this time, in their words with amounts ('a banana and a second coffee')"),
});
export type FavoriteRef = z.infer<typeof FavoriteRefSchema>;

/** A FavMeal row with its ingredients, as read from the DB. */
export type StoredFavorite = {
  id: string;
  userId: string;
  description: string;
  mealType: string;
  slot: string | null;
  ingredients: any[];
};

/** Shown on the card: which saved meal, and what was different this time. */
export type FavoriteTag = { id: string; name: string; changes: string | null };

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Which ingredient index a removal names: an exact (case-insensitive) name
 * first, else the ONE ingredient whose name contains it or is contained by it.
 * Ambiguous or unknown → null, reported back instead of guessed.
 */
export function matchIngredient(names: string[], wanted: string, taken: Set<number>): number | null {
  const w = norm(wanted);
  if (!w) return null;
  const exact = names.findIndex((n, i) => !taken.has(i) && norm(n) === w);
  if (exact >= 0) return exact;
  const loose = names.map((n, i) => ({ n: norm(n), i })).filter(({ n, i }) => !taken.has(i) && (n.includes(w) || w.includes(n)));
  return loose.length === 1 ? loose[0].i : null;
}

/**
 * Stored rows → the analyser's ingredient shape. FavMealIngredient keeps the
 * servings inside `nutrients` (as MealIngredient does); they are lifted back out
 * so the entry's totals count them.
 *
 * An amount the user STATED when the meal was first logged ("60 g oats") is,
 * for the saved meal, their usual amount — not something they said this time.
 * It becomes `personalized_default` so "my usual breakfast, a bigger one" grows
 * the whole meal. Branded sizes (a can, a bar) stay fixed.
 */
export function favoriteIngredients(rows: any[]): AnalyzedIngredient[] {
  const lifted = (rows ?? []).map((r) => ({
    ...r,
    vegetableServings: r.vegetableServings ?? r.nutrients?.vegetableServings ?? 0,
    fruitServings: r.fruitServings ?? r.nutrients?.fruitServings ?? 0,
  }));
  return normalizeIngredientInputs(lifted).map(
    (i) =>
      ({
        ...i,
        portionSource: i.portionSource === "user" ? "personalized_default" : i.portionSource,
        nutrients: { ...i.nutrients },
        warnings: [],
        nutrientSource: i.nutrientSource ?? "llm",
        reference: i.referenceId ? { source: i.referenceSource ?? "", sourceId: i.referenceId, dataType: null, description: i.referenceDescription ?? "" } : null,
        resolution: { method: "cache", reason: "saved meal", matchScore: null, portionNote: null },
      } as unknown as AnalyzedIngredient)
  );
}

/**
 * One favourite, as this time's meal. `added` are the analysed extra items (the
 * caller ran `ref.add` through the analyser). Pure.
 */
export function favoriteMeal(
  fav: StoredFavorite,
  ref: FavoriteRef,
  today: string,
  added: AnalyzedIngredient[] = []
): { meal: BatchMeal; unmatched: string[] } {
  const date = ref.date ?? today;
  const all = favoriteIngredients(fav.ingredients);
  const names = all.map((i) => i.name);
  const drop = new Set<number>();
  const unmatched: string[] = [];
  for (const r of ref.remove ?? []) {
    const i = matchIngredient(names, r, drop);
    if (i === null) unmatched.push(r);
    else drop.add(i);
  }
  let ingredients = all.filter((_, i) => !drop.has(i));

  // The dial works from the amounts as saved: "normal" = the usual amount.
  ensurePortionBase(ingredients);
  const portion: PortionStop = ref.portion ?? DEFAULT_PORTION_STOP;
  if (portion !== DEFAULT_PORTION_STOP) applyPortionStop(ingredients, portion);

  const extras = added.map((i) => ({ ...i, nutrients: { ...(i.nutrients ?? {}) } }));
  ensurePortionBase(extras);
  ingredients = [...ingredients, ...extras];

  const changes = [
    ...[...drop].sort((a, b) => a - b).map((i) => `no ${names[i].toLowerCase()}`),
    ...(extras.length ? [`+ ${extras.map((i) => i.name.toLowerCase()).join(", ")}`] : []),
  ];
  const mealType = (ref.mealType ?? fav.slot ?? fav.mealType) as BatchMeal["mealType"];
  const meal: BatchMeal = {
    mealName: fav.description,
    mealType,
    mealDate: date,
    portion,
    ingredients,
    glycemicLoad: totalsFromIngredients(ingredients as any).glycemicLoad,
    date,
    datePhrase: ref.date ? date : "today",
    included: true,
    duplicateOf: null,
    favorite: { id: fav.id, name: fav.description, changes: changes.length ? changes.join(", ") : null },
  };
  return { meal, unmatched };
}

/** One line per saved meal for the agent snapshot: id, name, slot, kcal, ingredient names. */
export function favoriteLine(f: { id: string; description: string; mealType: string; slot: string | null; calories: number | null; ingredients: { name: string }[] }): string {
  const slot = f.slot ? `usual ${f.slot.toLowerCase()}` : f.mealType.toLowerCase();
  return `"${f.description}" [${f.id}] ${slot} · ${f.calories ?? "?"} kcal — ${f.ingredients.map((i) => i.name).join(", ") || "no breakdown"}`;
}
