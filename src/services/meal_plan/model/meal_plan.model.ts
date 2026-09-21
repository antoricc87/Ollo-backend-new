import prisma from "../../../utility/prismaClient";
import { dayKey, safeTz } from "../../agent/memory/dates";

/**
 * Saved meal plans. The generator (Ollie's generate_meal_plan) never persists;
 * saving is the user's explicit act — from the card, the plan screen, or by
 * confirming Ollie's save_meal_plan proposal. One ACTIVE plan per patient.
 *
 * "Logged" is derived, never stored: a plan meal counts as logged when a
 * FoodEntry exists on that calendar day in the same slot. `matched` says
 * whether that entry looks like the planned meal (name overlap), so the
 * screen can tell "ate the plan" from "ate something else".
 */

export const MEAL_TYPES = ["BREAKFAST", "LUNCH", "DINNER", "SNACK"] as const;
export type MealTypeName = (typeof MEAL_TYPES)[number];

/* ------------------------------- coverage ------------------------------- */

/**
 * A plan can cover only some slots ("just dinners"). It is then judged
 * against that slot's share of the day, never the whole-day target, and says
 * so in one factual line. Shares match suggest_meal's SLOT_SHARE.
 */
export const SLOT_SHARE: Record<MealTypeName, number> = { BREAKFAST: 0.25, LUNCH: 0.35, DINNER: 0.35, SNACK: 0.1 };
const SLOT_PLURAL: Record<MealTypeName, string> = { BREAKFAST: "breakfasts", LUNCH: "lunches", DINNER: "dinners", SNACK: "snacks" };

type Range = [number | null | undefined, number | null | undefined];
export type Coverage = {
  slots: MealTypeName[];
  /** Share of the day's targets the covered slots are sized to (0–1). */
  share: number;
  /** "Dinners only" */
  label: string;
  /** Whole-day calorie range the share was taken from, when there is one. */
  dayCalories: Range | null;
  /** The card / screen / Ollie line — option (c), Sep 21 2026. */
  line: string;
};

/**
 * Normalise requested slots: known, deduped, in day order. Breakfast + lunch
 * + dinner (with or without a snack) is a whole day → [] (full-day plan).
 */
export const normalizeSlots = (raw: unknown): MealTypeName[] => {
  const want = new Set((Array.isArray(raw) ? raw : []).map((x) => String(x ?? "").toUpperCase()));
  const slots = MEAL_TYPES.filter((t) => want.has(t));
  const main = ["BREAKFAST", "LUNCH", "DINNER"].every((t) => want.has(t));
  return main ? [] : slots;
};

const listText = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** Coverage of a partial plan, or null for a whole-day plan. `dayTargets` = the unscaled daily targets. */
export const coverageOf = (slots: MealTypeName[], dayCalories: Range | null): Coverage | null => {
  if (!slots.length) return null;
  const share = Math.min(1, slots.reduce((a, t) => a + SLOT_SHARE[t], 0));
  const names = listText(slots.map((t) => SLOT_PLURAL[t]));
  const label = `${names.charAt(0).toUpperCase()}${names.slice(1)} only`;
  const pct = Math.round(share * 100);
  const [min, max] = dayCalories ?? [null, null];
  const r = (n: number) => Math.round(n / 10) * 10;
  const kcal =
    min != null && max != null ? ` (about ${r(min * share)}–${r(max * share)} of your ${min}–${max} kcal)` : min != null || max != null ? ` (about ${r((min ?? max)! * share)} of ${(min ?? max)} kcal)` : "";
  return { slots, share, label, dayCalories: dayCalories ?? null, line: `${label} — sized to about ${pct}% of your daily targets${kcal}. The rest of the day is up to you.` };
};

/** Scale a whole-day range to the covered share. Open ends stay open. */
export const scaleRange = ([min, max]: Range, share: number): [number | null, number | null] => [
  min != null ? Math.round(min * share) : null,
  max != null ? Math.round(max * share) : null,
];

export type MealPlanMealInput = {
  mealType: MealTypeName;
  name: string;
  description?: string | null;
  ingredients: string[];
  calories: number;
  proteins: number;
  carbohydrates: number;
  fats: number;
  prepMinutes?: number | null;
};

