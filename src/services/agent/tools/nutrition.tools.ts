import { z } from "zod";
import prisma from "../../../utility/prismaClient";
import { clampRange, dateRange, defineTool, subjectField } from "./registry";

const r1 = (n: number | null | undefined) => (n === null || n === undefined ? null : Math.round(n * 10) / 10);
const sum = (xs: (number | null | undefined)[]) => xs.reduce<number>((a, b) => a + (b ?? 0), 0);

export const getMeals = defineTool({
  name: "get_meals",
  description:
    "Meals logged in a date range (default: today; max 31 days), each with calories, macros and the per-ingredient breakdown when available. Use for 'what did I eat', 'how was my lunch', pattern questions.",
  schema: dateRange.extend({
    subjectId: subjectField,
    includeIngredients: z.boolean().optional().describe("Include per-ingredient rows (bigger). Default false."),
  }),
  risk: "read",
  async run(ctx, input) {
    const subject = await ctx.resolveSubject(input.subjectId);
    const range = clampRange(input, ctx.today);
    const days = await prisma.dailyFood.findMany({
      where: { userId: subject.id, date: { gte: range.from, lt: range.next } },
      include: {
        foodEntries: {
          include: input.includeIngredients
            ? { ingredients: { orderBy: { sortOrder: "asc" }, select: { name: true, quantity: true, unit: true, grams: true, calories: true, nutrientSource: true } } }
            : undefined,
        },
      },
      orderBy: { date: "asc" },
    });
    const byDay = days.map((d) => ({
      date: d.date.slice(0, 10),
      totalCalories: sum(d.foodEntries.map((e) => e.calories)),
      meals: d.foodEntries.map((e: any) => ({
        id: e.id,
        mealType: e.mealType,
        description: e.description,
        quantity: e.quantity,
        calories: e.calories,
        protein_g: r1(e.proteins),
        carbs_g: r1(e.carbohydrates),
        fat_g: r1(e.fats),
        fiber_g: r1(e.fiber),
        sodium_mg: r1(e.sodium),
        addedSugar_g: r1(e.addedSugar),
        isProcessedFood: e.isProcessedFood ?? null,
        ...(e.ingredients ? { ingredients: e.ingredients } : {}),
      })),
    }));
    return {
      result: { subject: subject.name, from: range.from, to: range.to, ...(range.clamped ? { note: "range clamped to 31 days" } : {}), days: byDay },
      cards: byDay.length ? [{ type: "meals", title: `Meals ${range.from === range.to ? range.to : `${range.from} → ${range.to}`}`, data: byDay }] : [],
    };
  },
});

export const getNutritionSummary = defineTool({
  name: "get_nutrition_summary",
  description:
    "Daily nutrition totals (calories, protein, carbs, fat, fiber, sodium, added sugar, glycemic load, veg/fruit servings) per day in a range (default: last 7 days; max 31), plus the range average and the plan's daily targets for comparison. Use for progress, trends, 'am I hitting my protein'.",
  schema: dateRange.extend({ subjectId: subjectField }),
  risk: "read",
  async run(ctx, input) {
    const subject = await ctx.resolveSubject(input.subjectId);
    const range = clampRange({ from: input.from ?? shift(input.to ?? ctx.today, -6), to: input.to }, ctx.today);
    const [days, plan] = await Promise.all([
      prisma.dailyFood.findMany({
        where: { userId: subject.id, date: { gte: range.from, lt: range.next } },
        include: { foodEntries: { select: { calories: true, proteins: true, carbohydrates: true, fats: true, fiber: true, sodium: true, addedSugar: true, glycemicLoad: true, vegetableServings: true, fruitServings: true } } },
        orderBy: { date: "asc" },
      }),
      subject.isSelf
        ? prisma.healthPlan.findFirst({ where: { patientId: ctx.patientId, status: "ACTIVE" }, include: { targets: true, watchOuts: true }, orderBy: { createdAt: "desc" } })
        : null,
    ]);
    const rows = days
      .filter((d) => d.foodEntries.length)
      .map((d) => ({
        date: d.date.slice(0, 10),
        meals: d.foodEntries.length,
        calories: sum(d.foodEntries.map((e) => e.calories)),
        protein_g: r1(sum(d.foodEntries.map((e) => e.proteins))),
        carbs_g: r1(sum(d.foodEntries.map((e) => e.carbohydrates))),
        fat_g: r1(sum(d.foodEntries.map((e) => e.fats))),
        fiber_g: r1(sum(d.foodEntries.map((e) => e.fiber))),
        sodium_mg: r1(sum(d.foodEntries.map((e) => e.sodium))),
        addedSugar_g: r1(sum(d.foodEntries.map((e) => e.addedSugar))),
        glycemicLoad: r1(sum(d.foodEntries.map((e) => e.glycemicLoad))),
        vegServings: r1(sum(d.foodEntries.map((e) => e.vegetableServings))),
        fruitServings: r1(sum(d.foodEntries.map((e) => e.fruitServings))),
      }));
    const avg = (k: keyof (typeof rows)[number]) =>
      rows.length ? r1(sum(rows.map((r) => r[k] as number)) / rows.length) : null;
    const result = {
      subject: subject.name,
      from: range.from,
      to: range.to,
      daysLogged: rows.length,
      average: rows.length
        ? { calories: avg("calories"), protein_g: avg("protein_g"), carbs_g: avg("carbs_g"), fat_g: avg("fat_g"), fiber_g: avg("fiber_g"), sodium_mg: avg("sodium_mg"), addedSugar_g: avg("addedSugar_g") }
        : null,
      dailyTargets: plan
        ? plan.targets.filter((t) => t.pillar === "NUTRITION").map((t) => ({ metricKey: t.metricKey, min: t.min, max: t.max, unit: t.unit, cadence: t.cadence }))
        : [],
      watchOuts: plan ? plan.watchOuts.map((w) => ({ nutrientKey: w.nutrientKey, level: w.level, limit: w.limit, unit: w.unit })) : [],
      days: rows,
    };
    return { result, cards: rows.length ? [{ type: "nutrition_summary", title: "Nutrition", data: result }] : [] };
  },
});

export const getFavorites = defineTool({
  name: "get_favorites",
  description: "The user's saved favorite meals (name, meal type, calories, macros). Use before suggesting meals or when the user mentions 'my usual' / 'my favorite'.",
  schema: z.object({ subjectId: subjectField }),
  risk: "read",
  async run(ctx, input) {
    const subject = await ctx.resolveSubject(input.subjectId);
    const favs = await prisma.favMeal.findMany({
      where: { userId: subject.id },
      orderBy: { createdAt: "desc" },
      take: 40,
      select: { id: true, mealType: true, description: true, quantity: true, calories: true, proteins: true, carbohydrates: true, fats: true },
    });
    const result = favs.map((f) => ({
      id: f.id,
      mealType: f.mealType,
      description: f.description,
      quantity: f.quantity,
      calories: f.calories,
      protein_g: r1(f.proteins),
      carbs_g: r1(f.carbohydrates),
      fat_g: r1(f.fats),
    }));
    return { result: { subject: subject.name, favorites: result } };
  },
});

const shift = (day: string, delta: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
};
