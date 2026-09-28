import { z } from "zod";
import prisma from "../../../utility/prismaClient";
import { analyzeMeal } from "../../meal_analysis/mealAnalysis.service";
import { MEAL_TYPES } from "../../meal_analysis/mealAnalysis.schema";
import { normalizeIngredientInputs, type MealIngredientInput } from "../../calories_tracker/model/mealIngredients";
import {
  FAV_MEAL_INCLUDE,
  favMealTotals,
  ingredientsFromFoodEntries,
  loadEntriesForFavourite,
  toPrismaFavIngredient,
} from "../../nutrition/model/favMealIngredients";
import NutritionService from "../../nutrition/model/nutrition.model";
import { dayString, defineTool, subjectField } from "./registry";

/**
 * Saved meals from the chat: "save that as my usual breakfast", "forget the
 * tuna salad". Logging one is log_meal's `favorites` (see mealFavorite.ts).
 *
 * A favourite is saved from what the user actually LOGGED whenever possible —
 * those rows already carry the portions they confirmed — and only analysed
 * from a description when there is nothing logged to copy. The ingredients the
 * user saw on the card are the ones saved: commit reads them from the stored
 * preview and never re-runs the model.
 */

const r1 = (n: number | null | undefined) => Math.round((n ?? 0) * 10) / 10;
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

const SaveFavoriteSchema = z.object({
  name: z.string().min(2).max(60).describe("What the user calls it: 'Usual breakfast', 'Tuna salad', 'Post-gym shake'"),
  slot: z
    .enum(MEAL_TYPES)
    .optional()
    .describe("Set when they call it their usual <meal> ('my usual breakfast') so 'my usual breakfast' finds it; one usual per meal"),
  aliases: z.array(z.string().min(2).max(40)).max(5).optional().describe("Other names they use for it"),
  entryIds: z.array(z.string()).max(10).optional().describe("Logged food entry ids to save (from log_meal's result or get_meals)"),
  date: dayString.optional().describe("With mealType: save what they logged for that meal on that day (default today)"),
  mealType: z.enum(MEAL_TYPES).optional().describe("The logged meal to save, or what a described meal is"),
  description: z
    .string()
    .min(3)
    .max(1000)
    .optional()
    .describe("Only when it isn't logged anywhere: the meal in their words, with amounts"),
  subjectId: subjectField,
});
type SaveFavoriteInput = z.infer<typeof SaveFavoriteSchema>;

/** Where the ingredients come from, in order: entry ids → the day's logged meal → a description. */
async function favoriteSource(input: SaveFavoriteInput, subjectId: string, today: string) {
  if (input.entryIds?.length) {
    const entries = (await loadEntriesForFavourite(input.entryIds)).filter((e: any) => e);
    const owned = await prisma.foodEntry.findMany({ where: { id: { in: entries.map((e) => e.id) }, dailyFood: { userId: subjectId } }, select: { id: true } });
    const ok = new Set(owned.map((o) => o.id));
    const mine = entries.filter((e) => ok.has(e.id));
    if (!mine.length) return { error: "Those entries aren't in this person's log." };
    return { from: "logged" as const, ingredients: ingredientsFromFoodEntries(mine), mealType: input.mealType ?? mine[0].mealType ?? null, label: mine.map((e) => e.description).join(" + ") };
  }
  if (input.mealType && !input.description) {
    const date = input.date ?? today;
    const days = await prisma.dailyFood.findMany({
      where: { userId: subjectId, date: { startsWith: date } },
      select: { foodEntries: { where: { mealType: input.mealType }, select: { id: true } } },
    });
    const ids = days.flatMap((d) => d.foodEntries.map((e) => e.id));
    if (!ids.length) return { error: `Nothing logged for ${input.mealType.toLowerCase()} on ${date} — log it first, or pass description.` };
    const entries = await loadEntriesForFavourite(ids);
    return { from: "logged" as const, ingredients: ingredientsFromFoodEntries(entries), mealType: input.mealType, label: entries.map((e) => e.description).join(" + ") };
  }
  if (input.description) {
    const res = await analyzeMeal({ text: input.description, mealTypeHint: input.slot ?? input.mealType, todayLocal: today }, { patientId: subjectId });
    const meals = res.meals.filter((m) => m.ingredients?.length);
    if (!meals.length) return { error: "I couldn't identify any food in that description." };
    const ingredients = normalizeIngredientInputs(meals.flatMap((m) => m.ingredients));
    return { from: "described" as const, ingredients, mealType: input.mealType ?? meals[0].mealType, label: input.description };
  }
  return { error: "Say which meal: entryIds, mealType (+ date) of something logged, or a description." };
}

