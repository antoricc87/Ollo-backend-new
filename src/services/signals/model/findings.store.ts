import moment from "moment-timezone";
import prisma from "../../../utility/prismaClient";
import { NotifyState } from "../domain/budget";
import { CloseReason, Episode, FollowUpStamps } from "../domain/episodes";
import { FollowUpKind } from "../domain/followups";
import { DayRun } from "../domain/run";

/**
 * Findings, persisted. The domain layer (episodes.ts) decides what an episode
 * IS; this only writes it down.
 *
 * At most one unresolved row per detector key is the invariant everything else
 * leans on — dedup, the cooldown, "already mentioned". Postgres cannot express
 * "at most one row where status <> RESOLVED", so it is enforced here: the open
 * set is read keyed by detector, and a second open row for the same key can
 * never be created because a firing either matches the open episode or there
 * isn't one.
 */

const dayKey = (at: Date, tz: string) => moment(at).tz(tz).format("YYYY-MM-DD");

export type OpenSet = {
  episodes: Episode[];
  /** Finding row id per detector key, so an update knows what to write to. */
  ids: Record<string, string>;
};

export const openEpisodes = async (patientId: string, tz: string): Promise<OpenSet> => {
  const rows = await prisma.finding.findMany({ where: { patientId, status: { in: ["OPEN", "ONGOING"] } } });
  const ids: Record<string, string> = {};
  const episodes = rows.map((r): Episode => {
    ids[r.detectorKey] = r.id;
    return {
      detectorKey: r.detectorKey,
      detectorVersion: r.detectorVersion,
      direction: r.direction,
      status: r.status as "OPEN" | "ONGOING",
      severity: r.severity,
      peakSeverity: r.peakSeverity,
      evidence: (r.evidence ?? {}) as Record<string, unknown>,
      baseline: (r.baseline ?? null) as Record<string, unknown> | null,
      firstDetectedAt: dayKey(r.firstDetectedAt, tz),
      lastSeenAt: dayKey(r.lastSeenAt, tz),
      resolvedAt: r.resolvedAt ? dayKey(r.resolvedAt, tz) : null,
      notifiedAt: r.notifiedAt ? dayKey(r.notifiedAt, tz) : null,
      // Rows notified before the column existed carry no snapshot: their
      // current severity is the closest honest stand-in.
      notifiedSeverity: r.notifiedAt ? r.notifiedSeverity ?? r.severity : null,
      quietDays: r.quietDays,
      lastDataAt: r.lastDataAt ? dayKey(r.lastDataAt, tz) : null,
      closeReason: (r.closeReason as CloseReason | null) ?? null,
      followUps: ((r.followUps ?? {}) as FollowUpStamps) ?? {},
      encounterId: r.encounterId,
    };
  });
  return { episodes, ids };
};

/** Local YYYY-MM-DD → a Date at noon local, so a stored instant can never
 *  read back as the day before in the patient's own zone. */
const atNoon = (date: string, tz: string) => moment.tz(date, tz).hour(12).toDate();

/**
 * Write the day's episodes. Returns the Finding row id per detector key,
 * including newly opened ones, so the caller can mark what it notified.
 */
export const persistDay = async (patientId: string, run: DayRun, today: string, tz: string, existing: OpenSet): Promise<{ ids: Record<string, string>; resolvedIds: Record<string, string> }> => {
  const ids = { ...existing.ids };
  /** Rows that closed today, by key — their follow-up ("back to your usual") needs the row. */
  const resolvedIds: Record<string, string> = {};

  for (const episode of run.episodes) {
    const id = ids[episode.detectorKey];
    const data = {
      status: episode.status,
      severity: episode.severity,
      peakSeverity: episode.peakSeverity,
      evidence: episode.evidence as object,
      baseline: (episode.baseline ?? undefined) as object | undefined,
      lastSeenAt: atNoon(episode.lastSeenAt, tz),
      resolvedAt: episode.resolvedAt ? atNoon(episode.resolvedAt, tz) : null,
      quietDays: episode.quietDays,
      lastDataAt: episode.lastDataAt ? atNoon(episode.lastDataAt, tz) : null,
      closeReason: episode.closeReason,
    };
    if (id) {
      await prisma.finding.update({ where: { id }, data });
      // A resolved episode is no longer the open one for its key — the next
      // firing must open a fresh row, or "it came back" would be invisible.
      if (episode.status === "RESOLVED") {
        resolvedIds[episode.detectorKey] = id;
        delete ids[episode.detectorKey];
      }
      continue;
    }
    const created = await prisma.finding.create({
      data: {
        patientId,
        detectorKey: episode.detectorKey,
        detectorVersion: episode.detectorVersion,
        direction: episode.direction,
        firstDetectedAt: atNoon(episode.firstDetectedAt, tz),
        ...data,
      },
    });
    ids[episode.detectorKey] = created.id;
  }
  return { ids, resolvedIds };
};

