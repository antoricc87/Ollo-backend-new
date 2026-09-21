import { z } from "zod";
import { analyzeMeal } from "../../meal_analysis/mealAnalysis.service";
import { MEAL_TYPES } from "../../meal_analysis/mealAnalysis.schema";
import { planPortion, portionLine } from "../../meal_analysis/portionCheck";
import { defineTool, subjectField } from "./registry";
import { nutritionContext } from "./generation.tools";
import { allergiesIn } from "../../../utils/allergens";
import { mealBudget, slotFor } from "./budget";

/**
 * portion_check — the person has already chosen the food; how much of it?
 * The food is grounded exactly as they said it (analyzeMeal / USDA, the same
 * numbers a log would get), then ONE portion is decided in code
 * (meal_analysis/portionCheck.ts) against what's left of today for this meal
 * (budget.ts, shared with suggest_meal). Never swaps the dish, never offers
 * alternatives. Nothing is persisted; the card carries a Log-it hand-off.
 */

export const portionCheck = defineTool({
  name: "portion_check",
  description:
    "How much to eat of a food the user has ALREADY chosen: 'I'm having pasta with sausage for dinner — how much should I eat?', 'how much of this 400 g pizza can I have?', 'can I finish this?'. Keeps their food exactly as they said it (no substitutes, no alternatives), grounds the nutrition, and sizes the portion to what's left of today for that meal — a fraction of what they have when they said the amount, otherwise a plate compared with a normal one. Returns a card with the portion in their units and a Log-it button. For 'what should I eat' (nothing chosen yet) use suggest_meal instead.",
  schema: z.object({
    food: z.string().min(2).max(400).describe("The food in the user's words, verbatim, including any amount they have ('a 400 g frozen pizza', 'the 500 g box of penne', 'pasta with sausage and cream')"),
    mealType: z.enum(MEAL_TYPES).optional().describe("The meal they named — 'for dinner' → DINNER, 'lunch' → LUNCH. Omit only when they named none (the time of day decides)."),
    subjectId: subjectField,
  }),
  risk: "generate",
  async run(ctx, input) {
    const subject = await ctx.resolveSubject(input.subjectId);
    // The model sometimes drops the meal they named; their words still carry it.
    const named = /\b(breakfast|lunch|dinner|supper|snack)\b/i.exec(input.food)?.[1]?.toUpperCase().replace("SUPPER", "DINNER") as (typeof MEAL_TYPES)[number] | undefined;
    const nowSlot = slotFor(ctx.timeZone);
    const mealType = input.mealType ?? named ?? nowSlot;
    const context = await nutritionContext(ctx.patientId, subject.id);
    const t = context.dailyTargets;
    const [budget, analysis] = await Promise.all([
      mealBudget(subject.id, ctx.today, mealType, t, nowSlot),
      analyzeMeal({ text: input.food, mealTypeHint: mealType, todayLocal: ctx.today }, { patientId: subject.id }),
    ]);
    const ings = analysis.meals.flatMap((m) => m.ingredients);
    if (!ings.length) return { result: { error: "I couldn't read a food in that. Ask what they're having, in a few words." } };

    const aimKcal = budget.kcalLeft != null ? Math.round(budget.kcalLeft * budget.share) : null;
    const plan = planPortion(ings, aimKcal, mealType === "SNACK" ? 100 : 300);
    const line = portionLine(plan, { eatenKcal: budget.eatenKcal, kcalLeft: budget.kcalLeft, aimKcal, range: t?.calories ?? null, laterSlots: budget.slotsOpen });
    const protein =
      budget.proteinLeft != null && plan.totals.calories > 0 ? `${Math.round(plan.totals.protein_g)} g protein of the ${Math.max(0, Math.round(budget.proteinLeft))} g left today` : null;
    const allergies = allergiesIn([...analysis.meals.map((m) => m.mealName), ...ings.flatMap((i) => [i.name, i.searchTerm ?? ""])], context.foodAllergies);
    const name = analysis.meals.map((m) => m.mealName).join(" + ");
    const logText = plan.totals.calories > 0 ? `${name}: ${plan.ingredients.filter((i) => i.grams > 0).map((i) => `${i.grams} g ${i.name}`).join(", ")}` : null;

    const data = {
      subject: subject.name,
      subjectId: subject.isSelf ? null : subject.id,
      mealType,
      name,
      mode: plan.mode,
      verdict: plan.verdict,
      headline: plan.headline,
      ingredients: plan.ingredients,
      ...plan.totals,
      normalKcal: plan.normalKcal,
      line,
      protein,
      allergies,
      budget: { eatenKcal: budget.eatenKcal, kcalLeft: budget.kcalLeft, aimKcal, targetsFrom: context.targetsFrom },
      logText,
    };
    return {
      result: {
        food: name,
        mealType,
        portion: plan.headline,
        amounts: plan.ingredients.map((i) => `${i.amount} ${i.name}${i.onHand && i.onHand !== i.amount ? ` (of ${i.onHand})` : ""}`),
        calories: plan.totals.calories,
        protein_g: plan.totals.protein_g,
        line,
        ...(allergies.length ? { allergyOnRecord: allergies } : {}),
        note:
          (allergies.length ? `It appears to contain ${allergies.join(", ")}, which is on their allergy list — say that FIRST, plainly, before any amount. ` : "") +
          "The card shows the portion and a Log-it button (they tap it; don't call log_meal yourself). Keep your text to 2–3 lines: the portion in their own terms (`portion` + the amounts), its calories and protein, then `line` as given — it's the fact about their day, don't soften or scold. Don't suggest or offer a different or lighter food, a swap or alternatives unless they ask.",
      },
      cards: [{ type: "portion_check", title: `How much · ${mealType.toLowerCase()}`, data }],
    };
  },
});
