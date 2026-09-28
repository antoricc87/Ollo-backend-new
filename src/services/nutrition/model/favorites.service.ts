import prisma from "../../../utility/prismaClient";
import CaloriesService from "../../calories_tracker/model/calories.model";
import { favoriteIngredients, favoriteMeal, type StoredFavorite } from "../../meal_analysis/mealFavorite";
import { isMealPortionScalable } from "../../meal_analysis/mealPortion";
import { entrySource } from "../../meal_analysis/mealBatch";
import { MEAL_TYPES, PORTION_STOPS, type PortionStop } from "../../meal_analysis/mealAnalysis.schema";
import { mealTime } from "../../agent/tools/write.tools";
import { dayKey, safeTz } from "../../agent/memory/dates";
import NutritionService from "./nutrition.model";
import { FAV_MEAL_INCLUDE, favMealTotals, ingredientsFromFoodEntries, loadEntriesForFavourite, toPrismaFavIngredient } from "./favMealIngredients";

/**
 * The saved-meals screen (Sep 18 2026): list, rename, make one the usual
 * <meal>, forget, and log one in a tap. Sep 28: save a logged meal from the
 * food log's swipe action. Every call is scoped to the caller —
 * a favourite id from someone else reads as "not found".
 *
 * Logging goes through the same `favoriteMeal` expansion Ollie's log_meal uses
 * (stored rows copied verbatim, no model call), so a tap here and "log my
 * usual breakfast" in the chat produce the same entry.
 */

type MealType = (typeof MEAL_TYPES)[number];
export class FavoriteError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const isMealType = (v: unknown): v is MealType => typeof v === "string" && (MEAL_TYPES as readonly string[]).includes(v);
const isStop = (v: unknown): v is PortionStop => typeof v === "string" && (PORTION_STOPS as readonly string[]).includes(v);

const owned = async (userId: string, id: string) => {
  const fav = await prisma.favMeal.findFirst({ where: { id, userId }, include: FAV_MEAL_INCLUDE });
  if (!fav) throw new FavoriteError(404, "Saved meal not found");
  return fav;
};

