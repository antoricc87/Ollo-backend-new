import { z } from "zod";
import prisma from "../../../utility/prismaClient";
import { getLLM } from "../llm/openai.client";
import { defineTool, subjectField } from "./registry";

/**
 * Generation tools. These are the one place a tool calls the model — as a
 * structured-output SERVICE (strict schema, no conversation), the same way
 * analyzeMeal does. Nothing is persisted; the result is a card the user can
 * act on (log a meal from it, build a grocery list, save it later).
 */

const nutritionContext = async (patientId: string, subjectId: string) => {
  const [summary, plan] = await Promise.all([
    prisma.patientSummary.findUnique({
      where: { patientId: subjectId },
      include: { nutrition: true, allergies: { include: { allergy: true } }, conditions: { include: { condition: true } } },
    }),
    subjectId === patientId
      ? prisma.healthPlan.findFirst({ where: { patientId, status: "ACTIVE" }, include: { targets: true, watchOuts: true }, orderBy: { createdAt: "desc" } })
      : null,
  ]);
  const n = summary?.nutrition;
  const t = (key: string) => plan?.targets.find((x) => x.metricKey === key);
  return {
    dailyTargets: plan
      ? { calories: [t("calories")?.min, t("calories")?.max], protein_g: [t("protein_g")?.min, t("protein_g")?.max], carbs_g: [t("carbs_g")?.min, t("carbs_g")?.max], fat_g: [t("fat_g")?.min, t("fat_g")?.max] }
      : null,
    watchOuts: plan?.watchOuts.map((w) => `${w.nutrientKey} (${w.level}${w.limit ? ` ≤${w.limit}${w.unit ?? ""}` : ""})`) ?? [],
    dietaryPreferences: n?.dietaryPreferences ?? [],
    foodAllergies: [...(n?.foodAllergies ?? []), ...(summary?.allergies.map((a) => a.allergy.substance) ?? [])],
    intolerances: n?.foodIntollerances ?? [],
    likes: n?.foodILike ?? [],
    dislikes: n?.foodIDontLike ?? [],
    avoid: n?.foodsToAvoid ?? [],
    increase: n?.foodsToIncrease ?? [],
    conditions: summary?.conditions.map((c) => c.condition.name) ?? [],
  };
};

const MEAL_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    description: { type: "string", description: "One line: what it is and rough portions" },
    ingredients: { type: "array", items: { type: "string", description: "'150 g salmon fillet'" } },
    calories: { type: "integer" },
    protein_g: { type: "number" },
    carbs_g: { type: "number" },
    fat_g: { type: "number" },
    prepMinutes: { type: "integer" },
  },
  required: ["name", "description", "ingredients", "calories", "protein_g", "carbs_g", "fat_g", "prepMinutes"],
  additionalProperties: false,
};

export const generateMealPlan = defineTool({
  name: "generate_meal_plan",
  description:
    "Create a day-by-day meal plan (1–7 days) that fits the user's plan targets, watch-outs, allergies and preferences, plus any request (cuisine, budget, time, what's in the fridge). Returns a card; nothing is saved. For a family member pass subjectId.",
  schema: z.object({
    days: z.number().int().min(1).max(7).default(3),
    request: z.string().max(600).optional().describe("The user's wishes verbatim: cuisine, time, budget, ingredients on hand, meals per day…"),
    mealsPerDay: z.number().int().min(2).max(5).default(4),
    subjectId: subjectField,
  }),
  risk: "generate",
  async run(ctx, input) {
    const subject = await ctx.resolveSubject(input.subjectId);
    const context = await nutritionContext(ctx.patientId, subject.id);
    const memories = await prisma.agentMemory.findMany({ where: { patientId: ctx.patientId, active: true, category: { in: ["PREFERENCE", "CONSTRAINT"] } }, take: 20, select: { content: true } });
    const plan = await getLLM().json<{ title: string; days: { day: number; meals: any[]; totals: { calories: number; protein_g: number; carbs_g: number; fat_g: number } }[]; notes: string }>({
      system: `You are a registered-dietitian-style meal planner. Produce realistic, repeatable meals with explicit portions. Every day's totals must land inside the daily calorie and macro ranges when given; respect watch-outs (keep flagged nutrients low), allergies (never include), intolerances, dislikes and stated preferences. Vary meals across days. No supplements, no medical claims.`,
      user: JSON.stringify({ days: input.days, mealsPerDay: input.mealsPerDay, request: input.request ?? null, context, remembered: memories.map((m) => m.content) }),
      schema: {
        type: "object",
        properties: {
          title: { type: "string" },
          days: {
            type: "array",
            items: {
              type: "object",
              properties: {
                day: { type: "integer" },
                meals: { type: "array", items: { ...MEAL_SCHEMA, properties: { ...MEAL_SCHEMA.properties, mealType: { type: "string", enum: ["BREAKFAST", "LUNCH", "DINNER", "SNACK"] } }, required: [...MEAL_SCHEMA.required, "mealType"] } },
                totals: { type: "object", properties: { calories: { type: "integer" }, protein_g: { type: "number" }, carbs_g: { type: "number" }, fat_g: { type: "number" } }, required: ["calories", "protein_g", "carbs_g", "fat_g"], additionalProperties: false },
              },
              required: ["day", "meals", "totals"],
              additionalProperties: false,
            },
          },
          notes: { type: "string", description: "2 short lines: how it fits the targets/watch-outs; prep tips" },
        },
        required: ["title", "days", "notes"],
        additionalProperties: false,
      },
      schemaName: "meal_plan",
      model: getLLM().defaultModel,
    });
    const result = { subject: subject.name, ...plan, targets: context.dailyTargets };
    return {
      result: { title: plan.title, days: plan.days.map((d) => ({ day: d.day, totals: d.totals, meals: d.meals.map((m) => `${m.mealType.toLowerCase()}: ${m.name} (${m.calories} kcal)`) })), notes: plan.notes },
      cards: [{ type: "meal_plan", title: plan.title, data: result }],
    };
  },
});

