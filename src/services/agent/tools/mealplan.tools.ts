import { z } from "zod";
import prisma from "../../../utility/prismaClient";
import MealPlanService, { normalizeMealPlanInput, type MealPlanInput, type MealPlanView } from "../../meal_plan/model/meal_plan.model";
import { dayString, defineTool, shiftDay } from "./registry";
import type { Card } from "./registry";

/**
 * Saved meal plans in the agent.
 *  - generate_meal_plan (generation.tools) stays a pure draft: it registers
 *    the draft here under a `draftId` the card carries.
 *  - save_meal_plan is a confirm-gated write: proposal → the user confirms →
 *    MealPlanService.create (same path the card's "Save" button uses).
 *  - get_meal_plan reads the active plan with derived logged state.
 */

/* ------------------------------- drafts -------------------------------- */

type Draft = { plan: MealPlanInput; card: unknown; at: number };
const drafts = new Map<string, Draft>();
const DRAFT_TTL_MS = 6 * 60 * 60 * 1000;

export const registerDraft = (draftId: string, plan: MealPlanInput, card: unknown) => {
  for (const [k, v] of drafts) if (Date.now() - v.at > DRAFT_TTL_MS) drafts.delete(k);
  drafts.set(draftId, { plan, card, at: Date.now() });
};

/** A generated meal_plan card → plan input (the card's data is the generator's full result). */
export const planInputFromCard = (data: any): MealPlanInput =>
  normalizeMealPlanInput({
    title: data?.title,
    notes: data?.notes,
    days: (data?.days ?? []).map((d: any) => ({ meals: (d.meals ?? []).map((m: any) => ({ mealType: m.mealType, name: m.name, description: m.description, ingredients: m.ingredients, calories: m.calories, protein_g: m.protein_g, carbs_g: m.carbs_g, fat_g: m.fat_g, prepMinutes: m.prepMinutes })) })),
    targets: data?.targets ?? null,
    fit: data?.fit ?? null,
    subjectId: data?.subjectId ?? null,
    source: "ollie",
  });

/** Find the draft: memory first, then the thread's stored assistant cards (latest first). */
const findDraft = async (threadId: string | null, draftId?: string | null): Promise<{ draftId: string; plan: MealPlanInput } | null> => {
  if (draftId && drafts.has(draftId)) return { draftId, plan: drafts.get(draftId)!.plan };
  if (!draftId) {
    // newest in-memory draft for this process
    const newest = [...drafts.entries()].sort((a, b) => b[1].at - a[1].at)[0];
    if (newest && Date.now() - newest[1].at < 30 * 60 * 1000 && !threadId) return { draftId: newest[0], plan: newest[1].plan };
  }
  if (!threadId) return null;
  const rows = await prisma.agentMessage.findMany({ where: { threadId, role: "ASSISTANT" }, orderBy: { seq: "desc" }, take: 40, select: { cards: true } });
  for (const r of rows) {
    const cards = Array.isArray(r.cards) ? (r.cards as any[]) : [];
    for (const c of [...cards].reverse()) {
      if (c?.type !== "meal_plan" || c?.data?.saved) continue;
      if (draftId && c?.data?.draftId !== draftId) continue;
      try {
        return { draftId: c.data?.draftId ?? "card", plan: planInputFromCard(c.data) };
      } catch {
        /* malformed card — keep looking */
      }
    }
  }
  return null;
};

/* ------------------------------- view → card ------------------------------- */

/** The saved plan as the same `meal_plan` card the generator emits, plus `saved`. */
export const savedPlanCard = (v: MealPlanView): Card => ({
  type: "meal_plan",
  title: v.title,
  data: {
    title: v.title,
    notes: v.notes,
    targets: v.targets,
    fit: v.fit,
    saved: { id: v.id, startDate: v.startDate, endDate: v.endDate, todayIndex: v.todayIndex, status: v.status },
    days: v.daysOut.map((d) => ({
      day: d.day,
      date: d.date,
      totals: { calories: d.totals.calories, protein_g: d.totals.proteins, carbs_g: d.totals.carbohydrates, fat_g: d.totals.fats },
      meals: d.meals.map((m) => ({ id: m.id, mealType: m.mealType, name: m.name, description: m.description, ingredients: m.ingredients, calories: m.calories, protein_g: m.proteins, carbs_g: m.carbohydrates, fat_g: m.fats, prepMinutes: m.prepMinutes, logged: m.logged })),
    })),
  },
});