export const saveFavorite = defineTool({
  name: "save_favorite",
  description:
    "Save a meal as a favourite so it can be logged later by name ('my usual breakfast', 'the tuna salad') with its exact numbers. Prefer something already logged (entryIds, or mealType + date); use description only when it isn't logged. Set slot when they call it their usual breakfast/lunch/dinner/snack. Saving under an existing name, or a slot another saved meal holds, replaces it (the preview says so). Returns a preview the user confirms. Offer it when someone logs the same meal again and again.",
  schema: SaveFavoriteSchema,
  risk: "write",
  async run(ctx, input) {
    const subject = await ctx.resolveSubject(input.subjectId);
    if (input.date && input.date > ctx.today) return { result: { error: "That day is in the future." } };
    const src = await favoriteSource(input, subject.id, ctx.today);
    if ("error" in src) return { result: { error: src.error } };
    if (!src.ingredients.length) return { result: { error: "That meal has no ingredients to save." } };
    const mealType = (input.slot ?? src.mealType ?? "SNACK") as (typeof MEAL_TYPES)[number];
    const existing = await prisma.favMeal.findMany({ where: { userId: subject.id }, select: { id: true, description: true, slot: true } });
    const replaces = existing.find((f) => same(f.description, input.name)) ?? null;
    const slotFrom = input.slot ? existing.find((f) => f.slot === input.slot && f.id !== replaces?.id) ?? null : null;
    const t = favMealTotals(src.ingredients);
    const preview = {
      subjectId: subject.id,
      name: input.name.trim(),
      slot: input.slot ?? null,
      mealType,
      aliases: input.aliases ?? [],
      from: src.from,
      calories: Math.round(t.calories),
      protein_g: r1(t.proteins),
      carbs_g: r1(t.carbohydrates),
      fat_g: r1(t.fats),
      items: src.ingredients.map((i) => ({ name: i.name, quantity: i.quantity, unit: i.unit, grams: Math.round(i.grams), calories: Math.round(i.calories) })),
      replaces: replaces ? { id: replaces.id, name: replaces.description } : null,
      takesSlotFrom: slotFrom ? { id: slotFrom.id, name: slotFrom.description } : null,
      ingredients: src.ingredients,
    };
    const as = input.slot ? ` as your usual ${input.slot.toLowerCase()}` : "";
    return {
      result: {
        previewOf: { name: preview.name, slot: preview.slot, calories: preview.calories, items: preview.items.map((i) => i.name), from: src.from },
        ...(replaces ? { note: `Replaces the saved meal "${replaces.description}".` } : {}),
        ...(slotFrom ? { slotNote: `"${slotFrom.description}" stops being the usual ${input.slot!.toLowerCase()} (it stays saved by name).` } : {}),
      },
      proposal: { title: `Save ${preview.name}`, summary: `Save "${preview.name}"${as} — ${preview.calories} kcal, ${preview.items.length} item(s)`, preview },
    };
  },
  async commit(ctx, input, rawPreview: any) {
    const p = rawPreview;
    if (!p?.ingredients?.length) throw new Error("This preview has nothing to save — ask Ollie again");
    const ingredients: MealIngredientInput[] = normalizeIngredientInputs(p.ingredients);
    const userId: string = p.subjectId ?? (await ctx.resolveSubject(input.subjectId)).id;
    const saved = await prisma.$transaction(async (tx) => {
      if (p.replaces?.id) await tx.favMeal.deleteMany({ where: { id: p.replaces.id, userId } });
      if (p.slot) await tx.favMeal.updateMany({ where: { userId, slot: p.slot }, data: { slot: null } });
      return tx.favMeal.create({
        include: FAV_MEAL_INCLUDE,
        data: {
          userId,
          description: p.name,
          mealType: p.mealType,
          slot: p.slot ?? null,
          aliases: p.aliases ?? [],
          quantity: "1",
          ingredients: { create: ingredients.map(toPrismaFavIngredient) },
          ...favMealTotals(ingredients),
        },
      });
    });
    const result = { saved: true, id: saved.id, name: saved.description, slot: saved.slot, calories: saved.calories };
    return { result, cards: [{ type: "favorite_saved", title: "Saved", data: result }] };
  },
});

export const deleteFavorite = defineTool({
  name: "delete_favorite",
  description: "Remove a saved meal the user no longer wants ('forget my usual breakfast'). Logged meals stay in the log. Returns a preview the user confirms.",
  schema: z.object({ favoriteId: z.string().min(1).describe("id from the snapshot's saved meals"), subjectId: subjectField }),
  risk: "write",
  async run(ctx, input) {
    const subject = await ctx.resolveSubject(input.subjectId);
    const fav = await prisma.favMeal.findFirst({ where: { id: input.favoriteId, userId: subject.id }, select: { id: true, description: true, slot: true, calories: true } });
    if (!fav) return { result: { error: "No saved meal with that id." } };
    const preview = { subjectId: subject.id, id: fav.id, name: fav.description, slot: fav.slot, calories: fav.calories };
    return { result: { previewOf: preview }, proposal: { title: `Forget ${fav.description}`, summary: `Remove the saved meal "${fav.description}" (the log keeps every meal)`, preview } };
  },
  async commit(ctx, input, rawPreview: any) {
    const userId: string = rawPreview?.subjectId ?? (await ctx.resolveSubject(input.subjectId)).id;
    const fav = await prisma.favMeal.findFirst({ where: { id: input.favoriteId, userId }, select: { id: true, description: true } });
    if (!fav) throw new Error("That saved meal is already gone");
    await NutritionService.deleteFavMeal(fav.id);
    const result = { deleted: true, name: fav.description };
    return { result, cards: [{ type: "favorite_deleted", title: "Removed", data: result }] };
  },
});
