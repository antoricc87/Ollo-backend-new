import { z } from "zod";
import prisma from "../../../utility/prismaClient";
import { getLLM } from "../llm/openai.client";
import { randomUUID } from "crypto";
import { defineTool, subjectField } from "./registry";
import { planInputFromCard, registerDraft } from "./mealplan.tools";

/**
 * Generation tools. These are the one place a tool calls the model — as a
 * structured-output SERVICE (strict schema, no conversation), the same way
 * analyzeMeal does. Nothing is persisted; the result is a card the user can
 * act on (log a meal from it, build a grocery list, save it later).
 */

export type MacroRange = [number | null | undefined, number | null | undefined];
export type DailyTargets = { calories: MacroRange; protein_g: MacroRange; carbs_g: MacroRange; fat_g: MacroRange };

export const nutritionContext = async (patientId: string, subjectId: string) => {
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
  // No active plan → fall back to the onboarding calorie estimate (±10%) so generation is never unconstrained.
  const kcal = summary?.caloricAmount ?? null;
  const dailyTargets: DailyTargets | null = plan
    ? { calories: [t("calories")?.min, t("calories")?.max], protein_g: [t("protein_g")?.min, t("protein_g")?.max], carbs_g: [t("carbs_g")?.min, t("carbs_g")?.max], fat_g: [t("fat_g")?.min, t("fat_g")?.max] }
    : kcal
    ? { calories: [Math.round(kcal * 0.9), Math.round(kcal * 1.1)], protein_g: [null, null], carbs_g: [null, null], fat_g: [null, null] }
    : null;
  return {
    dailyTargets,
    targetsFrom: plan ? "plan" : kcal ? "estimate" : "none",
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

/* ------------------------------ validation ------------------------------ */

const TOLERANCE = 0.1; // ±10% of the target range counts as a fit
const round = (n: number, d = 0) => Math.round(n * 10 ** d) / 10 ** d;

/** Does `value` sit inside [min, max] with tolerance? Open ends pass. */
const inRange = (value: number, [min, max]: MacroRange) => {
  const lo = min != null ? min * (1 - TOLERANCE) : -Infinity;
  const hi = max != null ? max * (1 + TOLERANCE) : Infinity;
  return value >= lo && value <= hi;
};
const rangeText = ([min, max]: MacroRange, unit: string) => (min != null && max != null ? `${min}–${max}${unit}` : min != null ? `≥${min}${unit}` : max != null ? `≤${max}${unit}` : "?");

/** Case-insensitive word match of an allergen/dislike token in an ingredient line. */
const mentions = (line: string, token: string) => {
  const t = token.trim().toLowerCase();
  if (t.length < 3) return false;
  return new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(line);
};

type PlanMeal = { mealType: string; name: string; ingredients: string[]; calories: number; protein_g: number; carbs_g: number; fat_g: number };
type PlanDay = { day: number; meals: PlanMeal[]; totals: { calories: number; protein_g: number; carbs_g: number; fat_g: number } };

/**
 * Recompute every day's totals from its meals (the model's own `totals` are
 * not trusted) and list what misses the targets or names an allergen. Days
 * are mutated in place so the card carries the real sums.
 */
export const checkMealPlan = (days: PlanDay[], targets: DailyTargets | null, allergens: string[]) => {
  const issues: string[] = [];
  for (const d of days) {
    const sum = (k: keyof Omit<PlanMeal, "mealType" | "name" | "ingredients">) => round(d.meals.reduce((a, m) => a + (Number(m[k]) || 0), 0), k === "calories" ? 0 : 1);
    d.totals = { calories: sum("calories"), protein_g: sum("protein_g"), carbs_g: sum("carbs_g"), fat_g: sum("fat_g") };
    if (targets) {
      const checks: [keyof DailyTargets, string, number][] = [
        ["calories", " kcal", d.totals.calories],
        ["protein_g", " g protein", d.totals.protein_g],
        ["carbs_g", " g carbs", d.totals.carbs_g],
        ["fat_g", " g fat", d.totals.fat_g],
      ];
      for (const [key, unit, value] of checks) if (!inRange(value, targets[key])) issues.push(`Day ${d.day}: ${value}${unit} vs target ${rangeText(targets[key], unit)}`);
    }
    for (const m of d.meals)
      for (const a of allergens) if (m.ingredients.some((line) => mentions(line, a)) || mentions(m.name, a)) issues.push(`Day ${d.day} ${m.mealType.toLowerCase()} "${m.name}" contains ${a} (allergy)`);
  }
  return issues;
};

/** Concrete per-meal anchors so the model doesn't under-feed: mid-target split across the meals. */
const perMealGuide = (targets: DailyTargets | null, mealsPerDay: number) => {
  if (!targets) return null;
  const midOf = ([min, max]: MacroRange) => (min != null && max != null ? (min + max) / 2 : max ?? min ?? null);
  const kcal = midOf(targets.calories);
  const protein = midOf(targets.protein_g);
  if (kcal == null) return null;
  // snacks take ~10% each; the rest is split across main meals
  const snacks = Math.max(0, mealsPerDay - 3);
  const mainShare = (1 - 0.1 * snacks) / Math.min(3, mealsPerDay);
  const r = (n: number) => Math.round(n);
  return {
    dayTotal: { calories: r(kcal), protein_g: protein != null ? r(protein) : null },
    mainMeal: { calories: r(kcal * mainShare), protein_g: protein != null ? r(protein * mainShare) : null },
    snack: snacks ? { calories: r(kcal * 0.1), protein_g: protein != null ? r(protein * 0.1) : null } : null,
  };
};

/** What each failing day still needs, as numbers the reviser can act on. */
const deficits = (days: PlanDay[], targets: DailyTargets | null) => {
  if (!targets) return [];
  const midOf = ([min, max]: MacroRange) => (min != null && max != null ? (min + max) / 2 : max ?? min ?? null);
  const out: string[] = [];
  for (const d of days) {
    const parts: string[] = [];
    const k = midOf(targets.calories);
    const p = midOf(targets.protein_g);
    if (k != null && !inRange(d.totals.calories, targets.calories)) parts.push(`${d.totals.calories > k ? "" : "+"}${Math.round(k - d.totals.calories)} kcal`);
    if (p != null && !inRange(d.totals.protein_g, targets.protein_g)) parts.push(`${d.totals.protein_g > p ? "" : "+"}${Math.round(p - d.totals.protein_g)} g protein`);
    if (parts.length) out.push(`Day ${d.day}: ${parts.join(", ")} — add lean protein portions (e.g. +50 g chicken/fish ≈ +80 kcal, +12 g protein; +100 g Greek yogurt ≈ +60 kcal, +10 g protein) and starch/oil for calories`);
  }
  return out;
};

const cleanName = (name: string) => name.replace(/\s*[\(\[–-]\s*(larger|bigger|extra|increased|double)\s+portion\s*[\)\]]?/gi, "").trim();

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
    type Plan = { title: string; days: PlanDay[]; notes: string };
    const generate = (revision?: { previous: Plan; issues: string[] }) => getLLM().json<Plan>({
      system: `You are a registered-dietitian-style meal planner. Produce realistic, repeatable meals with explicit portions in grams. Every day's totals MUST land inside the daily calorie and macro ranges when given — use perMealGuide as the size of each meal (a weight-loss day is still ~1,500 kcal, not 800) and put a real protein portion (120–180 g meat/fish, 200 g Greek yogurt, 3 eggs, 150 g tofu…) in every main meal. Count calories per meal honestly from the portions (protein 4 kcal/g, carbs 4, fat 9). Respect watch-outs (keep flagged nutrients low), allergies (never include, in any form), intolerances, dislikes and stated preferences. Vary meals across days. No supplements, no medical claims.${
        revision ? " You are REVISING a plan that missed its targets: fix every listed issue by changing portions or swapping meals, keep everything that was fine. Meal names stay plain dish names — never annotate them with 'larger portion' or similar." : ""
      }`,
      user: JSON.stringify({
        days: input.days,
        mealsPerDay: input.mealsPerDay,
        perMealGuide: perMealGuide(context.dailyTargets, input.mealsPerDay),
        request: input.request ?? null,
        context,
        remembered: memories.map((m) => m.content),
        ...(revision ? { previousPlan: revision.previous, issues: revision.issues, stillNeeded: deficits(revision.previous.days, context.dailyTargets) } : {}),
      }),
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
    const MAX_REVISIONS = 2;
    let plan = await generate();
    let issues = checkMealPlan(plan.days, context.dailyTargets, context.foodAllergies);
    let revised = false;
    for (let i = 0; i < MAX_REVISIONS && issues.length; i++) {
      const revision = await generate({ previous: plan, issues });
      const revisedIssues = checkMealPlan(revision.days, context.dailyTargets, context.foodAllergies);
      // Keep whichever attempt is closer; an allergen hit is never "closer".
      const allergen = (xs: string[]) => xs.some((x) => /\(allergy\)/.test(x));
      if (revisedIssues.length <= issues.length && !(allergen(revisedIssues) && !allergen(issues))) {
        plan = revision;
        issues = revisedIssues;
        revised = true;
      }
    }
    for (const d of plan.days) for (const m of d.meals) m.name = cleanName(m.name);
    const fit = { ok: issues.length === 0, issues, targetsFrom: context.targetsFrom, revised };
    const draftId = randomUUID();
    const result = { subject: subject.name, subjectId: subject.isSelf ? null : subject.id, draftId, ...plan, targets: context.dailyTargets, fit };
    // Nothing is persisted; the draft is parked so save_meal_plan (or the card's Save) can pick it up.
    try {
      registerDraft(draftId, planInputFromCard(result), result);
    } catch (e) {
      console.error("generate_meal_plan: draft not registrable", e);
    }
    return {
      result: {
        draftId,
        title: plan.title,
        days: plan.days.map((d) => ({ day: d.day, totals: d.totals, meals: d.meals.map((m) => ({ meal: `${m.mealType.toLowerCase()}: ${m.name} (${m.calories} kcal)`, ingredients: m.ingredients })) })),
        notes: plan.notes,
        targets: context.dailyTargets,
        cardActions: "The card has per-meal 'Log' and 'Recipe' buttons, a 'Shopping list' button and a 'Save this week' button. Nothing is saved yet: if the user asks to save/keep/use it, call save_meal_plan with this draftId. For a shopping-list request, call build_grocery_list with every ingredient line above.",
        fit: issues.length ? { ok: false, issues, note: "Tell the user plainly which days miss the targets and by how much; offer to adjust. Do not say it fits." } : { ok: true },
      },
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
    return {
      result: { title: recipe.title, servings: recipe.servings, perServing: recipe.perServing, totalMinutes: recipe.prepMinutes + recipe.cookMinutes, ingredients: recipe.ingredients.map((i: any) => `${i.quantity} ${i.item}`) },
      cards: [{ type: "recipe", title: recipe.title, data: recipe }],
    };
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