const compactView = (v: MealPlanView) => ({
  id: v.id,
  title: v.title,
  startDate: v.startDate,
  endDate: v.endDate,
  todayIndex: v.todayIndex,
  days: v.daysOut.map((d) => ({
    day: d.day,
    date: d.date,
    totals: { calories: d.totals.calories, protein_g: d.totals.proteins },
    meals: d.meals.map((m) => `${m.mealType.toLowerCase()}: ${m.name} (${m.calories} kcal, ${Math.round(m.proteins)} g protein)${m.logged ? (m.logged.matched ? " — logged" : ` — logged something else: ${m.logged.description.slice(0, 40)}`) : ""}`),
  })),
});

/* -------------------------------- tools -------------------------------- */

export const getMealPlan = defineTool({
  name: "get_meal_plan",
  description: "The user's saved meal plan (day-by-day meals with dates, and which slots are already logged). The snapshot only carries today and tomorrow; call this for other days or the whole week. Returns a card.",
  schema: z.object({}),
  risk: "read",
  async run(ctx) {
    const v = await MealPlanService.getActive(ctx.patientId);
    if (!v) return { result: { plan: null, note: "No saved meal plan. Offer to make one with generate_meal_plan; the card has a Save button." } };
    return { result: { plan: compactView(v), note: "The card renders the plan with per-meal Log / Recipe / Swap actions and an 'Open plan' link." }, cards: [savedPlanCard(v)] };
  },
});

export const saveMealPlan = defineTool({
  name: "save_meal_plan",
  description:
    "Save the meal plan you generated in this conversation as the user's plan for the coming days (one active plan; replaces the previous one). Call it when the user asks to save/keep/use the plan. Pass the draftId from the generate_meal_plan result when you have it. Returns a PREVIEW the user confirms in the app before anything is saved.",
  schema: z.object({
    draftId: z.string().optional().describe("From the generate_meal_plan result. Omit to save the latest plan in this conversation."),
    startDate: dayString.optional().describe("Day 1 of the plan. Default: today. Use tomorrow when the user says 'from tomorrow' / 'next week'."),
  }),
  risk: "write",
  async run(ctx, input) {
    if (input.startDate && input.startDate < shiftDay(ctx.today, -1)) return { result: { error: "A meal plan can't start in the past — use today or a later day." } };
    const draft = await findDraft(ctx.threadId, input.draftId);
    if (!draft) return { result: { error: "I don't have a meal plan draft in this conversation to save. Generate one first (generate_meal_plan), then save it." } };
    if (draft.plan.subjectId) return { result: { error: "Plans for family members can't be saved yet — only the user's own plan." } };
    const startDate = input.startDate ?? ctx.today;
    const existing = await MealPlanService.getActive(ctx.patientId);
    const plan: MealPlanInput = { ...draft.plan, startDate };
    const endDate = shiftDay(startDate, plan.days.length - 1);
    const preview = {
      title: plan.title,
      startDate,
      endDate,
      days: plan.days.length,
      mealsPerDay: Math.round(plan.days.reduce((a, d) => a + d.meals.length, 0) / plan.days.length),
      firstDay: plan.days[0].meals.map((m) => `${m.mealType.toLowerCase()}: ${m.name}`),
      replaces: existing ? { id: existing.id, title: existing.title, startDate: existing.startDate } : null,
      plan,
    };
    return {
      result: { previewOf: { title: plan.title, startDate, endDate, days: plan.days.length, replaces: preview.replaces?.title ?? null } },
      proposal: { title: "Save meal plan", summary: `"${plan.title}" · ${plan.days.length} day${plan.days.length === 1 ? "" : "s"} from ${startDate}${existing ? ` (replaces "${existing.title}")` : ""}`, preview },
    };
  },
  async commit(ctx, _input, preview) {
    const p = preview as { plan: MealPlanInput; startDate: string };
    const v = await MealPlanService.create(ctx.patientId, { ...p.plan, startDate: p.startDate });
    return {
      result: { saved: true, id: v.id, title: v.title, startDate: v.startDate, endDate: v.endDate, days: v.days },
      cards: [{ type: "meal_plan_saved", title: "Meal plan saved", data: { id: v.id, title: v.title, startDate: v.startDate, endDate: v.endDate, days: v.days } }],
    };
  },
});
