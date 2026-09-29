import { z } from "zod";
import prisma from "../../../utility/prismaClient";
import { getLLM } from "../llm/openai.client";
import { analyzeMeal } from "../../meal_analysis/mealAnalysis.service";
import { MEAL_TYPES } from "../../meal_analysis/mealAnalysis.schema";
import { defineTool, subjectField } from "./registry";
import { nutritionContext } from "./generation.tools";
import MealPlanService, { SLOT_SHARE } from "../../meal_plan/model/meal_plan.model";
import { mealBudget, slotFor } from "./budget";
import { isPortionScalable } from "../../meal_analysis/mealPortion";
import type { AnalyzedIngredient } from "../../meal_analysis/mealAnalysis.schema";
import { preparedMealLog } from "./write.tools";

/**
 * suggest_meal — ONE meal for the next slot, sized to what is left of today's
 * targets, then grounded: the model proposes name + portions, analyzeMeal
 * (USDA resolver) computes the nutrition, so the card's numbers are the same
 * numbers the user would see when logging it. Nothing is persisted; the card
 * carries a Log-it hand-off.
 *
 * `keep` (Sep 28 2026): food the person has already chosen ("I have lentil
 * soup — what goes with it?"). It is grounded first, exactly as said; the
 * model proposes only what completes the meal, and the two are sized
 * together. Before, that question went to portion_check, which sized the soup
 * alone, and the "what to add" half was answered from general knowledge —
 * unsized, ungrounded, and at odds with the portion just given.
 */

const r0 = (n: number) => Math.round(n);
const r1 = (n: number) => Math.round(n * 10) / 10;
const sum = (xs: number[]) => xs.reduce((a, b) => a + (Number(b) || 0), 0);
const norm = (s: string) => s.toLowerCase().replace(/\([^)]*\)/g, " ").replace(/\b(the|my|a|an|some|leftover|homemade|i made|i have|of|bowl|plate|serving)\b/g, " ").replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();

