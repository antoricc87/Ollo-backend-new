/**
 * WorkoutService — the only code that touches the workout tables. Used by the
 * REST controller, the agent tools and the snapshot alike.
 *
 * One record, two states (Sep 2026): a session designed for a day is a
 * PLANNED row (targets on its sets, a slot in startedAt/endedAt); when it
 * happens the SAME row becomes COMPLETED — adopted by the HealthKit sync when a
 * compatible watch workout lands on that day, or completed by a described /
 * manual session. `adoptPlanned` is the one rule both paths use, so a planned
 * session is never duplicated by the thing that fulfils it.
 */
import moment from "moment-timezone";
import prisma from "../../../utility/prismaClient";
import { activityKeyFromHealthKit } from "../domain/activity.catalog";
import { estimateCalories, toKg } from "../domain/workout.metrics";
import { matchPlannedSession, type PlannedCandidate } from "../domain/workout.matching";
import type { ExerciseInput, PlannedSessionInput, SessionInput, SyncRequest, WatchWorkoutSummary } from "../domain/workout.schema";

const SESSION_INCLUDE = { exercises: { orderBy: { sortOrder: "asc" as const }, include: { sets: { orderBy: { sortOrder: "asc" as const } } } } };

export type SessionRecord = NonNullable<Awaited<ReturnType<typeof WorkoutService.get>>>;
export type StatusFilter = "COMPLETED" | "PLANNED" | "ALL";

const DAY = "YYYY-MM-DD";
export const DEFAULT_PLANNED_TIME = "07:00";

const safeTz = (tz?: string | null) => (tz && moment.tz.zone(tz) ? tz : "UTC");

const metricsFromWatch = (w: WatchWorkoutSummary) => ({
  calories: w.calories != null ? Math.round(w.calories) : null,
  metricsSource: "watch",
  distanceKm: w.distanceKm ?? null,
  avgHr: w.avgHr ?? null,
  peakHr: w.peakHr ?? null,
  lowHr: w.lowHr ?? null,
  zoneSeconds: w.zoneSeconds ?? [],
});

const exercisesCreate = (exercises: ExerciseInput[]) => ({
  create: exercises.map((e, i) => ({
    sortOrder: i,
    exerciseKey: e.exerciseKey,
    name: e.name,
    muscleGroup: e.muscleGroup ?? null,
    equipment: e.equipment ?? null,
    notes: e.notes ?? null,
    loadNote: e.loadNote ?? null,
    alternatives: e.alternatives ?? [],
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
        targetReps: s.targetReps ?? null,
        targetRepsMax: s.targetRepsMax ?? null,
        targetKg: s.targetKg ?? null,
        restSec: s.restSec ?? null,
      })),
    },
  })),
});

/**
 * Actual exercises over a planned prescription: targets are carried onto the
 * actual sets by exercise key (first unused planned exercise with that key,
 * set by set), so "planned vs done" survives completion. Planned exercises the
 * user did not do are dropped; extra ones are kept without targets.
 */
const mergeTargets = (actual: ExerciseInput[], planned: SessionRecord["exercises"]): ExerciseInput[] => {
  const pool = [...planned];
  return actual.map((e) => {
    const i = pool.findIndex((p) => p.exerciseKey === e.exerciseKey);
    if (i < 0) return e;
    const [p] = pool.splice(i, 1);
    return {
      ...e,
      loadNote: e.loadNote ?? p.loadNote ?? null,
      alternatives: e.alternatives ?? p.alternatives ?? [],
      sets: e.sets.map((s, j) => {
        const t = p.sets[j];
        return t ? { ...s, targetReps: s.targetReps ?? t.targetReps, targetRepsMax: s.targetRepsMax ?? t.targetRepsMax, targetKg: s.targetKg ?? t.targetKg, restSec: s.restSec ?? t.restSec } : s;
      }),
    };
  });
};

const statusWhere = (status: StatusFilter) => (status === "ALL" ? {} : { status });

class WorkoutServiceImpl {
  async tzOf(patientId: string) {
    const p = await prisma.patient.findUnique({ where: { id: patientId }, select: { timeZone: true } });
    return safeTz(p?.timeZone);
  }

  async get(patientId: string, id: string) {
    return prisma.workoutSession.findFirst({ where: { id, patientId, deletedAt: null }, include: SESSION_INCLUDE });
  }

  /**
   * Sessions overlapping [from, to) — newest first. Defaults to COMPLETED so
   * every history consumer keeps its meaning; PLANNED / ALL for the week view.
   */
  async list(patientId: string, range: { from: Date; to: Date }, opts: { includeExercises?: boolean; limit?: number; status?: StatusFilter } = {}) {
    return prisma.workoutSession.findMany({
      where: { patientId, deletedAt: null, startedAt: { gte: range.from, lt: range.to }, ...statusWhere(opts.status ?? "COMPLETED") },
      orderBy: { startedAt: opts.status === "PLANNED" || opts.status === "ALL" ? "asc" : "desc" },
      take: opts.limit ?? 500,
      include: opts.includeExercises === false ? undefined : SESSION_INCLUDE,
    });
  }