export type MealPlanInput = {
  title: string;
  notes?: string | null;
  startDate?: string | null; // YYYY-MM-DD; default today in the patient's tz
  /** Covered slots; [] = the whole day. */
  slots: MealTypeName[];
  days: { day: number; meals: MealPlanMealInput[] }[];
  targets?: unknown;
  fit?: unknown;
  subjectId?: string | null;
  source?: string | null;
};

export type LoggedSlot = { description: string; calories: number; matched: boolean } | null;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const num = (v: unknown, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const clean = (s: unknown, max: number) => String(s ?? "").trim().slice(0, max);

export const shiftDay = (day: string, delta: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
};

/** Validate + normalise a plan body coming from the app or a card. Throws on junk. */
export const normalizeMealPlanInput = (raw: any): MealPlanInput => {
  const title = clean(raw?.title, 120) || "Meal plan";
  const days = Array.isArray(raw?.days) ? raw.days : [];
  if (!days.length || days.length > 7) throw new Error("a plan needs 1–7 days");
  const out: MealPlanInput["days"] = days.map((d: any, i: number) => {
    const meals = Array.isArray(d?.meals) ? d.meals : [];
    if (!meals.length) throw new Error(`day ${i + 1} has no meals`);
    return {
      day: i + 1,
      meals: meals.slice(0, 6).map((m: any): MealPlanMealInput => {
        const mealType = String(m?.mealType ?? "").toUpperCase() as MealTypeName;
        if (!MEAL_TYPES.includes(mealType)) throw new Error(`day ${i + 1}: unknown meal type ${m?.mealType}`);
        const name = clean(m?.name, 160);
        if (!name) throw new Error(`day ${i + 1}: a meal has no name`);
        return {
          mealType,
          name,
          description: clean(m?.description, 400) || null,
          ingredients: (Array.isArray(m?.ingredients) ? m.ingredients : []).map((x: unknown) => clean(x, 160)).filter(Boolean).slice(0, 30),
          calories: Math.round(num(m?.calories)),
          proteins: num(m?.proteins ?? m?.protein_g),
          carbohydrates: num(m?.carbohydrates ?? m?.carbs_g),
          fats: num(m?.fats ?? m?.fat_g),
          prepMinutes: m?.prepMinutes != null ? Math.round(num(m.prepMinutes)) : null,
        };
      }),
    };
  });
  const startDate = typeof raw?.startDate === "string" && DAY_RE.test(raw.startDate) ? raw.startDate : null;
  const slots = normalizeSlots(raw?.slots);
  return {
    title,
    notes: clean(raw?.notes, 600) || null,
    startDate,
    slots,
    days: out,
    targets: raw?.targets ?? null,
    fit: raw?.fit ?? null,
    subjectId: typeof raw?.subjectId === "string" && raw.subjectId ? raw.subjectId : null,
    source: clean(raw?.source, 40) || "ollie",
  };
};

const planInclude = { meals: { orderBy: [{ day: "asc" as const }, { position: "asc" as const }] } };
type PlanWithMeals = NonNullable<Awaited<ReturnType<typeof findActive>>>;

const findActive = (patientId: string) =>
  prisma.mealPlan.findFirst({ where: { patientId, status: "ACTIVE" }, include: planInclude, orderBy: { createdAt: "desc" } });

/** Words that make a name match; short/common ones are ignored. */
const STOP = new Set(["with", "and", "the", "on", "in", "of", "a", "an", "salad", "bowl", "plate", "side", "style", "fresh", "mixed"]);
const tokens = (s: string) => s.toLowerCase().split(/[^a-zà-ÿ]+/).filter((w) => w.length > 2 && !STOP.has(w));
/** Does a logged description look like the planned meal? ≥ half of the plan's distinctive words appear. */
export const looksLike = (planName: string, logged: string) => {
  const want = tokens(planName);
  if (!want.length) return false;
  const have = new Set(tokens(logged));
  const hits = want.filter((w) => have.has(w)).length;
  return hits >= Math.max(1, Math.ceil(want.length / 2));
};

/** FoodEntry rows per local day and slot for a user, over [from, to]. */
const loggedByDay = async (userId: string, from: string, to: string) => {
  const rows = await prisma.dailyFood.findMany({
    where: { userId, date: { gte: from, lt: shiftDay(to, 1) } },
    select: { date: true, foodEntries: { select: { mealType: true, description: true, calories: true } } },
  });
  const out: Record<string, { mealType: string | null; description: string; calories: number }[]> = {};
  for (const r of rows) (out[r.date.slice(0, 10)] ??= []).push(...r.foodEntries);
  return out;
};

export type MealPlanView = {
  id: string;
  title: string;
  notes: string | null;
  startDate: string;
  endDate: string;
  days: number;
  /** Covered slots; [] = the whole day. */
  slots: MealTypeName[];
  /** Non-null for a partial plan: what share of the day it is sized to, and the line to show. */
  coverage: Coverage | null;
  status: string;
  targets: unknown;
  fit: unknown;
  subjectId: string | null;
  createdAt: Date;
  today: string;
  /** 1-based day index for today, or null when today is outside the plan. */
  todayIndex: number | null;
  daysOut: { day: number; date: string; meals: (PlanWithMeals["meals"][number] & { logged: LoggedSlot })[]; totals: { calories: number; proteins: number; carbohydrates: number; fats: number } }[];
};

class MealPlanService {
  private async tzOf(patientId: string) {
    const p = await prisma.patient.findUnique({ where: { id: patientId }, select: { timeZone: true } });
    return safeTz(p?.timeZone);
  }

  /** The active plan with per-meal logged state, or null. */
  async getActive(patientId: string): Promise<MealPlanView | null> {
    const plan = await findActive(patientId);
    if (!plan) return null;
    return this.view(patientId, plan);
  }

  async view(patientId: string, plan: PlanWithMeals): Promise<MealPlanView> {
    const tz = await this.tzOf(patientId);
    const today = dayKey(tz);
    const endDate = shiftDay(plan.startDate, plan.days - 1);
    const logged = await loggedByDay(plan.subjectId ?? patientId, plan.startDate, endDate);
    const daysOut: MealPlanView["daysOut"] = [];
    for (let day = 1; day <= plan.days; day++) {
      const date = shiftDay(plan.startDate, day - 1);
      const entries = logged[date] ?? [];
      const meals = plan.meals
        .filter((m) => m.day === day)
        .map((m) => {
          const slot = entries.filter((e) => (e.mealType ?? "").toUpperCase() === m.mealType);
          const exact = slot.find((e) => looksLike(m.name, e.description));
          const first = exact ?? slot[0];
          const loggedSlot: LoggedSlot = first ? { description: first.description, calories: Math.round(slot.reduce((a, e) => a + (e.calories || 0), 0)), matched: !!exact } : null;
          return { ...m, logged: loggedSlot };
        });
      const totals = {
        calories: meals.reduce((a, m) => a + m.calories, 0),
        proteins: Math.round(meals.reduce((a, m) => a + m.proteins, 0) * 10) / 10,
        carbohydrates: Math.round(meals.reduce((a, m) => a + m.carbohydrates, 0) * 10) / 10,
        fats: Math.round(meals.reduce((a, m) => a + m.fats, 0) * 10) / 10,
      };
      daysOut.push({ day, date, meals, totals });
    }
    const idx = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${plan.startDate}T00:00:00Z`)) / 86_400_000) + 1;
    return {
      id: plan.id,
      title: plan.title,
      notes: plan.notes,
      startDate: plan.startDate,
      endDate,
      days: plan.days,
      slots: (plan.slots ?? []) as MealTypeName[],
      coverage: ((plan.fit as any)?.coverage as Coverage | undefined) ?? coverageOf((plan.slots ?? []) as MealTypeName[], null),
      status: plan.status,
      targets: plan.targets,
      fit: plan.fit,
      subjectId: plan.subjectId,
      createdAt: plan.createdAt,
      today,
      todayIndex: idx >= 1 && idx <= plan.days ? idx : null,
      daysOut,
    };
  }

  /** Save a plan; the previous ACTIVE one becomes REPLACED. */
  async create(patientId: string, input: MealPlanInput) {
    const tz = await this.tzOf(patientId);
    const startDate = input.startDate ?? dayKey(tz);
    const plan = await prisma.$transaction(async (tx) => {
      await tx.mealPlan.updateMany({ where: { patientId, status: "ACTIVE" }, data: { status: "REPLACED" } });
      return tx.mealPlan.create({
        data: {
          patientId,
          subjectId: input.subjectId ?? null,
          title: input.title,
          notes: input.notes ?? null,
          startDate,
          days: input.days.length,
          slots: input.slots ?? [],
          targets: (input.targets ?? undefined) as any,
          fit: (input.fit ?? undefined) as any,
          source: input.source ?? "ollie",
          meals: {
            create: input.days.flatMap((d) =>
              d.meals.map((m, position) => ({
                day: d.day,
                position,
                mealType: m.mealType,
                name: m.name,
                description: m.description ?? null,
                ingredients: m.ingredients,
                calories: m.calories,
                proteins: m.proteins,
                carbohydrates: m.carbohydrates,
                fats: m.fats,
                prepMinutes: m.prepMinutes ?? null,
              }))
            ),
          },
        },
        include: planInclude,
      });
    });
    return this.view(patientId, plan);
  }

  /** Replace one meal (a swap). Keeps day/slot/position; stamps swappedAt. */
  async replaceMeal(patientId: string, planId: string, mealId: string, meal: Omit<MealPlanMealInput, "mealType"> & { mealType?: MealTypeName }) {
    const plan = await prisma.mealPlan.findFirst({ where: { id: planId, patientId }, include: planInclude });
    if (!plan) return null;
    const existing = plan.meals.find((m) => m.id === mealId);
    if (!existing) return null;
    await prisma.mealPlanMeal.update({
      where: { id: mealId },
      data: {
        name: meal.name,
        description: meal.description ?? null,
        ingredients: meal.ingredients,
        calories: Math.round(meal.calories),
        proteins: meal.proteins,
        carbohydrates: meal.carbohydrates,
        fats: meal.fats,
        prepMinutes: meal.prepMinutes ?? null,
        ...(meal.mealType ? { mealType: meal.mealType } : {}),
        swappedAt: new Date(),
      },
    });
    const fresh = await prisma.mealPlan.findUnique({ where: { id: planId }, include: planInclude });
    return fresh ? this.view(patientId, fresh) : null;
  }

  async updateStatus(patientId: string, planId: string, status: "ACTIVE" | "COMPLETED" | "REPLACED" | "PAUSED") {
    const plan = await prisma.mealPlan.findFirst({ where: { id: planId, patientId } });
    if (!plan) return null;
    if (status === "ACTIVE") await prisma.mealPlan.updateMany({ where: { patientId, status: "ACTIVE", id: { not: planId } }, data: { status: "REPLACED" } });
    const updated = await prisma.mealPlan.update({ where: { id: planId }, data: { status }, include: planInclude });
    return this.view(patientId, updated);
  }

  /** Compact shape for the agent snapshot: today's (and tomorrow's) planned meals. */
  async forSnapshot(patientId: string, today: string) {
    const plan = await findActive(patientId);
    if (!plan || plan.subjectId) return null;
    const endDate = shiftDay(plan.startDate, plan.days - 1);
    const idx = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${plan.startDate}T00:00:00Z`)) / 86_400_000) + 1;
    const dayMeals = (day: number) => plan.meals.filter((m) => m.day === day).map((m) => ({ id: m.id, mealType: m.mealType, name: m.name, calories: m.calories, proteins: m.proteins, ingredients: m.ingredients }));
    return {
      id: plan.id,
      title: plan.title,
      startDate: plan.startDate,
      endDate,
      days: plan.days,
      slots: (plan.slots ?? []) as MealTypeName[],
      todayIndex: idx >= 1 && idx <= plan.days ? idx : null,
      ended: idx > plan.days,
      notStarted: idx < 1,
      today: idx >= 1 && idx <= plan.days ? dayMeals(idx) : [],
      tomorrow: idx + 1 >= 1 && idx + 1 <= plan.days ? dayMeals(idx + 1) : [],
    };
  }
}

export default new MealPlanService();
