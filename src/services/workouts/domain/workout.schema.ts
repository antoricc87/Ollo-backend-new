/**
 * Zod contracts shared by the REST API, the agent tool and the proposal
 * store. Anything that crosses a process boundary is validated here.
 */
import { z } from "zod";
import { ACTIVITY_KEYS } from "./activity.catalog";

export const isoDateTime = z.string().datetime({ offset: true });
export const dayString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD");

/** What the phone knows about a HealthKit workout — summary only, no trace. */
export const WatchWorkoutSummary = z.object({
  externalId: z.string().min(8).max(80),
  activityName: z.string().max(80), // HealthKit activityName, mapped server-side
  startedAt: isoDateTime,
  endedAt: isoDateTime,
  durationSec: z.number().int().min(0).max(24 * 3600),
  calories: z.number().min(0).max(10000).nullable().optional(),
  distanceKm: z.number().min(0).max(1000).nullable().optional(),
  avgHr: z.number().int().min(20).max(250).nullable().optional(),
  peakHr: z.number().int().min(20).max(250).nullable().optional(),
  lowHr: z.number().int().min(20).max(250).nullable().optional(),
  zoneSeconds: z.array(z.number().int().min(0)).length(5).nullable().optional(),
  sourceName: z.string().max(80).nullable().optional(),
});
export type WatchWorkoutSummary = z.infer<typeof WatchWorkoutSummary>;

export const SyncRequest = z.object({
  windowStart: isoDateTime,
  windowEnd: isoDateTime,
  workouts: z.array(WatchWorkoutSummary).max(500),
});
export type SyncRequest = z.infer<typeof SyncRequest>;

export const SetInput = z.object({
  reps: z.number().int().min(0).max(1000).nullable().optional(),
  weightKg: z.number().min(0).max(1000).nullable().optional(),
  durationSec: z.number().int().min(0).max(24 * 3600).nullable().optional(),
  distanceM: z.number().min(0).max(200000).nullable().optional(),
  rpe: z.number().min(1).max(10).nullable().optional(),
  toFailure: z.boolean().optional(),
  isWarmup: z.boolean().optional(),
});
export type SetInput = z.infer<typeof SetInput>;

export const ExerciseInput = z.object({
  exerciseKey: z.string().min(1).max(80),
  name: z.string().min(1).max(80),
  muscleGroup: z.string().max(40).nullable().optional(),
  equipment: z.string().max(40).nullable().optional(),
  notes: z.string().max(300).nullable().optional(),
  sets: z.array(SetInput).max(50),
});
export type ExerciseInput = z.infer<typeof ExerciseInput>;

/** A fully-resolved session ready to persist. */
export const SessionInput = z.object({
  activityKey: z.enum(ACTIVITY_KEYS),
  title: z.string().max(80).nullable().optional(),
  startedAt: isoDateTime,
  endedAt: isoDateTime,
  durationSec: z.number().int().min(60).max(24 * 3600),
  rpe: z.number().int().min(1).max(10).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  /** Stated distance for endurance sessions without a watch. */
  distanceKm: z.number().min(0).max(1000).nullable().optional(),
  exercises: z.array(ExerciseInput).max(40).default([]),
  /** Linked HealthKit workout (metrics are copied from it). */
  watch: WatchWorkoutSummary.nullable().optional(),
});
export type SessionInput = z.infer<typeof SessionInput>;

/** Card edits before confirm: per-set reps/weight, set removal, title. */
export const PreviewEdits = z.object({
  title: z.string().max(80).nullable().optional(),
  exercises: z
    .array(
      z.object({
        index: z.number().int().min(0),
        removed: z.boolean().optional(),
        sets: z
          .array(z.object({ index: z.number().int().min(0), reps: z.number().int().min(0).max(1000).nullable().optional(), weightKg: z.number().min(0).max(1000).nullable().optional(), removed: z.boolean().optional() }))
          .max(50)
          .optional(),
      })
    )
    .max(40)
    .optional(),
});
export type PreviewEdits = z.infer<typeof PreviewEdits>;
