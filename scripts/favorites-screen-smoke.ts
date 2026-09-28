/**
 * Saved-meals screen service, no LLM: list → rename (clash refused) → usual
 * slot moves → log today / yesterday / hearty → someone else's id is 404 →
 * remove keeps the log → save a logged entry (swipe action). Eval fixture (eval-ollie@ollo.test), destroyed after.
 *   npx ts-node --transpile-only scripts/favorites-screen-smoke.ts
 */
import "dotenv/config";
import assert from "assert";
import prisma from "../src/utility/prismaClient";
import FavoritesService from "../src/services/nutrition/model/favorites.service";
import NutritionService from "../src/services/nutrition/model/nutrition.model";
import CaloriesService from "../src/services/calories_tracker/model/calories.model";
import moment from "moment-timezone";
import { createFixture, destroyFixture, EVAL_TZ } from "../tests/agent/fixture";

const ok = (s: string) => console.log(`  ✓ ${s}`);
const rejects = async (p: Promise<unknown>, status: number) => {
  try {
    await p;
  } catch (e: any) {
    assert.equal(e.status, status, `expected ${status}, got ${e.status} ${e.message}`);
    return e.message as string;
  }
  assert.fail(`expected a ${status}`);
};

async function main() {
  await destroyFixture();
  const { patientId: pid } = await createFixture();
  try {
    // A breakfast with per-ingredient rows (what Ollie logs today) and the fixture's legacy lunch (no breakdown).
    const ing = (name: string, grams: number, calories: number, portionSource = "standard_serving") => ({
      name, quantity: 1, unit: "serving", grams, gramsLow: grams * 0.8, gramsHigh: grams * 1.3, portionSource, foodGroup: "grain",
      calories, nutrients: { proteins: 8, carbohydrates: 30, fats: 5 },
    });
    const made: any = await CaloriesService.createFoodEntry(
      pid,
      [{ description: "Oats bowl", quantity: "1", calories: 0, mealType: "BREAKFAST", ingredients: [ing("Oats", 60, 230, "user"), ing("Milk", 200, 100), ing("Banana", 120, 105)], nutrients: {}, glycemicLoad: 0 }],
      moment().tz(EVAL_TZ).hour(8),
      EVAL_TZ
    );
    const a: any = await NutritionService.createFavMeal(made, pid, "Chicken salad", "LUNCH", { slot: "LUNCH" });
    const lunch = await prisma.foodEntry.findFirst({ where: { dailyFood: { userId: pid }, mealType: "LUNCH" } });
    const b: any = await NutritionService.createFavMeal([lunch as any], pid, "Big salad", "LUNCH");

    const list = await FavoritesService.list(pid);
    assert.equal(list.length, 2);
    assert(list.every((f) => f.ingredients.length >= 1));
    assert.deepEqual(Object.fromEntries(list.map((f) => [f.description, f.portionScalable])), { "Chicken salad": true, "Big salad": false });
    ok("legacy favourite reports portionScalable false, the per-ingredient one true");
    ok(`list: ${list.map((f) => `${f.description}${f.slot ? ` (usual ${f.slot.toLowerCase()})` : ""}`).join(", ")}`);

    const renamed = await FavoritesService.update(pid, b.id, { name: "  Weekend salad " });
    assert.equal(renamed.description, "Weekend salad");
    ok(`renamed → "${renamed.description}"`);
    ok(`clash refused: ${await rejects(FavoritesService.update(pid, b.id, { name: "chicken SALAD" }), 409)}`);
    await rejects(FavoritesService.update(pid, b.id, { slot: "BRUNCH" }), 400);

    await FavoritesService.update(pid, b.id, { slot: "LUNCH" });
    const [na, nb] = await Promise.all([prisma.favMeal.findUnique({ where: { id: a.id } }), prisma.favMeal.findUnique({ where: { id: b.id } })]);
    assert.equal(nb!.slot, "LUNCH");
    assert.equal(na!.slot, null, "the usual lunch moved off the other meal");
    ok("usual lunch moved from Chicken salad to Weekend salad");
    await FavoritesService.update(pid, b.id, { slot: null });
    assert.equal((await prisma.favMeal.findUnique({ where: { id: b.id } }))!.slot, null);
    ok("usual cleared");

    const t = await FavoritesService.log(pid, a.id, { timeZone: EVAL_TZ });
    assert.equal(t.entries.length, 1);
    assert.equal(t.entries[0].calories, a.calories, "same numbers as saved");
    const y = await FavoritesService.log(pid, a.id, { timeZone: EVAL_TZ, date: "2026-01-02", mealType: "DINNER", portion: "hearty" });
    assert.equal(y.mealType, "DINNER");
    assert(y.entries[0].calories > a.calories, "hearty is bigger");
    const recall = await prisma.foodEntry.findUnique({ where: { id: y.entries[0].id }, select: { source: true, portionStop: true } });
    assert.deepEqual(recall, { source: "recall", portionStop: "hearty" });
    ok(`logged today ${t.entries[0].calories} kcal; Jan 2 dinner, hearty ${y.entries[0].calories} kcal (source recall)`);
    await rejects(FavoritesService.log(pid, a.id, { timeZone: EVAL_TZ, date: "2999-01-01" }), 400);
    assert.equal((await prisma.favMeal.findUnique({ where: { id: a.id } }))!.useCount, 2);
    ok("future day refused; useCount 2");

    const other = await prisma.patient.findFirst({ where: { id: { not: pid } }, select: { id: true } });
    await rejects(FavoritesService.log(other!.id, a.id, {}), 404);
    await rejects(FavoritesService.remove(other!.id, a.id), 404);
    await rejects(FavoritesService.update(other!.id, a.id, { name: "mine now" }), 404);
    ok("another account's id → 404 on log, remove and rename");

    const before = await prisma.foodEntry.count({ where: { dailyFood: { userId: pid } } });
    await FavoritesService.remove(pid, a.id);
    assert.equal(await prisma.favMeal.count({ where: { id: a.id } }), 0);
    assert.equal(await prisma.foodEntry.count({ where: { dailyFood: { userId: pid } } }), before, "logged meals stay");
    ok("removed; the log keeps its meals");

    // Swipe-to-save from the food log: named after the entry, rows copied as logged.
    const breakfast = (Array.isArray(made) ? made : [made])[0];
    const fromLog: any = await FavoritesService.saveEntry(pid, breakfast.id);
    assert.equal(fromLog.description, "Oats bowl");
    assert.equal(fromLog.mealType, "BREAKFAST");
    assert.deepEqual(fromLog.ingredients.map((i: any) => i.name), ["Oats", "Milk", "Banana"]);
    assert.equal(Math.round(fromLog.calories), 435);
    ok(`saved logged entry → "${fromLog.description}" ${Math.round(fromLog.calories)} kcal, ${fromLog.ingredients.length} rows`);
    ok(`same name again refused: ${await rejects(FavoritesService.saveEntry(pid, breakfast.id), 409)}`);
    await rejects(FavoritesService.saveEntry(other!.id, breakfast.id), 404);
    await rejects(FavoritesService.saveEntry(pid, undefined), 400);
    ok("another account's entry → 404; no id → 400");
    console.log("\nALL PASS");
  } finally {
    await destroyFixture();
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
