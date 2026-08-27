/**
 * WorkoutService — the only code that touches the workout tables. Used by the
 * REST controller, the agent tools and the snapshot alike.
 */
import prisma from "../../../utility/prismaClient";
import { activityKeyFromHealthKit } from "../domain/activity.catalog";
import { estimateCalories, toKg } from "../domain/workout.metrics";
import type { SessionInput, SyncRequest, WatchWorkoutSummary } from "../domain/workout.schema";

const SESSION_INCLUDE = { exercises: { orderBy: { sortOrder: "asc" as const }, include: { sets: { orderBy: { sortOrder: "asc" as const } } } } };

export type SessionRecord = NonNullable<Awaited<ReturnType<typeof WorkoutService.get>>>;

const metricsFromWatch = (w: WatchWorkoutSummary) => ({
  calories: w.calories != null ? Math.round(w.calories) : null,
  metricsSource: "watch",
  distanceKm: w.distanceKm ?? null,
  avgHr: w.avgHr ?? null,
  peakHr: w.peakHr ?? null,
  lowHr: w.lowHr ?? null,
  zoneSeconds: w.zoneSeconds ?? [],
});

const exercisesCreate = (exercises: SessionInput["exercises"]) => ({
  create: exercises.map((e, i) => ({
    sortOrder: i,
    exerciseKey: e.exerciseKey,
    name: e.name,
    muscleGroup: e.muscleGroup ?? null,
    equipment: e.equipment ?? null,
    notes: e.notes ?? null,
    sets: {
      create: e.sets.map((s, j) => ({
        sortOrder: j,
        reps: s.reps ?? null,
        weightKg: s.weightKg ?? null,
        durationSec: s.durationSec ?? null,
        distanceM: s.distanceM ?? null,
        rpe: s.rpe ?? null,
        toFailure: !!s.toFailure,
        isWarmup: !!s.isWarmup,
      })),
    },
  })),
});

class WorkoutServiceImpl {
  async get(patientId: string, id: string) {
    return prisma.workoutSession.findFirst({ where: { id, patientId, deletedAt: null }, include: SESSION_INCLUDE });
  }

  /** Sessions overlapping [from, to) — newest first. */
  async list(patientId: string, range: { from: Date; to: Date }, opts: { includeExercises?: boolean; limit?: number } = {}) {
    return prisma.workoutSession.findMany({
      where: { patientId, deletedAt: null, startedAt: { gte: range.from, lt: range.to } },
      orderBy: { startedAt: "desc" },
      take: opts.limit ?? 500,
      include: opts.includeExercises === false ? undefined : SESSION_INCLUDE,
    });
  }

  /** Body weight for calorie estimates, in kg. */
  async bodyWeightKg(patientId: string) {
    const [entry, vitals] = await Promise.all([
      prisma.weightEntry.findFirst({ where: { tracker: { userId: patientId } }, orderBy: { createdAt: "desc" }, select: { weight: true, unit: true } }),
      prisma.vitalsSummary.findFirst({ where: { patientSummary: { patientId } }, select: { weight: true, weight_unit: true } }),
    ]);
    return toKg(entry?.weight, entry?.unit) ?? toKg(vitals?.weight, vitals?.weight_unit) ?? null;
  }

  /**
   * Phone → server sync of HealthKit workout summaries. Upserts by externalId
   * and only ever writes METRIC fields, so titles/exercises the user added
   * survive. Summaries missing from the window are unlinked (or soft-deleted
   * when they carry nothing but watch data).
   */
  async syncFromHealthKit(patientId: string, req: SyncRequest) {
    let created = 0, updated = 0, removed = 0;
    for (const w of req.workouts) {
      const existing = await prisma.workoutSession.findUnique({ where: { patientId_externalId: { patientId, externalId: w.externalId } }, select: { id: true, activityKey: true, source: true } });
      const data = {
        startedAt: new Date(w.startedAt),
        endedAt: new Date(w.endedAt),
        durationSec: w.durationSec,
        ...metricsFromWatch(w),
        deletedAt: null,
      };
      if (existing) {
        await prisma.workoutSession.update({
          where: { id: existing.id },
          data: existing.source === "HEALTHKIT" ? { ...data, activityKey: activityKeyFromHealthKit(w.activityName) } : data,
        });
        updated += 1;
      } else {
        await prisma.workoutSession.create({
          data: { patientId, source: "HEALTHKIT", externalId: w.externalId, activityKey: activityKeyFromHealthKit(w.activityName), ...data },
        });
        created += 1;
      }
    }
    const seen = new Set(req.workouts.map((w) => w.externalId));
    const stale = await prisma.workoutSession.findMany({
      where: { patientId, deletedAt: null, externalId: { not: null }, startedAt: { gte: new Date(req.windowStart), lt: new Date(req.windowEnd) } },
      select: { id: true, externalId: true, source: true, _count: { select: { exercises: true } } },
    });
    for (const s of stale) {
      if (seen.has(s.externalId!)) continue;
      if (s.source === "HEALTHKIT" && s._count.exercises === 0) await prisma.workoutSession.update({ where: { id: s.id }, data: { deletedAt: new Date() } });
      else await prisma.workoutSession.update({ where: { id: s.id }, data: { externalId: null } });
      removed += 1;
    }
    return { created, updated, removed };
  }

