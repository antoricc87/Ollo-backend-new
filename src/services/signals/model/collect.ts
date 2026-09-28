import moment from "moment-timezone";
import prisma from "../../../utility/prismaClient";
import { NightRow } from "../domain/baseline";
import { DayRow, PlanTargets, SignalInput, WorkoutRow } from "../domain/types";

/**
 * One read of everything the detectors need, so nine detectors do not make
 * nine round trips. Everything comes back keyed by LOCAL day — the whole
 * design is "three nights running", which is meaningless in UTC for anyone
 * who is not in London.
 */

const dayKey = (at: Date | string, tz: string) => moment(at).tz(tz).format("YYYY-MM-DD");

/** How far back the detectors can look: 60 baseline nights plus a month of room. */
export const LOOKBACK_DAYS = 95;

export const planTargetsFor = async (patientId: string): Promise<PlanTargets | null> => {
  const plan = await prisma.healthPlan.findFirst({ where: { patientId, status: "ACTIVE" }, include: { targets: true } });
  if (!plan) return null;
  /** A target's number: the floor when there is one (protein, sleep, sessions
   *  are all "at least"), otherwise the ceiling. */
  const of = (metricKey: string) => plan.targets.find((t) => t.metricKey === metricKey)?.min ?? plan.targets.find((t) => t.metricKey === metricKey)?.max ?? null;
  return {
    sleepMinutes: of("sleep_minutes"),
    sessionsPerWeek: of("exercise_sessions"),
    proteinG: of("protein_g"),
    calories: of("calories"),
    // Nothing stores a target RATE yet — the plan keeps a start and a target
    // weight but no date to hit it by, and inventing one here would put a
    // number a clinician might read behind a guess. `weight.off_track` stays
    // quiet until the plan carries a rate.
    weightRateKgPerWeek: null,
  };
};

export const collect = async (patientId: string, today: string, timeZone: string, lookbackDays = LOOKBACK_DAYS): Promise<SignalInput> => {
  const from = moment.tz(today, timeZone).subtract(lookbackDays, "days").format("YYYY-MM-DD");
  const fromDate = moment.tz(from, timeZone).startOf("day").toDate();

  const [vitals, dailyFoods, sessions, weightTracker, plan, open] = await Promise.all([
    prisma.nightlyVitals.findMany({ where: { patientId, date: { gte: from, lte: today } }, orderBy: { date: "asc" } }),
    prisma.dailyFood.findMany({ where: { userId: patientId, date: { gte: from, lte: today } }, include: { foodEntries: { select: { calories: true, proteins: true } } } }),
    prisma.workoutSession.findMany({ where: { patientId, startedAt: { gte: fromDate } }, select: { startedAt: true, plannedFor: true, status: true, durationSec: true } }),
    prisma.weightTracker.findUnique({ where: { userId: patientId }, include: { weightEntries: true } }).catch(() => null),
    planTargetsFor(patientId),
    prisma.finding.findMany({ where: { patientId, status: { in: ["OPEN", "ONGOING"] } }, select: { detectorKey: true, firstDetectedAt: true, peakSeverity: true } }),
  ]);

  const nights: NightRow[] = vitals.map((v) => ({
    date: v.date,
    asleepMinutes: v.asleepMinutes,
    hrvMs: v.hrvMs,
    sleepingHr: v.sleepingHr,
    restingHr: v.restingHr,
    respiratoryRate: v.respiratoryRate,
    wristTempC: v.wristTempC,
  }));

  /**
   * A day with no DailyFood row and a day with an empty one both mean "nothing
   * logged" — so the series is built from the calendar, not from the rows, or
   * a gap would simply be absent and `logging.stopped` could never see it.
   */
  const byDate = new Map(dailyFoods.map((d) => [d.date, d]));
  const days: DayRow[] = [];
  for (let cursor = moment.tz(from, timeZone); cursor.format("YYYY-MM-DD") <= today; cursor.add(1, "day")) {
    const date = cursor.format("YYYY-MM-DD");
    const row = byDate.get(date);
    const entries = row?.foodEntries ?? [];
    days.push({
      date,
      logged: entries.length > 0,
      calories: entries.length ? entries.reduce((acc, e) => acc + (e.calories ?? 0), 0) : null,
      proteinG: entries.length ? entries.reduce((acc, e) => acc + (e.proteins ?? 0), 0) : null,
    });
  }

  const workouts: WorkoutRow[] = sessions.map((s) => ({
    // A planned session keeps its slot in startedAt but owns its local day in
    // plannedFor (schema.prisma:1304) — prefer it so a timezone can't move it.
    date: s.plannedFor ?? dayKey(s.startedAt, timeZone),
    // There is no SKIPPED status in the schema — a planned day that passed
    // unrecorded simply stays PLANNED, which is why the training detectors
    // count COMPLETED rows rather than counting misses.
    status: s.status === "COMPLETED" ? "COMPLETED" : "PLANNED",
    minutes: s.durationSec ? Math.round(s.durationSec / 60) : null,
  }));

  const weights = (weightTracker?.weightEntries ?? [])
    .map((e) => ({ date: dayKey(e.createdAt, timeZone), kg: e.unit?.toLowerCase().startsWith("lb") ? e.weight * 0.453_592 : e.weight }))
    .filter((w) => w.date >= from && w.date <= today)
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    patientId,
    today,
    timeZone,
    nights,
    days,
    workouts,
    weights,
    plan,
    openFindings: open.map((f) => ({ detectorKey: f.detectorKey, firstDetectedAt: dayKey(f.firstDetectedAt, timeZone), peakSeverity: f.peakSeverity })),
  };
};
