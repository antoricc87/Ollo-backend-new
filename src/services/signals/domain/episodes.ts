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
 *
 * QUIET DAYS COUNT ONLY ON NEW DATA (Nov 16 2026). A detector that can say
 * whether its newest day is back inside the usual (`insideUsual`) counts only
 * those days, in a row (Nov 17 2026). An episode resolves after
 * its detector has judged `resolveAfterDays` + 1 fresh days without firing. A
 * morning with no new night is neither a bad night nor a good one, so it moves
 * nothing; after `NO_DATA_CLOSE_DAYS` without any data at all the episode is
 * closed as "no_data" — never as back to normal.
 */

export type CloseReason = "quiet" | "no_data" | "replaced";

export type FollowUpStamps = { stillGoing?: string; backToUsual?: string };

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
  /** Fresh days judged quiet since it last fired. */
  quietDays: number;
  /** Newest day the detector had data for, as of the last fold. */
  lastDataAt: string | null;
  closeReason: CloseReason | null;
  followUps: FollowUpStamps;
  /** The check-in this signal led to, if any. */
  encounterId?: string | null;
};

/** With no data at all for this long, an open episode stops claiming to be open. */
export const NO_DATA_CLOSE_DAYS = 21;

const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

export type DayResult = {
  episodes: Episode[];
  opened: Episode[];
  /** Episodes that resolved TODAY, in case anything wants to react to that. */
  resolved: Episode[];
};

/** Per detector key: the newest day it had data for today, or null. Missing key = today. */
export type DataAsOf = Record<string, string | null | undefined>;

/** Per detector key that judges it: is today's newest data day inside the usual? Missing key = the detector does not say. */
export type InsideToday = Record<string, boolean | null | undefined>;

/**
 * Fold one day's candidates into the running episodes.
 *
 * An episode that fires again refreshes `lastSeenAt` and keeps its
 * `firstDetectedAt` — the date the thing STARTED is the clinically interesting
 * one. Enough fresh quiet days close it, and a later firing opens a new
 * episode rather than reviving the old one, so "it came back" stays visible as
 * two rows.
 */
export const applyDay = (open: Episode[], candidates: Candidate[], today: string, dataAsOf: DataAsOf = {}, inside: InsideToday = {}): DayResult => {
  const byKey = new Map(candidates.map((c) => [c.detectorKey, c]));
  const episodes: Episode[] = [];
  const opened: Episode[] = [];
  const resolved: Episode[] = [];
  const dataFor = (key: string) => (key in dataAsOf ? dataAsOf[key] ?? null : today);

  for (const episode of open) {
    const candidate = byKey.get(episode.detectorKey);
    const data = dataFor(episode.detectorKey);
    if (candidate) {
      byKey.delete(episode.detectorKey);
      episodes.push({
        ...episode,
        status: "ONGOING",
        severity: candidate.severity,
        peakSeverity: Math.max(episode.peakSeverity, candidate.severity),
        evidence: candidate.evidence,
        lastSeenAt: today,
        quietDays: 0,
        lastDataAt: data ?? episode.lastDataAt,
      });
      continue;
    }
    const fresh = data != null && (episode.lastDataAt == null || data > episode.lastDataAt);
    // A detector that reports its data day counts one quiet day per new day of
    // data it judged; one that always has data (it judges absence) counts the
    // calendar days since it last looked, so a skipped scan does not stall it.
    const step = !fresh ? 0 : episode.detectorKey in dataAsOf || episode.lastDataAt == null ? 1 : Math.max(1, daysBetween(episode.lastDataAt, data as string));
    // A detector that judges each day itself: only a day back inside counts,
    // and a fresh day still off starts the count again (no re-firing needed).
    const judged = inside[episode.detectorKey];
    const quietDays = fresh && judged === false ? 0 : fresh && judged === true ? episode.quietDays + 1 : episode.quietDays + step;
    const lastDataAt = fresh ? data : episode.lastDataAt;
    const window = detectorBy(episode.detectorKey)?.resolveAfterDays ?? 3;
    const reason: CloseReason | null =
      quietDays > window ? "quiet" : daysBetween(lastDataAt ?? episode.lastSeenAt, today) > NO_DATA_CLOSE_DAYS ? "no_data" : null;
    if (reason) {
      const closed: Episode = { ...episode, quietDays, lastDataAt, status: "RESOLVED", resolvedAt: today, closeReason: reason };
      resolved.push(closed);
      episodes.push(closed);
    } else {
      episodes.push({ ...episode, quietDays, lastDataAt });
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
      quietDays: 0,
      lastDataAt: dataFor(candidate.detectorKey),
      closeReason: null,
      followUps: {},
    };
    episodes.push(episode);
    opened.push(episode);
  }

  return { episodes, opened, resolved };
};

export const stillOpen = (episodes: Episode[]) => episodes.filter((e) => e.status !== "RESOLVED");
