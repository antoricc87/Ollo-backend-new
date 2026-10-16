import moment from "moment-timezone";
import prisma from "../../../utility/prismaClient";
import { BASELINE_NIGHTS, baselineOf, STD_FLOOR } from "../../signals/domain/baseline";
import { buildWeekReview, Range, WeekData, WeekReview } from "../domain/weekReview";
import { pickStat, WINDOW_DAYS, weekStats, type WeekStat } from "../domain/weekStats";
import { collect } from "../../signals/model/collect";

/**
 * Reads one ISO week and the one before it, and hands them to the pure
 * builder. Everything is keyed by LOCAL day. `weekStart` is a Monday.
 */

const DAY = "YYYY-MM-DD";
const LB_PER_KG = 2.204_62;

const shift = (day: string, delta: number) => moment.utc(day, DAY).add(delta, "days").format(DAY);

export async function weekReviewFor(patientId: string, weekStart: string, timeZone: string): Promise<WeekReview> {
  const from = weekStart;
  const to = shift(from, 6);
  const prevFrom = shift(from, -7);
  const baselineFrom = shift(from, -BASELINE_NIGHTS);
  const since = moment.tz(prevFrom, DAY, timeZone).startOf("day").toDate();
  const until = moment.tz(to, DAY, timeZone).endOf("day").toDate();

  const [vitals, anyNight, dailyFoods, sessions, weightTracker, plan] = await Promise.all([
    prisma.nightlyVitals.findMany({ where: { patientId, date: { gte: baselineFrom, lte: to } }, orderBy: { date: "asc" }, select: { date: true, asleepMinutes: true, hrvMs: true } }),
    prisma.nightlyVitals.findFirst({ where: { patientId }, select: { id: true } }),
    // DailyFood.date is stored as a longer string that starts with the local day — match by prefix range.
    prisma.dailyFood.findMany({ where: { userId: patientId, date: { gte: prevFrom, lt: shift(to, 1) } }, select: { date: true, foodEntries: { select: { mealType: true, calories: true, proteins: true } } } }),
    prisma.workoutSession.findMany({
      where: { patientId, deletedAt: null, OR: [{ plannedFor: { gte: prevFrom, lte: to } }, { startedAt: { gte: since, lte: until } }] },
      select: { startedAt: true, plannedFor: true, status: true, durationSec: true, planId: true },
    }),
    prisma.weightTracker.findUnique({ where: { userId: patientId }, include: { weightEntries: true } }).catch(() => null),
    prisma.healthPlan.findFirst({ where: { patientId, status: "ACTIVE" }, include: { targets: true }, orderBy: { createdAt: "desc" } }),
  ]);

  const foodByDay = new Map<string, { mealType: string | null; calories: number | null; proteins: number | null }[]>();
  for (const d of dailyFoods) foodByDay.set(d.date.slice(0, 10), [...(foodByDay.get(d.date.slice(0, 10)) ?? []), ...d.foodEntries]);

  const entries = (weightTracker?.weightEntries ?? [])
    .map((e) => ({ at: moment(e.createdAt), weight: e.weight, lb: (e.unit ?? "").toLowerCase().startsWith("lb") }))
    .filter((e) => e.at.isValid())
    .sort((a, b) => a.at.valueOf() - b.at.valueOf());
  // Shown in the unit they last weighed in with.
  const weightUnit: "kg" | "lb" = entries.length && !entries[entries.length - 1].lb ? "kg" : "lb";
  const weights = entries.map((e) => ({
    date: e.at.tz(timeZone).format(DAY),
    value: e.lb === (weightUnit === "lb") ? e.weight : weightUnit === "lb" ? e.weight * LB_PER_KG : e.weight / LB_PER_KG,
  }));

  const rows = sessions.map((s) => ({
    // A planned session owns its local day in plannedFor; a watch or described one has only its start.
    date: s.plannedFor ?? moment(s.startedAt).tz(timeZone).format(DAY),
    done: s.status === "COMPLETED",
    planned: !!s.planId || s.status !== "COMPLETED",
    minutes: s.durationSec ? Math.round(s.durationSec / 60) : null,
  }));

  const weekOf = (a: string): WeekData => {
    const b = shift(a, 6);
    const inWeek = (date: string) => date >= a && date <= b;
    return {
      days: Array.from({ length: 7 }, (_, i) => {
        const date = shift(a, i);
        const meals = foodByDay.get(date) ?? [];
        return {
          date,
          mealTypes: meals.map((m) => m.mealType ?? null),
          calories: meals.reduce((acc, m) => acc + (m.calories ?? 0), 0),
          proteinG: meals.reduce((acc, m) => acc + (m.proteins ?? 0), 0),
        };
      }),
      nights: vitals.filter((v) => inWeek(v.date)),
      sessions: rows.filter((r) => r.done && inWeek(r.date)).map((r) => ({ date: r.date, minutes: r.minutes })),
      planned: rows.filter((r) => r.planned && inWeek(r.date)).length,
      weights: weights.filter((w) => inWeek(w.date)),
    };
  };

  const target = (metricKey: string) => plan?.targets.find((t) => t.metricKey === metricKey) ?? null;
  const range = (metricKey: string): Range | null => {
    const t = target(metricKey);
    return t && (t.min !== null || t.max !== null) ? { min: t.min, max: t.max } : null;
  };

  return buildWeekReview({
    from,
    to,
    week: weekOf(from),
    previous: weekOf(prevFrom),
    targets: {
      calories: range("calories"),
      proteinG: range("protein_g"),
      sleepMinutes: target("sleep_minutes")?.min ?? target("sleep_minutes")?.max ?? null,
      sessionsPerWeek: target("exercise_sessions")?.min ?? target("exercise_sessions")?.max ?? null,
    },
    // The usual from the nights BEFORE this week — a week is never judged against itself.
    hrvBaseline: baselineOf(vitals.filter((v) => v.date < from).map((v) => v.hrvMs), STD_FLOOR.hrvMs),
    hasNights: !!anyNight,
    weightUnit,
  });
}

/**
 * The one number worth knowing (review/domain/weekStats.ts) for the four
 * weeks ending `weekEnd`, never last week's again. Remembered in
 * AgentPreference.taskRuns.week_stat as "<weekStart>|<key>": asked twice in
 * the same week it gives the same answer; next week it moves on.
 */
export async function weekStatFor(patientId: string, weekStart: string, timeZone: string): Promise<WeekStat | null> {
  const weekEnd = shift(weekStart, 6);
  const input = await collect(patientId, weekEnd, timeZone, WINDOW_DAYS + 7);
  const pref = await prisma.agentPreference.findUnique({ where: { patientId }, select: { taskRuns: true } });
  const runs = (pref?.taskRuns ?? {}) as Record<string, string>;
  const [week, key] = (runs.week_stat ?? "").split("|");
  const stats = weekStats({ nights: input.nights, days: input.days, workouts: input.workouts, from: shift(weekEnd, -(WINDOW_DAYS - 1)), to: weekEnd });
  const picked = week === weekStart ? (stats.find((s) => s.key === key) ?? null) : pickStat(stats, key || null);
  if (picked && week !== weekStart) {
    const next = { ...runs, week_stat: `${weekStart}|${picked.key}` };
    await prisma.agentPreference.upsert({ where: { patientId }, create: { patientId, taskRuns: next }, update: { taskRuns: next } });
  }
  return picked;
}
