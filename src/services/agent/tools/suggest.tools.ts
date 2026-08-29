import { z } from "zod";
import moment from "moment-timezone";
import prisma from "../../../utility/prismaClient";
import { getLLM } from "../llm/openai.client";
import { analyzeMeal } from "../../meal_analysis/mealAnalysis.service";
import { MEAL_TYPES } from "../../meal_analysis/mealAnalysis.schema";
import { defineTool, subjectField } from "./registry";
import { nutritionContext, type MacroRange } from "./generation.tools";

/**
 * suggest_meal — ONE meal for the next slot, sized to what is left of today's
 * targets, then grounded: the model proposes name + portions, analyzeMeal
 * (USDA resolver) computes the nutrition, so the card's numbers are the same
 * numbers the user would see when logging it. Nothing is persisted; the card
 * carries a Log-it hand-off.
 */

const r0 = (n: number) => Math.round(n);
const r1 = (n: number) => Math.round(n * 10) / 10;
const sum = (xs: number[]) => xs.reduce((a, b) => a + (Number(b) || 0), 0);
const mid = ([min, max]: MacroRange) => (min != null && max != null ? (min + max) / 2 : max ?? min ?? null);

const slotFor = (tz: string): (typeof MEAL_TYPES)[number] => {
  const h = moment().tz(tz).hour();
  if (h < 10) return "BREAKFAST";
  if (h < 14) return "LUNCH";
  if (h < 17) return "SNACK";
  return "DINNER";
};

/** How much of the day's budget this slot should take when nothing else guides it. */
const SLOT_SHARE: Record<string, number> = { BREAKFAST: 0.25, LUNCH: 0.35, DINNER: 0.35, SNACK: 0.1 };
const SLOT_ORDER = ["BREAKFAST", "LUNCH", "SNACK", "DINNER"];