/** Told: when, in which thread, and how bad it was at that moment (what "materially worse" is measured from). */
export const markNotified = (findingId: string, threadId: string | null, severity: number, at: Date = new Date()) =>
  prisma.finding.update({ where: { id: findingId }, data: { notifiedAt: at, threadId, notifiedSeverity: severity } });

const STAMP: Record<FollowUpKind, keyof FollowUpStamps> = { still_going: "stillGoing", back_to_usual: "backToUsual" };

/** A follow-up note was written — stamped only once it exists, so a failed run is retried tomorrow. */
export const markFollowUp = async (findingId: string, kind: FollowUpKind, at: Date = new Date()) => {
  const row = await prisma.finding.findUnique({ where: { id: findingId }, select: { followUps: true } });
  const stamps = { ...((row?.followUps ?? {}) as FollowUpStamps), [STAMP[kind]]: at.toISOString() };
  await prisma.finding.update({ where: { id: findingId }, data: { followUps: stamps } });
};

/** A check-in was started in a signal's thread: the signal led to it. */
export const linkEncounter = (patientId: string, threadId: string, encounterId: string) =>
  prisma.finding.updateMany({ where: { patientId, threadId, encounterId: null }, data: { encounterId } });

/**
 * What the budget needs to know about history. The week is Monday-anchored in
 * the patient's own zone, because that is the week the budget is spent in.
 *
 * `lastNotifiedSeverity` is the severity snapshotted when the row was told
 * (`notifiedSeverity`). It used to be read from `severity`, which is
 * overwritten every morning — so "materially worse" was measured against
 * yesterday and a slow slide never counted (fixed Nov 16 2026). Rows told
 * before the column existed fall back to `severity`.
 */
export const notifyState = async (patientId: string, today: string, tz: string): Promise<Omit<NotifyState, "today">> => {
  const weekStart = moment.tz(today, tz).startOf("isoWeek").toDate();
  const [thisWeek, notified] = await Promise.all([
    prisma.finding.findMany({ where: { patientId, notifiedAt: { gte: weekStart } }, select: { detectorKey: true, direction: true } }),
    prisma.finding.findMany({ where: { patientId, notifiedAt: { not: null } }, orderBy: { notifiedAt: "desc" }, select: { detectorKey: true, notifiedAt: true, severity: true, notifiedSeverity: true, status: true } }),
  ]);
  const lastNotifiedAt: Record<string, string | undefined> = {};
  const lastNotifiedSeverity: Record<string, number | undefined> = {};
  const openNotifiedSeverity: Record<string, number | undefined> = {};
  for (const row of notified) {
    if (lastNotifiedAt[row.detectorKey]) continue; // newest first
    lastNotifiedAt[row.detectorKey] = dayKey(row.notifiedAt as Date, tz);
    lastNotifiedSeverity[row.detectorKey] = row.notifiedSeverity ?? row.severity;
    // "Already mentioned" belongs to the EPISODE: a closed one says nothing
    // about a new one, which is fresh news (the cooldown still spaces them,
    // and a much worse one still overrides the cooldown via the map above).
    if (row.status !== "RESOLVED") openNotifiedSeverity[row.detectorKey] = row.notifiedSeverity ?? row.severity;
  }
  return { sentThisWeek: thisWeek.map((r) => ({ detectorKey: r.detectorKey, direction: r.direction })), lastNotifiedAt, lastNotifiedSeverity, openNotifiedSeverity };
};

/** The patient-facing list (Signals screen) and, later, the clinician timeline. */
export const listFindings = (patientId: string, opts: { limit?: number; status?: ("OPEN" | "ONGOING" | "RESOLVED")[] } = {}) =>
  prisma.finding.findMany({
    where: { patientId, ...(opts.status ? { status: { in: opts.status } } : {}) },
    orderBy: [{ firstDetectedAt: "desc" }],
    take: opts.limit ?? 50,
  });
