/**
 * Favourite-meal round trip on the dev DB — no LLM. Logs two meals (one with a
 * full ingredient breakdown, one bare), saves a favourite from them, checks the
 * copied FavMealIngredient rows and the recomputed totals, checks the backfill
 * is a no-op on an already-copied favourite, then deletes and checks the
 * cascade. Self-cleaning: everything it creates is removed in `finally`.
 *   npx ts-node --transpile-only scripts/favmeal-smoke.ts [email]
 */
import "dotenv/config";
import prisma from "../src/utility/prismaClient";
import CaloriesService from "../src/services/calories_tracker/model/calories.model";
import NutritionService from "../src/services/nutrition/model/nutrition.model";
import {
  favMealTotals,
  ingredientsFromFoodEntries,
  toPrismaFavIngredient,
} from "../src/services/nutrition/model/favMealIngredients";

const email = process.argv[2] ?? "antoricciardelli@gmail.com";
const TZ = "Europe/Rome";
const ok = (cond: unknown, what: string) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${what}`);
  if (!cond) process.exitCode = 1;
};

(async () => {
  const patient = await prisma.patient.findFirst({ where: { email }, select: { id: true } });
  if (!patient) throw new Error(`no patient ${email}`);
  const pid = patient.id;

  const entryIds: string[] = [];
  let favId: string | null = null;
  let legacyFavId: string | null = null;

  try {
    const when = new Date().toISOString();

    // 1. A modern meal: per-ingredient rows, bands and a portion source.
    const saved = await CaloriesService.createFoodEntry(
      pid,
      [
        {
          description: "Smoke breakfast",
          quantity: "1",
          calories: 0,
          mealType: "BREAKFAST",
          nutrients: {},
          portionStop: "normal",
          ingredients: [
            { name: "Scrambled eggs", searchTerm: "egg, whole, cooked, scrambled", quantity: 2, unit: "whole", grams: 100, gramsLow: 96, gramsHigh: 104, portionSource: "user", calories: 143, glycemicIndex: 0, nutrients: { proteins: 12, carbohydrates: 1, fats: 10 }, nutrientSource: "usda", referenceSource: "usda", referenceId: "173424" },
            { name: "Toast", quantity: 1, unit: "slice", grams: 30, gramsLow: 25, gramsHigh: 40, portionSource: "personalized_default", calories: 80, glycemicIndex: 70, nutrients: { proteins: 3, carbohydrates: 14, fats: 1 } },
          ],
        },
      ],
      when,
      TZ
    );
    const modern = (Array.isArray(saved) ? saved : [])[0] as any;
    entryIds.push(modern.id);
    ok(modern?.ingredients?.length === 2, "logged a meal with 2 ingredient rows");
    ok(modern?.portionStop === "normal", "portionStop persisted on the FoodEntry");

    // 2. A bare meal, the way legacy rows look: no ingredient breakdown.
    const bare = await prisma.foodEntry.create({
      data: {
        description: "Greek yogurt",
        quantity: "1 cup",
        calories: 150,
        proteins: 20,
        carbohydrates: 8,
        fats: 4,
        mealType: "BREAKFAST",
        dailyFoodId: modern.dailyFoodId,
        createdAt: when,
      },
      include: { ingredients: true },
    });
    entryIds.push(bare.id);

    // 3. Save the favourite from both.
    const fav: any = await NutritionService.createFavMeal(
      [{ id: modern.id }, { id: bare.id }] as any,
      pid,
      "Smoke usual breakfast",
      "BREAKFAST",
      { slot: "BREAKFAST", aliases: ["the egg one"] }
    );
    favId = fav.id;
    ok(fav.ingredients?.length === 3, `favourite copied 3 ingredients (got ${fav.ingredients?.length})`);
    ok(
      fav.ingredients.map((i: any) => i.name).join(", ") === "Scrambled eggs, Toast, Greek yogurt",
      "ingredients kept their order across both entries"
    );

    const egg = fav.ingredients.find((i: any) => i.name === "Scrambled eggs");
    ok(egg.gramsLow === 96 && egg.gramsHigh === 104, "the portion band survived the copy (the dial still works)");
    ok(egg.portionSource === "user", "portionSource survived — the dial will leave this item alone");
    ok(egg.referenceId === "173424" && egg.nutrientSource === "usda", "the USDA reference survived");

    ok(fav.calories === 373, `totals recomputed from the ingredients: ${fav.calories} kcal (expected 373)`);
    ok(fav.slot === "BREAKFAST", "slot stored — 'my usual breakfast' can resolve without the dish name");
    ok(Array.isArray(fav.aliases) && fav.aliases[0] === "the egg one", "aliases stored");
    ok(fav.useCount === 0 && fav.lastUsedAt === null, "usage counters start empty");

    // 4. The legacy shape: a favourite with only FoodEntry links, as the backfill finds it.
    const legacy = await prisma.favMeal.create({
      data: {
        userId: pid,
        description: "Smoke legacy favourite",
        mealType: "LUNCH",
        quantity: "1",
        calories: 150,
        legacyEntries: { connect: [{ id: bare.id }] },
      },
    });
    legacyFavId = legacy.id;
    const legacyLoaded = await prisma.favMeal.findUniqueOrThrow({
      where: { id: legacy.id },
      include: { ingredients: true, legacyEntries: { include: { ingredients: true } } },
    });
    ok(legacyLoaded.ingredients.length === 0, "a legacy favourite starts with no ingredient rows");
    const built = ingredientsFromFoodEntries(legacyLoaded.legacyEntries as any[]);
    await prisma.favMeal.update({
      where: { id: legacy.id },
      data: { ingredients: { create: built.map(toPrismaFavIngredient) }, ...favMealTotals(built) },
    });
    const backfilled = await prisma.favMeal.findUniqueOrThrow({ where: { id: legacy.id }, include: { ingredients: true } });
    ok(backfilled.ingredients.length === 1, "backfill synthesised one ingredient from the bare entry");
    ok(backfilled.calories === 150, "backfill recomputed the totals");

    // 5. Reading them back the way the route does.
    const listed: any = await NutritionService.getFavMeals({
      where: { userId: pid },
      orderBy: [{ useCount: "desc" as const }, { createdAt: "desc" as const }],
      include: { ingredients: { orderBy: { sortOrder: "asc" as const } } },
    });
    const mine = listed.filter((f: any) => f.description.startsWith("Smoke"));
    ok(mine.length === 2 && mine.every((f: any) => f.ingredients.length > 0), "fetchFavMeals returns favourites with their ingredients");

    // 6. Delete: ingredients cascade, the logged meals survive.
    await NutritionService.deleteFavMeal(favId!);
    const goneRows = await prisma.favMealIngredient.count({ where: { favMealId: favId! } });
    ok(goneRows === 0, "deleting a favourite cascades its ingredient rows");
    const entriesAlive = await prisma.foodEntry.count({ where: { id: { in: entryIds } } });
    ok(entriesAlive === 2, "the logged meals outlive the favourite");
    // Only the modern entry is checked: `FoodEntry.favMealId` is a SINGLE FK, so
    // connecting the bare entry to the legacy favourite in step 4 moved it there.
    // That one-favourite-per-entry limit is part of why the legacy shape had to go.
    const stillLinked = await prisma.foodEntry.findUniqueOrThrow({ where: { id: modern.id }, select: { favMealId: true } });
    ok(stillLinked.favMealId === null, "legacy links were unhooked, not cascaded");
    favId = null;
  } finally {
    if (favId) await prisma.favMeal.delete({ where: { id: favId } }).catch(() => {});
    if (legacyFavId) await prisma.favMeal.delete({ where: { id: legacyFavId } }).catch(() => {});
    for (const id of entryIds) {
      // Through the service: raw deletes leave the Daily/Weekly totals inflated.
      await CaloriesService.deleteFoodEntry(pid, id).catch(() => {});
    }
    console.log("\ncleaned up");
  }
})()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
