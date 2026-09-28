/**
 * Saved-meal routes over real HTTP (needs the server on :5000): list, rename +
 * usual, log hearty, another account gets 404 on log / delete (incl. the old
 * POST deleteFavMeal), delete own. Eval fixture, destroyed after.
 *   npx ts-node --transpile-only scripts/favorites-http-smoke.ts
 */
import "dotenv/config";
import assert from "assert";
import jwt from "jsonwebtoken";
import moment from "moment-timezone";
import prisma from "../src/utility/prismaClient";
import NutritionService from "../src/services/nutrition/model/nutrition.model";
import CaloriesService from "../src/services/calories_tracker/model/calories.model";
import { createFixture, destroyFixture, EVAL_TZ } from "../tests/agent/fixture";

const BASE = "http://localhost:5000/api";
const call = async (token: string, method: string, path: string, body?: any) => {
  const r = await fetch(BASE + path, { method, headers: { "access-token": token, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
};

(async () => {
  await destroyFixture();
  const { patientId: pid } = await createFixture();
  try {
    const made: any = await CaloriesService.createFoodEntry(pid, [{ description: "Oats bowl", quantity: "1", calories: 0, mealType: "BREAKFAST", ingredients: [{ name: "Oats", quantity: 60, unit: "g", grams: 60, gramsLow: 45, gramsHigh: 80, portionSource: "user", calories: 230, nutrients: { proteins: 8, carbohydrates: 40, fats: 4 } }], nutrients: {}, glycemicLoad: 0 }], moment().tz(EVAL_TZ).hour(8), EVAL_TZ);
    const fav: any = await NutritionService.createFavMeal(made, pid, "Oats bowl", "BREAKFAST");
    const mine = jwt.sign({ user: { id: pid } }, process.env.JWT_SECRET || "");
    const other = await prisma.patient.findFirst({ where: { id: { not: pid } }, select: { id: true } });
    const theirs = jwt.sign({ user: { id: other!.id } }, process.env.JWT_SECRET || "");

    let r = await call(mine, "GET", "/nutrition/favorites");
    assert.equal(r.status, 200); assert.equal(r.json.result.length, 1); assert.equal(r.json.result[0].portionScalable, true);
    console.log("✓ GET list", r.json.result.map((f: any) => f.description));
    r = await call(mine, "PUT", `/nutrition/favorites/${fav.id}`, { slot: "BREAKFAST", name: "Usual oats" });
    assert.equal(r.status, 200); assert.equal(r.json.result.slot, "BREAKFAST"); assert.equal(r.json.result.description, "Usual oats");
    console.log("✓ PUT rename + usual");
    r = await call(mine, "POST", `/nutrition/favorites/${fav.id}/log`, { mealType: "BREAKFAST", portion: "hearty", timeZone: EVAL_TZ });
    assert.equal(r.status, 200); assert(r.json.result.entries[0].calories > 230);
    console.log("✓ POST log", r.json.result);
    r = await call(theirs, "POST", `/nutrition/favorites/${fav.id}/log`, {});
    assert.equal(r.status, 404); console.log("✓ other account log → 404", r.json.message);
    r = await call(theirs, "POST", `/nutrition/deleteFavMeal`, { favMealId: fav.id });
    assert.equal(r.status, 404); console.log("✓ old delete route, other account → 404");
    r = await call(theirs, "DELETE", `/nutrition/favorites/${fav.id}`);
    assert.equal(r.status, 404); console.log("✓ other account DELETE → 404");
    r = await call(mine, "DELETE", `/nutrition/favorites/${fav.id}`);
    assert.equal(r.status, 200); assert.equal(await prisma.favMeal.count({ where: { id: fav.id } }), 0);
    console.log("✓ DELETE own\nALL PASS");
  } finally {
    await destroyFixture();
    await prisma.$disconnect();
  }
})().catch((e) => { console.error(e); process.exit(1); });
