/**
 * Match a described session to one of the watch workouts the phone sent.
 * Pure: time-window overlap first, then same-day activity compatibility.
 */
import { activitiesCompatible, activityKeyFromHealthKit } from "./activity.catalog";
import type { WatchWorkoutSummary } from "./workout.schema";

export type Described = {
  activityKey: string;
  /** Local day the session happened. */
  day: string;
  /** ms epoch when known (user gave a time), else null. */
  startedAtMs: number | null;
  durationSec: number | null;
};

export type Match =
  | { kind: "exact"; workout: WatchWorkoutSummary; overlap: number }
  | { kind: "likely"; workout: WatchWorkoutSummary; overlap: number }
  | { kind: "ambiguous"; candidates: WatchWorkoutSummary[] }
  | { kind: "none" };

const ms = (iso: string) => new Date(iso).getTime();

const overlapSeconds = (aStart: number, aEnd: number, bStart: number, bEnd: number) => Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart)) / 1000;

/** `dayOf` renders an ISO instant as the patient's local YYYY-MM-DD. */
export const matchWatchWorkout = (d: Described, candidates: WatchWorkoutSummary[], dayOf: (iso: string) => string): Match => {
  const sameDay = candidates.filter((w) => dayOf(w.startedAt) === d.day);
  if (!sameDay.length) return { kind: "none" };

  if (d.startedAtMs !== null) {
    const dur = (d.durationSec ?? 45 * 60) * 1000;
    const end = d.startedAtMs + dur;
    const scored = sameDay
      .map((w) => ({ w, overlap: overlapSeconds(d.startedAtMs!, end, ms(w.startedAt), ms(w.endedAt)) }))
      .filter((x) => x.overlap > 0)
      .sort((a, b) => b.overlap - a.overlap);
    if (scored.length) {
      const top = scored[0];
      const frac = top.overlap / Math.max(1, dur / 1000);
      return { kind: frac >= 0.5 ? "exact" : "likely", workout: top.w, overlap: top.overlap };
    }
  }

  const compatible = sameDay.filter((w) => activitiesCompatible(d.activityKey, activityKeyFromHealthKit(w.activityName)));
  const pool = compatible.length ? compatible : sameDay;
  if (pool.length === 1) return { kind: compatible.length ? "likely" : "likely", workout: pool[0], overlap: 0 };

  // Several on the same day: prefer the one whose duration is closest.
  if (d.durationSec) {
    const ranked = [...pool].sort((a, b) => Math.abs(a.durationSec - d.durationSec!) - Math.abs(b.durationSec - d.durationSec!));
    const [a, b] = ranked;
    if (Math.abs(a.durationSec - d.durationSec) < 10 * 60 && (!b || Math.abs(b.durationSec - d.durationSec) > 15 * 60)) return { kind: "likely", workout: a, overlap: 0 };
  }
  return { kind: "ambiguous", candidates: pool };
};

/* ------------------------- planned-session adoption ------------------------- */

export type PlannedCandidate = {
  id: string;
  activityKey: string;
  /** ISO instants of the planned slot. */
  startedAt: string;
  endedAt: string;
  durationSec: number;
};

/**
 * Which planned row does a real session (watch workout or described) complete?
 * Same ranking as the watch match: compatible activity first, time overlap
 * when a start is known, else closest duration; a lone compatible candidate
 * wins outright. Returns null when nothing on that day fits — the caller
 * then creates a fresh row, never a duplicate of a planned one.
 */
export const matchPlannedSession = (d: Described, planned: PlannedCandidate[]): PlannedCandidate | null => {
  const compatible = planned.filter((p) => activitiesCompatible(d.activityKey, p.activityKey));
  if (!compatible.length) return null;
  if (compatible.length === 1) return compatible[0];
  if (d.startedAtMs !== null) {
    const dur = (d.durationSec ?? 45 * 60) * 1000;
    const scored = compatible
      .map((p) => ({ p, overlap: overlapSeconds(d.startedAtMs!, d.startedAtMs! + dur, ms(p.startedAt), ms(p.endedAt)) }))
      .filter((x) => x.overlap > 0)
      .sort((a, b) => b.overlap - a.overlap);
    if (scored.length) return scored[0].p;
  }
  const want = d.durationSec ?? 45 * 60;
  return [...compatible].sort((a, b) => Math.abs(a.durationSec - want) - Math.abs(b.durationSec - want))[0];
};