  /**
   * Persist a described/manual session. When it is linked to a watch workout
   * that was already synced, that row is enriched instead of duplicated.
   */
  async createSession(patientId: string, input: SessionInput, source: "OLLIE" | "MANUAL") {
    const watch = input.watch ?? null;
    const metrics = watch
      ? metricsFromWatch(watch)
      : { calories: estimateCalories(input.activityKey, input.durationSec, await this.bodyWeightKg(patientId)), metricsSource: "estimate", distanceKm: input.distanceKm ?? null, avgHr: null, peakHr: null, lowHr: null, zoneSeconds: [] as number[] };
    if (metrics.metricsSource === "estimate" && metrics.calories == null) metrics.metricsSource = null as any;

    const base = {
      source,
      activityKey: input.activityKey,
      title: input.title ?? null,
      startedAt: new Date(watch?.startedAt ?? input.startedAt),
      endedAt: new Date(watch?.endedAt ?? input.endedAt),
      durationSec: watch?.durationSec ?? input.durationSec,
      rpe: input.rpe ?? null,
      notes: input.notes ?? null,
      description: input.description ?? null,
      ...metrics,
    };

    const existing = watch ? await prisma.workoutSession.findUnique({ where: { patientId_externalId: { patientId, externalId: watch.externalId } }, select: { id: true } }) : null;
    if (existing) {
      await prisma.workoutExercise.deleteMany({ where: { sessionId: existing.id } });
      return prisma.workoutSession.update({ where: { id: existing.id }, data: { ...base, deletedAt: null, exercises: exercisesCreate(input.exercises) }, include: SESSION_INCLUDE });
    }
    return prisma.workoutSession.create({
      data: { patientId, externalId: watch?.externalId ?? null, ...base, exercises: exercisesCreate(input.exercises) },
      include: SESSION_INCLUDE,
    });
  }

  async softDelete(patientId: string, id: string) {
    const r = await prisma.workoutSession.updateMany({ where: { id, patientId, deletedAt: null }, data: { deletedAt: new Date() } });
    return r.count > 0;
  }

  /** Last time each of these exercises was done before `before` — for "vs last time". */
  async previousExercises(patientId: string, exerciseKeys: string[], before: Date) {
    if (!exerciseKeys.length) return new Map<string, { sessionDate: Date; sets: { reps: number | null; weightKg: number | null }[] }>();
    const rows = await prisma.workoutExercise.findMany({
      where: { exerciseKey: { in: exerciseKeys }, session: { patientId, deletedAt: null, startedAt: { lt: before } } },
      include: { sets: { orderBy: { sortOrder: "asc" } }, session: { select: { startedAt: true } } },
      orderBy: { session: { startedAt: "desc" } },
      take: exerciseKeys.length * 3,
    });
    const out = new Map<string, { sessionDate: Date; sets: { reps: number | null; weightKg: number | null }[] }>();
    for (const r of rows) if (!out.has(r.exerciseKey)) out.set(r.exerciseKey, { sessionDate: r.session.startedAt, sets: r.sets.filter((s) => !s.isWarmup).map((s) => ({ reps: s.reps, weightKg: s.weightKg })) });
    return out;
  }
}

const WorkoutService = new WorkoutServiceImpl();
export default WorkoutService;
