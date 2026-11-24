import { reviewTargets } from "../../targets/targets.model";
import moment from "moment-timezone";
import prisma from "../../../utility/prismaClient";
import { BASELINE_NIGHTS, baselineOf, STD_FLOOR } from "../../signals/domain/baseline";
import { buildWeekReview, Range, WeekData, WeekReview } from "../domain/weekReview";
import { buildBuckets, type BucketWeek, type WeekBuckets } from "../domain/weekBuckets";
import { pickStat, WINDOW_DAYS, weekStats, type WeekStat } from "../domain/weekStats";
import { collect } from "../../signals/model/collect";
import { describeFinding } from "../../signals/domain/describe";
import { domainOf } from "../../signals/domain/registry";

/**
 * Reads one ISO week and the one before it, and hands them to the pure
 * builder. Everything is keyed by LOCAL day. `weekStart` is a Monday.
 */

const DAY = "YYYY-MM-DD";
const LB_PER_KG = 2.204_62;

const shift = (day: string, delta: number) => moment.utc(day, DAY).add(delta, "days").format(DAY);

export async function weekReviewFor(patientId: string, weekStart: string, timeZone: string): Promise<WeekReview & { buckets: WeekBuckets }> {
  const from = weekStart;
  const to = shift(from, 6);
  const prevFrom = shift(from, -7);
  const baselineFrom = shift(from, -BASELINE_NIGHTS);
  const since = moment.tz(prevFrom, DAY, timeZone).startOf("day").toDate();
  const until = moment.tz(to, DAY, timeZone).endOf("day").toDate();

  const [vitals, anyNight, dailyFoods, sessions, weightTracker, plan] = await Promise.all([
    prisma.nightlyVitals.findMany({ where: { patientId, date: { gte: baselineFrom, lte: to } }, orderBy: { date: "asc" }, select: { date: true, asleepMinutes: true, hrvMs: true, restingHr: true, sleepingHr: true } }),
    prisma.nightlyVitals.findFirst({ where: { patientId }, select: { id: true } }),
    // DailyFood.date is stored as a longer string that starts with the local day — match by prefix range.
    prisma.dailyFood.findMany({ where: { userId: patientId, date: { gte: prevFrom, lt: shift(to, 1) } }, select: { date: true, foodEntries: { select: { mealType: true, calories: true, proteins: true } } } }),
    prisma.workoutSession.findMany({
      where: { patientId, deletedAt: null, OR: [{ plannedFor: { gte: prevFrom, lte: to } }, { startedAt: { gte: since, lte: until } }] },
      select: {
        startedAt: true, plannedFor: true, status: true, durationSec: true, planId: true, title: true, activityKey: true, calories: true,
        // The weekly summary's strength/cardio split is estimated from these (Nov 22 2026).
        exercises: { select: { exerciseKey: true, sets: { select: { durationSec: true, isWarmup: true } } } },
      },
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
    title: s.title ?? null,
    activityKey: s.activityKey,
    calories: s.calories ?? null,
    parts: s.exercises.map((e) => {
      const work = e.sets.filter((x) => !x.isWarmup);
      return { exerciseKey: e.exerciseKey, workSets: work.length, durationSec: work.reduce((a, x) => a + (x.durationSec ?? 0), 0) };
    }),
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

  // The plan's targets while one is active, else the person's own (Nov 22 2026).
  const targets = plan
    ? {
      calories: range("calories"),
      proteinG: range("protein_g"),
      sleepMinutes: target("sleep_minutes")?.min ?? target("sleep_minutes")?.max ?? null,
      sessionsPerWeek: target("exercise_sessions")?.min ?? target("exercise_sessions")?.max ?? null,
      }
    : await reviewTargets(patientId).catch(() => ({ calories: null, proteinG: null, sleepMinutes: null, sessionsPerWeek: null }));
  // The usual from the nights BEFORE this week — a week is never judged against itself.
  const earlier = vitals.filter((v) => v.date < from);
  const hrvBaseline = baselineOf(earlier.map((v) => v.hrvMs), STD_FLOOR.hrvMs);

  const review = buildWeekReview({ from, to, week: weekOf(from), previous: weekOf(prevFrom), targets, hrvBaseline, hasNights: !!anyNight, weightUnit });

  const bucketWeek = (a: string): BucketWeek => {
    const b = shift(a, 6);
    const inWeek = (date: string) => date >= a && date <= b;
    return {
      days: weekOf(a).days,
      nights: vitals.filter((v) => inWeek(v.date)),
      sessions: rows.filter((r) => inWeek(r.date)),
    };
  };
  const buckets = buildBuckets({
    week: bucketWeek(from),
    previous: bucketWeek(prevFrom),
    targets,
    baselines: { asleepMinutes: baselineOf(earlier.map((v) => v.asleepMinutes), STD_FLOOR.asleepMinutes), hrvMs: hrvBaseline, restingHr: baselineOf(earlier.map((v) => v.restingHr), STD_FLOOR.restingHr), sleepingHr: baselineOf(earlier.map((v) => v.sleepingHr), STD_FLOOR.sleepingHr) },
    hasNights: !!anyNight,
  });
  return { ...review, buckets };
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

/**
 * HABIT FINDINGS FOR THE WEEK (ruling Nov 16 2026): what they did or didn't
 * do — training against the plan, food logging, protein, sleep against its
 * target, weight against the plan's pace — is no longer a note of its own. The
 * detectors still record it; it reaches the person here, as a line in the
 * weekly review. An episode counts for a week it overlapped.
 */
export async function habitFindingsFor(patientId: string, weekStart: string, timeZone: string): Promise<{ title: string; line: string; ongoing: boolean }[]> {
  const start = moment.tz(weekStart, timeZone).startOf("day");
  const end = start.clone().add(7, "days");
  const rows = await prisma.finding.findMany({
    where: {
      patientId,
      firstDetectedAt: { lt: end.toDate() },
      OR: [{ resolvedAt: null }, { resolvedAt: { gte: start.toDate() } }],
    },
    orderBy: { peakSeverity: "desc" },
  });
  return rows
    .filter((r) => domainOf(r.detectorKey) === "habit")
    .slice(0, 3)
    .map((r) => ({ ...describeFinding(r), ongoing: r.status !== "RESOLVED" }));
}
