/**
 * Meal plan round trip on the dev DB — no LLM. Creates a 2-day plan for the
 * given user (default dev account), checks the active view, derived logged
 * state, a swap, the snapshot line, then deletes the plan and restores the
 * previous ACTIVE one if there was one.
 *   npx ts-node --transpile-only scripts/mealplan-smoke.ts [email]
 */
import "dotenv/config";
import prisma from "../src/utility/prismaClient";
import MealPlanService, { looksLike, normalizeMealPlanInput } from "../src/services/meal_plan/model/meal_plan.model";
import { buildPatientSnapshot, renderSnapshot } from "../src/services/agent/context/snapshot";
import { planInputFromCard } from "../src/services/agent/tools/mealplan.tools";

const email = process.argv[2] ?? "antoricciardelli@gmail.com";
const ok = (cond: unknown, what: string) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${what}`);
  if (!cond) process.exitCode = 1;
};

(async () => {
  const patient = await prisma.patient.findFirst({ where: { email }, select: { id: true } });
  if (!patient) throw new Error(`no patient ${email}`);
  const pid = patient.id;
  const previous = await prisma.mealPlan.findFirst({ where: { patientId: pid, status: "ACTIVE" }, select: { id: true } });
  let createdId: string | null = null;
  try {
    // Shape = what generate_meal_plan puts in its card
    const card = {
      title: "Smoke plan",
      notes: "two lines of notes",
      targets: { calories: [1500, 1700] },
      fit: { ok: true, issues: [] },
      days: [
        { day: 1, meals: [
          { mealType: "BREAKFAST", name: "Greek yogurt with berries", ingredients: ["200 g Greek yogurt", "100 g blueberries"], calories: 260, protein_g: 22, carbs_g: 24, fat_g: 8, prepMinutes: 5 },
          { mealType: "LUNCH", name: "Chicken quinoa bowl", ingredients: ["150 g chicken breast", "150 g cooked quinoa"], calories: 520, protein_g: 48, carbs_g: 45, fat_g: 14, prepMinutes: 20 },
          { mealType: "DINNER", name: "Salmon with roasted vegetables", ingredients: ["160 g salmon fillet", "250 g mixed vegetables"], calories: 610, protein_g: 42, carbs_g: 20, fat_g: 36, prepMinutes: 30 },
        ] },
        { day: 2, meals: [
          { mealType: "BREAKFAST", name: "Oats with banana", ingredients: ["60 g oats", "1 banana"], calories: 340, protein_g: 10, carbs_g: 62, fat_g: 6, prepMinutes: 5 },
          { mealType: "DINNER", name: "Turkey chili", ingredients: ["150 g turkey mince", "200 g kidney beans"], calories: 580, protein_g: 50, carbs_g: 48, fat_g: 16, prepMinutes: 35 },
        ] },
      ],
    };
    const input = planInputFromCard(card);
    ok(input.days.length === 2 && input.days[1].meals[1].proteins === 50, "card → plan input keeps meals and macros");
    let threw = false;
    try { normalizeMealPlanInput({ title: "x", days: [] }); } catch { threw = true; }
    ok(threw, "empty plan rejected");

    const v = await MealPlanService.create(pid, input);
    createdId = v.id;
    ok(v.status === "ACTIVE" && v.days === 2 && v.daysOut.length === 2, `created ACTIVE plan ${v.id} starting ${v.startDate}`);
    ok(v.todayIndex === 1, `today is day ${v.todayIndex}`);
    ok(v.daysOut[0].totals.calories === 1390, `day 1 totals recomputed (${v.daysOut[0].totals.calories} kcal)`);
    const prevStatus = previous ? (await prisma.mealPlan.findUnique({ where: { id: previous.id } }))?.status : null;
    ok(!previous || prevStatus === "REPLACED", previous ? `previous active plan → ${prevStatus}` : "no previous plan to replace");

    const active = await MealPlanService.getActive(pid);
    ok(active?.id === v.id, "getActive returns it");
    const todayLogged = active!.daysOut[0].meals.map((m) => `${m.mealType}:${m.logged ? (m.logged.matched ? "planned" : "other") : "-"}`).join(" ");
    console.log("      logged state today:", todayLogged);
    ok(looksLike("Salmon with roasted vegetables", "Grilled salmon, roasted veg and rice") && !looksLike("Salmon with roasted vegetables", "Pasta carbonara"), "name matching: salmon ≈ salmon, ≠ carbonara");

    const dinner = active!.daysOut[0].meals.find((m) => m.mealType === "DINNER")!;
    const swapped = await MealPlanService.replaceMeal(pid, v.id, dinner.id, { name: "Tofu stir-fry", description: null, ingredients: ["150 g tofu", "200 g vegetables"], calories: 480, proteins: 30, carbohydrates: 30, fats: 22, prepMinutes: 15 });
    const d = swapped!.daysOut[0].meals.find((m) => m.id === dinner.id)!;
    ok(d.name === "Tofu stir-fry" && d.swappedAt != null && d.mealType === "DINNER", "swap replaces the meal in place");
    ok(swapped!.daysOut[0].totals.calories === 1260, `day 1 totals follow the swap (${swapped!.daysOut[0].totals.calories} kcal)`);

    const snap = await buildPatientSnapshot(pid);
    const text = renderSnapshot(snap!);
    const line = text.split("\n").filter((l) => /meal plan|planned meals|tomorrow/.test(l)).join("\n");
    console.log(line.split("\n").map((l) => "      " + l).join("\n"));
    ok(/meal plan: "Smoke plan" · day 1 of 2/.test(text) && /Tofu stir-fry/.test(text) && /tomorrow: .*Turkey chili/.test(text), "snapshot carries today + tomorrow from the plan");

    const done = await MealPlanService.updateStatus(pid, v.id, "COMPLETED");
    ok(done?.status === "COMPLETED" && (await MealPlanService.getActive(pid)) === null, "COMPLETED → no active plan");
    const nothing = await MealPlanService.forSnapshot(pid, v.today);
    ok(nothing === null, "snapshot shows none once completed");
  } finally {
    if (createdId) await prisma.mealPlan.delete({ where: { id: createdId } }).catch(() => null);
    if (previous) await prisma.mealPlan.update({ where: { id: previous.id }, data: { status: "ACTIVE" } }).catch(() => null);
    await prisma.$disconnect();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