export const generateRecipe = defineTool({
  name: "generate_recipe",
  description: "A full recipe (ingredients with quantities, steps, time, per-serving nutrition) for a dish — from the user's request or a meal in a plan you generated. Respects allergies, watch-outs and preferences. Returns a card.",
  schema: z.object({
    dish: z.string().min(2).max(200),
    servings: z.number().int().min(1).max(8).default(2),
    constraints: z.string().max(300).optional().describe("e.g. 'under 20 minutes', 'no oven', 'use the chicken I have'"),
    subjectId: subjectField,
  }),
  risk: "generate",
  async run(ctx, input) {
    const subject = await ctx.resolveSubject(input.subjectId);
    const context = await nutritionContext(ctx.patientId, subject.id);
    const recipe = await getLLM().json<any>({
      system: "Write a precise home-cook recipe. Metric quantities with household equivalents. Respect allergies (never include), intolerances, dislikes, watch-outs (keep flagged nutrients low) and the stated constraints. Per-serving nutrition must be a realistic estimate.",
      user: JSON.stringify({ dish: input.dish, servings: input.servings, constraints: input.constraints ?? null, context }),
      schema: {
        type: "object",
        properties: {
          title: { type: "string" },
          servings: { type: "integer" },
          prepMinutes: { type: "integer" },
          cookMinutes: { type: "integer" },
          ingredients: { type: "array", items: { type: "object", properties: { item: { type: "string" }, quantity: { type: "string" } }, required: ["item", "quantity"], additionalProperties: false } },
          steps: { type: "array", items: { type: "string" } },
          perServing: { type: "object", properties: { calories: { type: "integer" }, protein_g: { type: "number" }, carbs_g: { type: "number" }, fat_g: { type: "number" }, fiber_g: { type: "number" }, sodium_mg: { type: "number" } }, required: ["calories", "protein_g", "carbs_g", "fat_g", "fiber_g", "sodium_mg"], additionalProperties: false },
          tips: { type: "string" },
        },
        required: ["title", "servings", "prepMinutes", "cookMinutes", "ingredients", "steps", "perServing", "tips"],
        additionalProperties: false,
      },
      schemaName: "recipe",
    });
    return { result: { title: recipe.title, perServing: recipe.perServing, totalMinutes: recipe.prepMinutes + recipe.cookMinutes, ingredientCount: recipe.ingredients.length }, cards: [{ type: "recipe", title: recipe.title, data: recipe }] };
  },
});

export const buildGroceryList = defineTool({
  name: "build_grocery_list",
  description: "Turn meals/recipes (a plan you generated, or items the user lists) into a consolidated shopping list grouped by store section with quantities. Returns a card.",
  schema: z.object({
    items: z.array(z.string()).min(1).max(120).describe("Ingredient lines with quantities, e.g. '150 g salmon fillet' — merge duplicates yourself if easy"),
    servingsMultiplier: z.number().min(0.5).max(6).default(1),
    exclude: z.array(z.string()).optional().describe("Things the user already has"),
  }),
  risk: "generate",
  async run(_ctx, input) {
    const list = await getLLM().json<{ sections: { section: string; items: { item: string; quantity: string }[] }[]; itemCount: number }>({
      system: "Consolidate ingredient lines into one shopping list. Merge duplicates and sum quantities (scale by servingsMultiplier), round to buyable amounts, drop pantry staples the user says they have, and group by store section (Produce, Meat & Fish, Dairy & Eggs, Bakery, Pantry, Frozen, Other).",
      user: JSON.stringify(input),
      schema: {
        type: "object",
        properties: {
          sections: { type: "array", items: { type: "object", properties: { section: { type: "string" }, items: { type: "array", items: { type: "object", properties: { item: { type: "string" }, quantity: { type: "string" } }, required: ["item", "quantity"], additionalProperties: false } } }, required: ["section", "items"], additionalProperties: false } },
          itemCount: { type: "integer" },
        },
        required: ["sections", "itemCount"],
        additionalProperties: false,
      },
      schemaName: "grocery_list",
    });
    return { result: { itemCount: list.itemCount, sections: list.sections.map((s) => `${s.section}: ${s.items.length}`) }, cards: [{ type: "grocery_list", title: "Shopping list", data: list }] };
  },
});