export const suggestMeal = defineTool({
  name: "suggest_meal",
  description:
    "Decide WHAT to eat for a meal (default: the next one by time of day): one concrete meal sized to what is left of today's calorie and protein targets, shaped by allergies, preferences, favorites and anything the user asks for (ingredients on hand, cuisine, time). Also when they already have part of the meal and ask what to add, pair, round it out or balance it with — pass that food in `keep`: it stays exactly as they said and the tool adds what completes it, sized together. Nutrition is computed from the actual portions. Returns a card with portions and a Log-it button, plus two alternatives. Don't answer what-to-eat questions with a generic list, and don't ask what's in the fridge first unless they clearly want that.",
  schema: z.object({
    mealType: z.enum(MEAL_TYPES).optional().describe("Omit to pick the next slot from the time of day"),
    request: z.string().max(400).optional().describe("The user's wishes verbatim: ingredients on hand, cuisine, quick, light, 'like my usual'…"),
    keep: z
      .array(z.string().min(2).max(200))
      .max(4)
      .optional()
      .describe("Food they have ALREADY chosen for this meal, in their words with any amount ('the lentil soup I made', 'half a frozen pizza'). It stays in the meal as said; the suggestion is what to add to it. Omit when nothing is chosen yet."),
    planDay: z.number().int().min(1).max(7).optional().describe("SWAP in the saved meal plan: the plan day (1-based) whose slot this replaces; pass mealType too. The meal is sized like the one it replaces and the card gets a 'Put in plan' button."),
    subjectId: subjectField,
  }),
  risk: "generate",
  async run(ctx, input) {
    const subject = await ctx.resolveSubject(input.subjectId);
    const mealType = input.mealType ?? slotFor(ctx.timeZone);
    /* ----------------------------- plan swap ----------------------------- */
    let planSlot: { planId: string; mealId: string; day: number; date: string; mealType: string; replaces: string; calories: number; proteins: number } | null = null;
    if (input.planDay) {
      if (!subject.isSelf) return { result: { error: "Meal-plan swaps are only for the user's own plan." } };
      if (!input.mealType) return { result: { error: "For a plan swap pass mealType (which slot of that day)." } };
      const plan = await MealPlanService.getActive(ctx.patientId);
      const day = plan?.daysOut.find((d) => d.day === input.planDay);
      const slot = day?.meals.find((m) => m.mealType === input.mealType);
      if (!plan || !day) return { result: { error: plan ? `The saved plan has ${plan.days} days; there is no day ${input.planDay}.` : "There is no saved meal plan to swap in. Generate one and save it first." } };
      if (!slot) return { result: { error: `Day ${input.planDay} of the plan has no ${input.mealType.toLowerCase()} slot.` } };
      planSlot = { planId: plan.id, mealId: slot.id, day: day.day, date: day.date, mealType: slot.mealType, replaces: slot.name, calories: slot.calories, proteins: slot.proteins };
    }
    const [context, favorites, memories] = await Promise.all([
      nutritionContext(ctx.patientId, subject.id),
      prisma.favMeal.findMany({ where: { userId: subject.id }, orderBy: { createdAt: "desc" }, take: 15, select: { mealType: true, description: true, calories: true, proteins: true } }),
      prisma.agentMemory.findMany({ where: { patientId: ctx.patientId, active: true, category: { in: ["PREFERENCE", "CONSTRAINT"] } }, take: 20, select: { content: true } }),
    ]);

    /* ------------------------------ budget ------------------------------ */
    const t = context.dailyTargets;
    const { eatenKcal, eatenProtein, dayKcal, kcalLeft, proteinLeft, slotsOpen: slotsAfter, share } = await mealBudget(subject.id, ctx.today, mealType, t, slotFor(ctx.timeZone));
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
    const isSnack = mealType === "SNACK";
    // A plan swap is sized like the meal it replaces, so the day's totals still hold.
    const aimKcal = planSlot ? r0(clamp(planSlot.calories, isSnack ? 100 : 300, isSnack ? 300 : 900)) : kcalLeft != null ? r0(clamp(kcalLeft * share, isSnack ? 100 : 300, isSnack ? 300 : 900)) : dayKcal != null ? r0(dayKcal * SLOT_SHARE[mealType]) : isSnack ? 200 : 550;
    const aimProtein = planSlot ? r0(clamp(planSlot.proteins, isSnack ? 8 : 20, isSnack ? 25 : 60)) : proteinLeft != null ? r0(clamp(proteinLeft * share, isSnack ? 8 : 20, isSnack ? 25 : 60)) : isSnack ? 10 : 35;

    /* ------------------------------- kept ------------------------------- */
    // What they already have is grounded first, as said; the rest is sized around it.
    let kept: AnalyzedIngredient[] = [];
    if (input.keep?.length) {
      const read = await analyzeMeal({ text: input.keep.join(", "), mealTypeHint: mealType, todayLocal: ctx.today }, { patientId: subject.id });
      kept = read.meals.flatMap((m) => m.ingredients).filter((i) => i.grams > 0);
      if (!kept.length) return { result: { error: `I couldn't read a food in "${input.keep.join(", ")}". Ask what they have, in a few words.` } };
    }
    const keptKcal = r0(sum(kept.map((i) => i.calories)));
    const keptProtein = r1(sum(kept.map((i) => i.nutrients.proteins)));
    const keptText = kept.map((i) => `${r0(i.grams)} g ${i.name}`).join(", ");
    // The model re-lists the kept food among its additions despite being told not to
    // (seen in 3 of 6 eval runs: "Lentil soup, Lentil soup" — its calories counted twice).
    // Code decides: anything that names the kept food is the kept food.
    const keptWords = [...(input.keep ?? []), ...kept.map((i) => i.name)].map(norm).filter(Boolean);
    const isKept = (name: string) => {
      const n = norm(name);
      return !!n && keptWords.some((k) => k.includes(n) || n.includes(k));
    };

    /* ----------------------------- generate ----------------------------- */
    const draft = await getLLM().json<{ name: string; description: string; ingredients: { item: string; grams: number; note: string }[]; prepMinutes: number; why: string; alternatives: { name: string; description: string }[] }>({
      system:
        `You are a dietitian suggesting ONE ${mealType.toLowerCase()}${planSlot ? ` to REPLACE "${planSlot.replaces}" on day ${planSlot.day} of the user's saved meal plan — something clearly different from it` : " for right now"}. Hit the calorie and protein aim (±15%) with realistic portions in grams — count honestly (protein 4 kcal/g, carbs 4, fat 9). Respect allergies (never, in any form), intolerances, dislikes, watch-outs (keep flagged nutrients low) and remembered constraints; lean on likes and favorites when they fit. Honour the request (ingredients on hand, time, cuisine). Simple food people actually cook. Two different alternatives in one line each. No supplements, no medical claims.` +
        (kept.length
          ? ` The user has ALREADY chosen part of this meal (\`kept\`, with its grounded calories and protein). It is in the meal exactly as given: list ONLY the additions in \`ingredients\`, sized so kept + additions hit the aim and balance the plate (what the kept food lacks — often protein, vegetables or a whole grain). If the kept food already reaches the calorie aim, add only light things (vegetables, salad). The name describes the whole meal, kept food included. The alternatives are two other ways to complete the SAME kept food, never a different dish.`
          : ""),
      user: JSON.stringify({
        mealType,
        aim: { calories: aimKcal, protein_g: aimProtein },
        today: { eatenKcal, eatenProtein_g: eatenProtein, kcalLeft, proteinLeft_g: proteinLeft, dailyTargets: t },
        request: input.request ?? null,
        ...(kept.length ? { kept: { foods: keptText, calories: keptKcal, protein_g: keptProtein }, aimForAdditions: { calories: Math.max(0, aimKcal - keptKcal), protein_g: Math.max(0, r0(aimProtein - keptProtein)) } } : {}),
        ...(planSlot ? { replacing: { name: planSlot.replaces, calories: planSlot.calories, protein_g: planSlot.proteins } } : {}),
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
    const additions = kept.length ? draft.ingredients.filter((i) => !isKept(i.item)) : draft.ingredients;
    const lines = additions.map((i) => `${i.grams} g ${i.item}${i.note ? ` (${i.note})` : ""}`);
    let logText = `${draft.name}: ${[keptText, ...lines].filter(Boolean).join(", ")}`;
    let groundedIngs: AnalyzedIngredient[] = [];
    let rescaled: number | null = null;
    let nutrition: { calories: number; protein_g: number; carbs_g: number; fat_g: number; saturatedFat_g: number | null; fiber_g: number | null; sodium_mg: number | null } | null = null;
    let ingredients: { name: string; quantity: string; grams: number; calories: number | null; kept?: boolean }[] = [
      ...kept.map((i) => ({ name: i.name, quantity: `${r0(i.grams)} g`, grams: r0(i.grams), calories: r0(i.calories), kept: true })),
      ...additions.map((i) => ({ name: i.item, quantity: i.note || `${i.grams} g`, grams: i.grams, calories: null })),
    ];
    let nutrientSource: "usda" | "model" | "unresolved" = "unresolved";
    try {
      // Only the additions are analysed; the kept food was grounded above.
      const added = lines.length ? (await analyzeMeal({ text: `${draft.name}: ${lines.join(", ")}`, mealTypeHint: mealType, todayLocal: ctx.today }, { patientId: subject.id })).meals.flatMap((m) => m.ingredients).filter((i) => !(kept.length && isKept(i.name))) : [];
      const keptSet = new Set<AnalyzedIngredient>(kept);
      let ings = [...kept, ...added];
      if (ings.length) {
        // Portion correction: the model sizes meals small. When the grounded
        // calories miss the aim by >15% and every ingredient carries a
        // per-100 g vector, scale the portions (bounded) instead of re-asking.
        const grounded = r0(sum(ings.map((i) => i.calories)));
        if (grounded > 0 && Math.abs(grounded - aimKcal) > aimKcal * 0.15) {
          const f = Math.min(1.35, Math.max(0.75, aimKcal / grounded));
          ings = ings.map((i) => {
            if (!(i.grams > 0)) return i; // seasonings etc. — leave as is
            if (keptSet.has(i) && !isPortionScalable(i as any)) return i; // an amount they stated is what they have
            const nutrients = Object.fromEntries(Object.entries(i.nutrients).map(([k, v]) => [k, (Number(v) || 0) * f])) as typeof i.nutrients;
            return { ...i, grams: r0(i.grams * f), quantity: r0(i.grams * f), unit: "g" as const, calories: i.calories * f, nutrients };
          });
          rescaled = r1(f);
        }
        const n = (k: keyof (typeof ings)[number]["nutrients"]) => r1(sum(ings.map((i) => i.nutrients[k])));
        nutrition = { calories: r0(sum(ings.map((i) => i.calories))), protein_g: n("proteins"), carbs_g: n("carbohydrates"), fat_g: n("fats"), saturatedFat_g: n("saturatedFats"), fiber_g: n("fiber"), sodium_mg: r0(n("sodium")) };
        const nKept = kept.length; // ings = [...kept, ...added], order kept through the rescale map
        ingredients = ings.map((i, idx) => ({ name: i.name, quantity: i.unit === "g" ? `${r0(i.grams)} g` : `${i.quantity} ${i.unit}`.trim(), grams: r0(i.grams), calories: r0(i.calories), ...(idx < nKept ? { kept: true } : {}) }));
        nutrientSource = ings.some((i) => i.nutrientSource === "usda") ? "usda" : "model";
        logText = `${draft.name}: ${ingredients.map((i) => `${i.grams} g ${i.name}`).join(", ")}`;
        groundedIngs = ings;
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
    if (planSlot) fit = `Swap: ${nutrition.calories} kcal vs ${planSlot.calories} planned (${nutrition.calories > planSlot.calories ? "+" : ""}${r0(nutrition.calories - planSlot.calories)})`;

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
      planSlot,
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
        ...(planSlot ? { planSlot: { day: planSlot.day, date: planSlot.date, replaces: planSlot.replaces } } : {}),
        ...(kept.length ? { kept: keptText } : {}),
        // What the card does and what is true — not how long the reply is: that is the prompt's call, over the whole question.
        note:
          (planSlot
            ? "The card shows the portions and a 'Put in plan' button that replaces the planned meal when the user taps it — don't say the plan is changed until they do. Give the new meal with its calories and protein versus the one it replaces, then the alternatives by name."
            : "The card shows the portions and a Log-it button that logs this exact meal with one tap (don't call log_meal yourself). Name the meal with its calories and protein (e.g. '≈ 700 kcal, 70 g protein'), then `fit` as given — it is the verdict on where the day lands, don't soften 'Light'/'over' into 'within target' — then the alternatives by name.") +
          (kept.length ? ` Their ${input.keep!.join(", ")} is in the meal as they said it; say what was added to it and what that adds to the plate.` : ""),
      },
      cards: [{ type: "meal_suggestion", title: planSlot ? `Swap · day ${planSlot.day} ${mealType.toLowerCase()}` : `${mealType.charAt(0) + mealType.slice(1).toLowerCase()} idea`, data }],
      prepared: groundedIngs.length ? preparedMealLog(ctx, subject, { name: draft.name, mealType, ingredients: groundedIngs, description: logText }) : undefined,
    };
  },
});