export const suggestMeal = defineTool({
  name: "suggest_meal",
  description:
    "Suggest ONE concrete meal for a slot (default: the next one by time of day), sized to what is left of today's calorie and protein targets and shaped by allergies, preferences, favorites and anything the user asks for (ingredients on hand, cuisine, time). Nutrition is computed from the actual portions. Returns a card with portions and a Log-it button, plus two alternatives. Use whenever the user asks what to eat — don't answer with a generic list, and don't ask what's in the fridge first unless they clearly want that.",
  schema: z.object({
    mealType: z.enum(MEAL_TYPES).optional().describe("Omit to pick the next slot from the time of day"),
    request: z.string().max(400).optional().describe("The user's wishes verbatim: ingredients on hand, cuisine, quick, light, 'like my usual'…"),
    subjectId: subjectField,
  }),
  risk: "generate",
  async run(ctx, input) {
    const subject = await ctx.resolveSubject(input.subjectId);
    const mealType = input.mealType ?? slotFor(ctx.timeZone);
    const [context, todayFood, favorites, memories] = await Promise.all([
      nutritionContext(ctx.patientId, subject.id),
      prisma.dailyFood.findMany({ where: { userId: subject.id, date: { startsWith: ctx.today } }, include: { foodEntries: { select: { mealType: true, description: true, calories: true, proteins: true, carbohydrates: true, fats: true } } } }),
      prisma.favMeal.findMany({ where: { userId: subject.id }, orderBy: { createdAt: "desc" }, take: 15, select: { mealType: true, description: true, calories: true, proteins: true } }),
      prisma.agentMemory.findMany({ where: { patientId: ctx.patientId, active: true, category: { in: ["PREFERENCE", "CONSTRAINT"] } }, take: 20, select: { content: true } }),
    ]);

    /* ------------------------------ budget ------------------------------ */
    const eaten = todayFood.flatMap((d) => d.foodEntries);
    const eatenKcal = r0(sum(eaten.map((e) => e.calories)));
    const eatenProtein = r1(sum(eaten.map((e) => e.proteins)));
    const t = context.dailyTargets;
    const dayKcal = t ? mid(t.calories) : null;
    const dayProtein = t ? mid(t.protein_g) : null;
    const kcalLeft = dayKcal != null ? r0(dayKcal - eatenKcal) : null;
    const proteinLeft = dayProtein != null ? r1(dayProtein - eatenProtein) : null;
    // Slots still to come after this one (by order) share the remainder.
    const slotsAfter = SLOT_ORDER.slice(SLOT_ORDER.indexOf(mealType) + 1).filter((s) => !eaten.some((e) => e.mealType === s));
    const shareAfter = sum(slotsAfter.map((s) => SLOT_SHARE[s]));
    const share = SLOT_SHARE[mealType] / (SLOT_SHARE[mealType] + shareAfter || 1);
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
    const isSnack = mealType === "SNACK";
    const aimKcal = kcalLeft != null ? r0(clamp(kcalLeft * share, isSnack ? 100 : 300, isSnack ? 300 : 900)) : dayKcal != null ? r0(dayKcal * SLOT_SHARE[mealType]) : isSnack ? 200 : 550;
    const aimProtein = proteinLeft != null ? r0(clamp(proteinLeft * share, isSnack ? 8 : 20, isSnack ? 25 : 60)) : isSnack ? 10 : 35;

    /* ----------------------------- generate ----------------------------- */
    const draft = await getLLM().json<{ name: string; description: string; ingredients: { item: string; grams: number; note: string }[]; prepMinutes: number; why: string; alternatives: { name: string; description: string }[] }>({
      system: `You are a dietitian suggesting ONE ${mealType.toLowerCase()} for right now. Hit the calorie and protein aim (±15%) with realistic portions in grams — count honestly (protein 4 kcal/g, carbs 4, fat 9). Respect allergies (never, in any form), intolerances, dislikes, watch-outs (keep flagged nutrients low) and remembered constraints; lean on likes and favorites when they fit. Honour the request (ingredients on hand, time, cuisine). Simple food people actually cook. Two different alternatives in one line each. No supplements, no medical claims.`,
      user: JSON.stringify({
        mealType,
        aim: { calories: aimKcal, protein_g: aimProtein },
        today: { eatenKcal, eatenProtein_g: eatenProtein, kcalLeft, proteinLeft_g: proteinLeft, dailyTargets: t },
        request: input.request ?? null,
        context,
        favorites: favorites.map((f) => `${f.mealType.toLowerCase()}: ${f.description} (${f.calories} kcal, ${r0(f.proteins)} g protein)`),
        remembered: memories.map((m) => m.content),
      }),
      schema: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: "string", description: "One line: what it is" },
          ingredients: {
            type: "array",
            items: { type: "object", properties: { item: { type: "string", description: "'salmon fillet', 'cooked quinoa'" }, grams: { type: "number" }, note: { type: "string", description: "household measure, e.g. '1 fillet', '½ cup' — or empty" } }, required: ["item", "grams", "note"], additionalProperties: false },
          },
          prepMinutes: { type: "integer" },
          why: { type: "string", description: "One line: how it fits today's numbers / their plan" },
          alternatives: { type: "array", items: { type: "object", properties: { name: { type: "string" }, description: { type: "string" } }, required: ["name", "description"], additionalProperties: false } },
        },
        required: ["name", "description", "ingredients", "prepMinutes", "why", "alternatives"],
        additionalProperties: false,
      },
      schemaName: "meal_suggestion",
      model: getLLM().defaultModel,
    });

    /* ------------------------------ ground ------------------------------ */
    const lines = draft.ingredients.map((i) => `${i.grams} g ${i.item}${i.note ? ` (${i.note})` : ""}`);
    let logText = `${draft.name}: ${lines.join(", ")}`;
    let rescaled: number | null = null;
    let nutrition: { calories: number; protein_g: number; carbs_g: number; fat_g: number; saturatedFat_g: number | null; fiber_g: number | null; sodium_mg: number | null } | null = null;
    let ingredients: { name: string; quantity: string; grams: number; calories: number | null }[] = draft.ingredients.map((i) => ({ name: i.item, quantity: i.note || `${i.grams} g`, grams: i.grams, calories: null }));
    let nutrientSource: "usda" | "model" | "unresolved" = "unresolved";
    try {
      const analysis = await analyzeMeal({ text: logText, mealTypeHint: mealType, todayLocal: ctx.today }, { patientId: subject.id });
      let ings = analysis.meals.flatMap((m) => m.ingredients);
      if (ings.length) {
        // Portion correction: the model sizes meals small. When the grounded
        // calories miss the aim by >15% and every ingredient carries a
        // per-100 g vector, scale the portions (bounded) instead of re-asking.
        const grounded = r0(sum(ings.map((i) => i.calories)));
        if (grounded > 0 && Math.abs(grounded - aimKcal) > aimKcal * 0.15) {
          const f = Math.min(1.35, Math.max(0.75, aimKcal / grounded));
          ings = ings.map((i) => {
            if (!(i.grams > 0)) return i; // seasonings etc. — leave as is
            const nutrients = Object.fromEntries(Object.entries(i.nutrients).map(([k, v]) => [k, (Number(v) || 0) * f])) as typeof i.nutrients;
            return { ...i, grams: r0(i.grams * f), quantity: r0(i.grams * f), unit: "g" as const, calories: i.calories * f, nutrients };
          });
          rescaled = r1(f);
        }
        const n = (k: keyof (typeof ings)[number]["nutrients"]) => r1(sum(ings.map((i) => i.nutrients[k])));
        nutrition = { calories: r0(sum(ings.map((i) => i.calories))), protein_g: n("proteins"), carbs_g: n("carbohydrates"), fat_g: n("fats"), saturatedFat_g: n("saturatedFats"), fiber_g: n("fiber"), sodium_mg: r0(n("sodium")) };
        ingredients = ings.map((i) => ({ name: i.name, quantity: i.unit === "g" ? `${r0(i.grams)} g` : `${i.quantity} ${i.unit}`.trim(), grams: r0(i.grams), calories: r0(i.calories) }));
        nutrientSource = ings.some((i) => i.nutrientSource === "usda") ? "usda" : "model";
        if (rescaled) logText = `${draft.name}: ${ingredients.map((i) => `${i.grams} g ${i.name}`).join(", ")}`;
      }
    } catch (e) {
      console.error("suggest_meal: analyzeMeal failed, falling back to model estimate", e);
    }
    if (!nutrition) {
      // Analyzer unavailable: rough estimate from the aim so the card is never blank.
      nutrition = { calories: aimKcal, protein_g: aimProtein, carbs_g: 0, fat_g: 0, saturatedFat_g: null, fiber_g: null, sodium_mg: null };
    }

    // Judge the fit on where the DAY lands, not on the slot aim: if nothing
    // else is coming, the day after this meal should sit inside the range.
    const [tMin, tMax] = t?.calories ?? [null, null];
    const dayAfter = eatenKcal + nutrition.calories;
    const laterKcal = slotsAfter.length ? r0((kcalLeft ?? 0) - nutrition.calories) : 0;
    let fit: string;
    if (tMin != null && tMax != null) {
      const lo = tMin * 0.9; // a single meal is capped at 900 kcal, so allow a slightly light day
      const hi = tMax * 1.05;
      const projected = dayAfter + Math.max(0, laterKcal);
      if (dayAfter > hi) fit = `${r0(dayAfter - tMax)} kcal over today's ${tMin}–${tMax}`;
      else if (projected < lo) fit = `Light: day would land at ${r0(projected)} of ${tMin}–${tMax} kcal`;
      else fit = slotsAfter.length ? `Fits: ${nutrition.calories} kcal, leaves ${Math.max(0, laterKcal)} for later` : `Fits: day lands at ${r0(dayAfter)} of ${tMin}–${tMax} kcal`;
    } else fit = kcalLeft != null ? `${nutrition.calories} of ${kcalLeft} kcal left today` : `About ${nutrition.calories} kcal`;

    const data = {
      subject: subject.name,
      subjectId: subject.isSelf ? null : subject.id,
      mealType,
      name: draft.name,
      description: draft.description,
      ingredients,
      ...nutrition,
      prepMinutes: draft.prepMinutes,
      why: draft.why,
      budget: { eatenKcal, kcalLeft, proteinLeft_g: proteinLeft, aimKcal, aimProtein_g: aimProtein, targetsFrom: context.targetsFrom },
      fit,
      nutrientSource,
      rescaled,
      alternatives: draft.alternatives.slice(0, 2),
      logText,
    };
    return {
      result: {
        mealType,
        name: draft.name,
        calories: nutrition.calories,
        protein_g: nutrition.protein_g,
        carbs_g: nutrition.carbs_g,
        fat_g: nutrition.fat_g,
        prepMinutes: draft.prepMinutes,
        budget: { kcalLeft, proteinLeft_g: proteinLeft, aimKcal },
        fit,
        dayAfterThisMeal: { calories: r0(dayAfter), targetRange: t?.calories ?? null },
        alternatives: draft.alternatives.map((a) => a.name),
        note: "The card shows the portions and a Log-it button (the user taps it; don't call log_meal yourself). Keep your text to 2–4 lines: name the meal with its calories and protein (e.g. '≈ 700 kcal, 70 g protein'), then repeat `fit` as given — it is the verdict on where the day lands, don't soften 'Light'/'over' into 'within target' — then the alternatives by name.",
      },
      cards: [{ type: "meal_suggestion", title: `${mealType.charAt(0) + mealType.slice(1).toLowerCase()} idea`, data }],
    };
  },
});