const FavoritesService = {
  /** `portionScalable` false = nothing in it has a weight to scale (a favourite saved from a legacy entry) — hide the size choice. */
  async list(userId: string) {
    const favs = await prisma.favMeal.findMany({
      where: { userId },
      orderBy: [{ useCount: "desc" }, { createdAt: "desc" }],
      include: FAV_MEAL_INCLUDE,
    });
    return favs.map((f) => ({ ...f, portionScalable: isMealPortionScalable(favoriteIngredients(f.ingredients) as any) }));
  },

  /**
   * Save a logged entry as a saved meal, named after it. Its stored rows are
   * copied as they are (no model call), like save_favorite from a logged meal.
   * A name another saved meal already has is a 409 — rename that one first.
   */
  async saveEntry(userId: string, entryId: unknown) {
    if (typeof entryId !== "string" || !entryId) throw new FavoriteError(400, "entryId is required");
    const own = await prisma.foodEntry.findFirst({ where: { id: entryId, dailyFood: { userId } }, select: { id: true } });
    if (!own) throw new FavoriteError(404, "Logged meal not found");
    const [entry] = await loadEntriesForFavourite([entryId]);
    const ingredients = ingredientsFromFoodEntries([entry]);
    if (!ingredients.length) throw new FavoriteError(422, "This meal has no ingredients to save");
    const name = (entry.description ?? "").trim().slice(0, 60) || "Saved meal";
    const clash = await prisma.favMeal.findFirst({ where: { userId, description: { equals: name, mode: "insensitive" } }, select: { id: true } });
    if (clash) throw new FavoriteError(409, `"${name}" is already saved`);
    return prisma.favMeal.create({
      include: FAV_MEAL_INCLUDE,
      data: {
        userId,
        description: name,
        mealType: isMealType(entry.mealType) ? entry.mealType : "SNACK",
        quantity: "1",
        ingredients: { create: ingredients.map(toPrismaFavIngredient) },
        ...favMealTotals(ingredients),
      },
    });
  },

  /** Rename, and/or make it the usual <meal> (null clears). A slot moves off whichever meal held it. */
  async update(userId: string, id: string, patch: { name?: unknown; slot?: unknown }) {
    const fav = await owned(userId, id);
    const data: { description?: string; slot?: MealType | null; mealType?: MealType } = {};
    if (patch.name !== undefined) {
      const name = String(patch.name ?? "").trim();
      if (name.length < 2 || name.length > 60) throw new FavoriteError(400, "A name needs 2–60 characters");
      const clash = await prisma.favMeal.findFirst({ where: { userId, id: { not: id }, description: { equals: name, mode: "insensitive" } }, select: { id: true } });
      if (clash) throw new FavoriteError(409, `You already have a saved meal called "${name}"`);
      data.description = name;
    }
    if (patch.slot !== undefined) {
      if (patch.slot !== null && !isMealType(patch.slot)) throw new FavoriteError(400, "slot must be BREAKFAST, LUNCH, DINNER, SNACK or null");
      const slot = patch.slot as MealType | null;
      data.slot = slot;
      if (slot) data.mealType = slot;
    }
    if (!Object.keys(data).length) return fav;
    return prisma.$transaction(async (tx) => {
      if (data.slot) await tx.favMeal.updateMany({ where: { userId, slot: data.slot, id: { not: id } }, data: { slot: null } });
      return tx.favMeal.update({ where: { id }, data, include: FAV_MEAL_INCLUDE });
    });
  },

  async remove(userId: string, id: string) {
    await owned(userId, id);
    return NutritionService.deleteFavMeal(id);
  },

  /** Log it as one entry: today unless `date`, its own slot unless `mealType`, the saved amounts unless `portion`. */
  async log(userId: string, id: string, opts: { date?: unknown; mealType?: unknown; portion?: unknown; timeZone?: unknown }) {
    const fav = await owned(userId, id);
    if (!fav.ingredients.length) throw new FavoriteError(422, "This saved meal has no ingredients to log");
    const patient = await prisma.patient.findUnique({ where: { id: userId }, select: { timeZone: true } });
    const tz = safeTz(typeof opts.timeZone === "string" && opts.timeZone ? opts.timeZone : patient?.timeZone);
    const today = dayKey(tz);
    const date = typeof opts.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(opts.date) ? opts.date : today;
    if (date > today) throw new FavoriteError(400, "A meal can't be logged on a future day");
    const { meal } = favoriteMeal(fav as unknown as StoredFavorite, { favoriteId: id, date, mealType: isMealType(opts.mealType) ? opts.mealType : undefined, portion: isStop(opts.portion) ? opts.portion : undefined }, today);
    const saved = await CaloriesService.createFoodEntry(
      userId,
      [
        {
          description: meal.mealName,
          quantity: "1",
          calories: Math.round(meal.ingredients.reduce((a, i) => a + (i.calories ?? 0), 0)),
          mealType: meal.mealType,
          ingredients: meal.ingredients,
          nutrients: {},
          glycemicLoad: meal.glycemicLoad ?? 0,
          portionStop: meal.portion ?? null,
          source: entrySource({ date, source: null }, today), // "recall" when logged 2+ days late, like log_meal
        },
      ],
      mealTime(date, meal.mealType, tz),
      tz
    );
    await prisma.favMeal.update({ where: { id }, data: { useCount: { increment: 1 }, lastUsedAt: new Date() } });
    const entries = Array.isArray(saved) ? saved : [];
    return { date, mealType: meal.mealType, entries: entries.map((e: any) => ({ id: e.id, description: e.description, calories: e.calories, mealType: e.mealType })) };
  },
};

export default FavoritesService;