  /** Planned rows for a local-day range (inclusive), oldest first. */
  async listPlanned(patientId: string, fromDay: string, toDay: string) {
    return prisma.workoutSession.findMany({
      where: { patientId, deletedAt: null, status: "PLANNED", plannedFor: { gte: fromDay, lte: toDay } },
      orderBy: [{ plannedFor: "asc" }, { startedAt: "asc" }],
      include: SESSION_INCLUDE,
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

  /* ------------------------------- planning ------------------------------- */

  /** The slot a planned session occupies: its day at the stated or preferred time. */
  private async plannedSlot(patientId: string, input: Pick<PlannedSessionInput, "plannedFor" | "startTime" | "durationMin">, tz: string) {
    let time = input.startTime ?? null;
    if (!time) {
      const profile = await prisma.trainingProfile.findUnique({ where: { patientId }, select: { preferredTime: true } });
      time = profile?.preferredTime ?? DEFAULT_PLANNED_TIME;
    }
    const startedAt = moment.tz(`${input.plannedFor} ${time}`, "YYYY-MM-DD HH:mm", tz);
    return { startedAt: startedAt.toDate(), endedAt: startedAt.clone().add(input.durationMin!, "minutes").toDate(), durationSec: input.durationMin! * 60 };
  }

  private plannedBase(input: PlannedSessionInput) {
    return {
      activityKey: input.activityKey,
      title: input.title,
      focus: input.focus,
      place: input.place ?? null,
      muscleGroups: input.muscleGroups ?? [],
      why: input.why ?? null,
      warmup: input.warmup ?? [],
      cooldown: input.cooldown ?? [],
      notes: input.notes ?? null,
      distanceKm: input.distanceKm ?? null,
    };
  }

  /** Persist a designed session for a day (status PLANNED). */
  async createPlanned(patientId: string, input: PlannedSessionInput, opts: { planId?: string | null; source?: "OLLIE" | "MANUAL" } = {}) {
    const tz = await this.tzOf(patientId);
    const slot = await this.plannedSlot(patientId, input, tz);
    return prisma.workoutSession.create({
      data: {
        patientId,
        source: opts.source ?? "OLLIE",
        status: "PLANNED",
        plannedFor: input.plannedFor,
        planId: opts.planId ?? null,
        ...this.plannedBase(input),
        ...slot,
        metricsSource: null,
        exercises: exercisesCreate(input.exercises),
      },
      include: SESSION_INCLUDE,
    });
  }

  /** Replace the planned session on a day (swap); the old row is soft-deleted. */
  async replacePlanned(patientId: string, id: string, input: PlannedSessionInput) {
    const old = await prisma.workoutSession.findFirst({ where: { id, patientId, deletedAt: null, status: "PLANNED" }, select: { id: true, planId: true, source: true } });
    if (!old) return null;
    const fresh = await this.createPlanned(patientId, input, { planId: old.planId, source: old.source === "MANUAL" ? "MANUAL" : "OLLIE" });
    await prisma.workoutSession.update({ where: { id: old.id }, data: { deletedAt: new Date() } });
    return fresh;
  }

  /**
   * The planned row a real session completes: same local day, compatible
   * activity, ranked like the watch match. Also considers rows the watch
   * already completed but nobody has described yet (so the sets can still be
   * filled in without creating a second session). Null = nothing to adopt.
   */
  async adoptPlanned(patientId: string, real: { day: string; activityKey: string; startedAtMs: number | null; durationSec: number | null }) {
    const rows = await prisma.workoutSession.findMany({
      where: {
        patientId,
        deletedAt: null,
        plannedFor: real.day,
        OR: [{ status: "PLANNED" }, { status: "COMPLETED", description: null, source: { not: "HEALTHKIT" } }],
      },
      select: { id: true, activityKey: true, startedAt: true, endedAt: true, durationSec: true, status: true },
    });
    if (!rows.length) return null;
    const candidates: PlannedCandidate[] = rows.map((r) => ({ id: r.id, activityKey: r.activityKey, startedAt: r.startedAt.toISOString(), endedAt: r.endedAt.toISOString(), durationSec: r.durationSec }));
    const hit = matchPlannedSession({ activityKey: real.activityKey, day: real.day, startedAtMs: real.startedAtMs, durationSec: real.durationSec }, candidates);
    if (!hit) return null;
    return prisma.workoutSession.findUnique({ where: { id: hit.id }, include: SESSION_INCLUDE });
  }

  /**
   * Phone → server sync of HealthKit workout summaries. Upserts by externalId
   * and only ever writes METRIC fields, so titles/exercises the user added
   * survive. A NEW watch workout that lands on a planned day adopts the
   * planned row instead of creating a second session. Summaries missing from
   * the window are unlinked (or soft-deleted when they carry nothing but
   * watch data).
   */
  async syncFromHealthKit(patientId: string, req: SyncRequest) {
    const tz = await this.tzOf(patientId);
    let created = 0, updated = 0, removed = 0, adopted = 0;
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
        continue;
      }
      const activityKey = activityKeyFromHealthKit(w.activityName);
      const planned = await this.adoptPlanned(patientId, { day: moment(w.startedAt).tz(tz).format(DAY), activityKey, startedAtMs: new Date(w.startedAt).getTime(), durationSec: w.durationSec });
      if (planned && planned.status === "PLANNED") {
        await prisma.workoutSession.update({ where: { id: planned.id }, data: { ...data, externalId: w.externalId, status: "COMPLETED", completedAt: new Date() } });
        adopted += 1;
        continue;
      }
      await prisma.workoutSession.create({ data: { patientId, source: "HEALTHKIT", externalId: w.externalId, activityKey, ...data } });
      created += 1;
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
    return { created, updated, removed, adopted };
  }

  private async completedBase(patientId: string, input: SessionInput, source: "OLLIE" | "MANUAL") {
    const watch = input.watch ?? null;
    const metrics = watch
      ? metricsFromWatch(watch)
      : { calories: estimateCalories(input.activityKey, input.durationSec, await this.bodyWeightKg(patientId)), metricsSource: "estimate", distanceKm: input.distanceKm ?? null, avgHr: null, peakHr: null, lowHr: null, zoneSeconds: [] as number[] };
    if (metrics.metricsSource === "estimate" && metrics.calories == null) metrics.metricsSource = null as any;
    return {
      watch,
      base: {
        source,
        activityKey: input.activityKey,
        title: input.title ?? null,
        startedAt: new Date(watch?.startedAt ?? input.startedAt),
        endedAt: new Date(watch?.endedAt ?? input.endedAt),
        durationSec: watch?.durationSec ?? input.durationSec,
        rpe: input.rpe ?? null,
        notes: input.notes ?? null,
        description: input.description ?? null,
        status: "COMPLETED" as const,
        completedAt: new Date(),
        ...metrics,
      },
    };
  }

  /**
   * Complete a planned row with what actually happened. Actual sets replace
   * the prescription but carry its targets; a completion with no exercises
   * (watch-only) keeps the planned exercises for the user to fill in later.
   */
  async completeSession(patientId: string, id: string, input: SessionInput, source: "OLLIE" | "MANUAL" = "OLLIE") {
    const planned = await prisma.workoutSession.findFirst({ where: { id, patientId, deletedAt: null }, include: SESSION_INCLUDE });
    if (!planned) return null;
    const { watch, base } = await this.completedBase(patientId, input, source);
    const title = input.title ?? planned.title ?? null;
    const exercises = input.exercises.length ? mergeTargets(input.exercises, planned.exercises) : null;
    // A watch row already synced for this workout would collide on externalId: fold it into the planned row.
    if (watch) {
      const twin = await prisma.workoutSession.findUnique({ where: { patientId_externalId: { patientId, externalId: watch.externalId } }, select: { id: true } });
      if (twin && twin.id !== planned.id) await prisma.workoutSession.delete({ where: { id: twin.id } });
    }
    if (exercises) await prisma.workoutExercise.deleteMany({ where: { sessionId: planned.id } });
    return prisma.workoutSession.update({
      where: { id: planned.id },
      data: { ...base, title, externalId: watch?.externalId ?? planned.externalId, ...(exercises ? { exercises: exercisesCreate(exercises) } : {}) },
      include: SESSION_INCLUDE,
    });
  }

  /**
   * Persist a described/manual session. When it is linked to a watch workout
   * that was already synced, that row is enriched instead of duplicated; when
   * it lands on a day with a compatible planned session, that row is completed
   * (`plannedId` forces a specific one; `adopt:false` opts out).
   */
  async createSession(patientId: string, input: SessionInput, source: "OLLIE" | "MANUAL", opts: { plannedId?: string | null; adopt?: boolean } = {}) {
    if (opts.plannedId) {
      const done = await this.completeSession(patientId, opts.plannedId, input, source);
      if (done) return done;
    }
    if (opts.adopt !== false) {
      const tz = await this.tzOf(patientId);
      const startedAt = new Date(input.watch?.startedAt ?? input.startedAt);
      const planned = await this.adoptPlanned(patientId, { day: moment(startedAt).tz(tz).format(DAY), activityKey: input.activityKey, startedAtMs: startedAt.getTime(), durationSec: input.watch?.durationSec ?? input.durationSec });
      if (planned) {
        const done = await this.completeSession(patientId, planned.id, input, source);
        if (done) return done;
      }
    }
    const { watch, base } = await this.completedBase(patientId, input, source);
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

  /** Last time each of these exercises was DONE before `before` — for "vs last time" and load prescription. */
  async previousExercises(patientId: string, exerciseKeys: string[], before: Date) {
    if (!exerciseKeys.length) return new Map<string, { sessionDate: Date; sets: { reps: number | null; weightKg: number | null }[] }>();
    const rows = await prisma.workoutExercise.findMany({
      where: { exerciseKey: { in: exerciseKeys }, session: { patientId, deletedAt: null, status: "COMPLETED", startedAt: { lt: before } } },
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
