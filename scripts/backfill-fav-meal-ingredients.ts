/**
 * One-off, idempotent: favourites saved before 2026-08-31 are a bag of
 * `FoodEntry` rows (`FavMeal.legacyEntries`) with no per-ingredient detail.
 * Copy them into `FavMealIngredient` so logging a favourite is a verbatim
 * copy of stored rows instead of a re-analysis.
 *
 *   npx ts-node --transpile-only scripts/backfill-fav-meal-ingredients.ts [--dry]
 *
 * A modern entry contributes its own MealIngredient rows; a legacy one with no
 * breakdown contributes a single ingredient synthesised from the entry itself.
 * Favourites that already have ingredient rows are skipped, so it is safe to
 * re-run. Run this in every environment BEFORE dropping FoodEntry.favMealId.
 */
import prisma from "../src/utility/prismaClient";
import {
  favMealTotals,
  ingredientsFromFoodEntries,
  toPrismaFavIngredient,
} from "../src/services/nutrition/model/favMealIngredients";

async function main() {
  const dry = process.argv.includes("--dry");
  const favourites = await prisma.favMeal.findMany({
    include: {
      ingredients: { select: { id: true } },
      legacyEntries: { include: { ingredients: { orderBy: { sortOrder: "asc" } } } },
    },
    orderBy: { createdAt: "asc" },
  });

  let done = 0;
  let skipped = 0;
  let empty = 0;
  let synthesised = 0;

  for (const fav of favourites) {
    if (fav.ingredients.length) {
      skipped++;
      continue;
    }
    const entries = fav.legacyEntries ?? [];
    const built = ingredientsFromFoodEntries(entries as any[]);
    if (!built.length) {
      // Nothing recoverable — a favourite whose entries were deleted. Left alone
      // rather than removed; deleting the user's data is their call, not ours.
      empty++;
      console.warn(`  ! "${fav.description}" (${fav.id}) has no recoverable ingredients — left as is`);
      continue;
    }
    synthesised += entries.filter((e: any) => !e.ingredients?.length).length;

    if (!dry) {
      await prisma.favMeal.update({
        where: { id: fav.id },
        data: {
          ingredients: { create: built.map(toPrismaFavIngredient) },
          ...favMealTotals(built),
        },
      });
    }
    done++;
    console.log(`  ${dry ? "would copy" : "copied"} ${built.length} ingredient(s) into "${fav.description}"`);
  }

  console.log(
    `\n${dry ? "[dry run] " : ""}${favourites.length} favourite(s): ${done} backfilled, ${skipped} already had rows, ${empty} unrecoverable.` +
      (synthesised ? ` ${synthesised} legacy entr(ies) had no ingredient breakdown and became one ingredient each.` : "")
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
