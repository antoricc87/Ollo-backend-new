import moment from "moment-timezone";
import prisma from "../../../utility/prismaClient";
import { SLOT_SHARE } from "../../meal_plan/model/meal_plan.model";
import type { DailyTargets, MacroRange } from "./generation.tools";

/**
 * What is left of today for ONE meal — the rule suggest_meal and portion_check
 * share, so "what should I eat" and "how much of this" never disagree about
 * the same dinner. The remainder of today's mid target is split, by
 * SLOT_SHARE, between this meal and every OTHER meal still open today: not
 * logged, and not already behind the clock. (Sep 21 2026: it used to count only
 * the slots after this one, so "how much for dinner?" asked at 7 am gave dinner
 * the whole day — breakfast, lunch and the snack were treated as done.)
 */

export type SlotName = keyof typeof SLOT_SHARE;
export const SLOT_ORDER: SlotName[] = ["BREAKFAST", "LUNCH", "SNACK", "DINNER"];

export const slotFor = (tz: string): SlotName => {
  const h = moment().tz(tz).hour();
  if (h < 10) return "BREAKFAST";
  if (h < 14) return "LUNCH";
  if (h < 17) return "SNACK";
  return "DINNER";
};

const r0 = (n: number) => Math.round(n);
const r1 = (n: number) => Math.round(n * 10) / 10;
const sum = (xs: number[]) => xs.reduce((a, b) => a + (Number(b) || 0), 0);
export const mid = ([min, max]: MacroRange) => (min != null && max != null ? (min + max) / 2 : max ?? min ?? null);

export type MealBudget = {
  eatenKcal: number;
  eatenProtein: number;
  /** Mid daily targets, null without one. */
  dayKcal: number | null;
  dayProtein: number | null;
  /** Mid target minus what's logged today (can go negative). */
  kcalLeft: number | null;
  proteinLeft: number | null;
  /** Other meals still open today (not logged, not behind the clock), in day order. */
  slotsOpen: SlotName[];
  /** This slot's share of what's left (0–1). */
  share: number;
};

/**
 * Other meals still to come today: not this one, not logged, and not behind
 * the clock (`nowSlot`). A slot the clock has passed without a log is treated
 * as skipped — reserving for it would starve the meal being asked about.
 */
export const openSlots = (mealType: SlotName, nowSlot: SlotName, logged: Set<string>): SlotName[] =>
  SLOT_ORDER.filter((s) => s !== mealType && !logged.has(s) && SLOT_ORDER.indexOf(s) >= SLOT_ORDER.indexOf(nowSlot));

/** This meal's share of what's left, given the other open meals. */
export const slotShareOf = (mealType: SlotName, open: SlotName[]) => SLOT_SHARE[mealType] / (SLOT_SHARE[mealType] + sum(open.map((s) => SLOT_SHARE[s])) || 1);

export async function mealBudget(subjectId: string, today: string, mealType: SlotName, t: DailyTargets | null, nowSlot: SlotName): Promise<MealBudget> {
  const todayFood = await prisma.dailyFood.findMany({
    where: { userId: subjectId, date: { startsWith: today } },
    include: { foodEntries: { select: { mealType: true, calories: true, proteins: true } } },
  });
  const eaten = todayFood.flatMap((d) => d.foodEntries);
  const eatenKcal = r0(sum(eaten.map((e) => e.calories)));
  const eatenProtein = r1(sum(eaten.map((e) => e.proteins)));
  const dayKcal = t ? mid(t.calories) : null;
  const dayProtein = t ? mid(t.protein_g) : null;
  const slotsOpen = openSlots(mealType, nowSlot, new Set(eaten.map((e) => String(e.mealType ?? ""))));
  return {
    eatenKcal,
    eatenProtein,
    dayKcal,
    dayProtein,
    kcalLeft: dayKcal != null ? r0(dayKcal - eatenKcal) : null,
    proteinLeft: dayProtein != null ? r1(dayProtein - eatenProtein) : null,
    slotsOpen,
    share: slotShareOf(mealType, slotsOpen),
  };
}
