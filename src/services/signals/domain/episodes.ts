import { detectorBy } from "./registry";
import { Candidate } from "./types";

/**
 * EPISODES — a run of days on which one detector kept firing is ONE finding,
 * not one per day. Everything downstream depends on that: dedup, the "already
 * mentioned, not materially worse" rule, and the clinician's timeline, where
 * "four recovery dips in 90 days, longest eleven" is a sentence worth reading
 * and "112 detections" is not.
 *
 * Pure so the replay harness and the live worker share one implementation —
 * calibration is worthless if the thing replayed is not the thing that runs.
 */

export type Episode = {
  detectorKey: string;
  detectorVersion: number;
  direction: Candidate["direction"];
  status: "OPEN" | "ONGOING" | "RESOLVED";
  severity: number;
  peakSeverity: number;
  evidence: Record<string, unknown>;
  baseline?: Record<string, unknown> | null;
  firstDetectedAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
  notifiedAt: string | null;
  notifiedSeverity: number | null;
};

const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

export type DayResult = {
  episodes: Episode[];
  opened: Episode[];
  /** Episodes that resolved TODAY, in case anything wants to react to that. */
  resolved: Episode[];
};

/**
 * Fold one day's candidates into the running episodes.
 *
 * An episode that fires again refreshes `lastSeenAt` and keeps its
 * `firstDetectedAt` — the date the thing STARTED is the clinically interesting
 * one. A quiet stretch longer than the detector's `resolveAfterDays` closes it,
 * and a later firing opens a new episode rather than reviving the old one, so
 * "it came back" stays visible as two rows.
 */
export const applyDay = (open: Episode[], candidates: Candidate[], today: string): DayResult => {
  const byKey = new Map(candidates.map((c) => [c.detectorKey, c]));
  const episodes: Episode[] = [];
  const opened: Episode[] = [];
  const resolved: Episode[] = [];

  for (const episode of open) {
    const candidate = byKey.get(episode.detectorKey);
    if (candidate) {
      byKey.delete(episode.detectorKey);
      episodes.push({
        ...episode,
        status: "ONGOING",
        severity: candidate.severity,
        peakSeverity: Math.max(episode.peakSeverity, candidate.severity),
        evidence: candidate.evidence,
        lastSeenAt: today,
      });
      continue;
    }
    const quietFor = daysBetween(episode.lastSeenAt, today);
    const window = detectorBy(episode.detectorKey)?.resolveAfterDays ?? 3;
    if (quietFor > window) {
      const closed: Episode = { ...episode, status: "RESOLVED", resolvedAt: today };
      resolved.push(closed);
      episodes.push(closed);
    } else {
      episodes.push(episode);
    }
  }

  for (const candidate of byKey.values()) {
    const episode: Episode = {
      detectorKey: candidate.detectorKey,
      detectorVersion: candidate.detectorVersion,
      direction: candidate.direction,
      status: "OPEN",
      severity: candidate.severity,
      peakSeverity: candidate.severity,
      evidence: candidate.evidence,
      baseline: candidate.baseline ?? null,
      firstDetectedAt: today,
      lastSeenAt: today,
      resolvedAt: null,
      notifiedAt: null,
      notifiedSeverity: null,
    };
    episodes.push(episode);
    opened.push(episode);
  }

  return { episodes, opened, resolved };
};

export const stillOpen = (episodes: Episode[]) => episodes.filter((e) => e.status !== "RESOLVED");
