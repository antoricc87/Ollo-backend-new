import moment from "moment-timezone";
import prisma from "../../utility/prismaClient";
import { safeTz } from "../agent/memory/dates";
import { getPreference, labsInstruction, runProactiveFor } from "../agent/proactive/proactive.service";
import { LABS_KEY, labsDelta } from "./domain/detectors/labs";
import { markNotified } from "./model/findings.store";

/**
 * THE LAB SCAN — event-driven: a report was uploaded, what did it change?
 *
 * Like the daily scan, record and notification are separate: a delta is
 * written down as a Finding whether or not the person is told (their
 * preference decides that), so the clinician timeline keeps it either way.
 *
 * Uploads arrive one file per request, so a batch of three PDFs is three calls
 * in a row. `onLabReport` holds the scan for a short settle window and runs it
 * once, over every report not yet accounted for — one note per batch instead
 * of three. A restart inside the window loses the timer; the reports are still
 * picked up by the next call, or by the daily scan's `runLabScanFor` sweep.
 */

/** How long after the last upload the scan waits for the rest of the batch. */
export const SETTLE_MS = 45_000;
/** Reports older than this are never "new" — they predate the detector or were handled. */
const NEW_WITHIN_HOURS = 24;

const pending = new Map<string, NodeJS.Timeout>();

export const onLabReport = (patientId: string, _reportId: string, settleMs = SETTLE_MS) => {
  const prior = pending.get(patientId);
  if (prior) clearTimeout(prior);
  const t = setTimeout(() => {
    pending.delete(patientId);
    runLabScanFor(patientId).catch((e) => console.error(`lab scan failed for ${patientId}`, e));
  }, settleMs);
  t.unref?.();
  pending.set(patientId, t);
};

export type LabScanResult =
  | { patientId: string; newReports: number; fired: false; reason: string }
  | { patientId: string; newReports: number; fired: true; findingId: string; label: string; threadId: string | null; notified: boolean; withheld?: string };

/** Report ids already covered by a lab finding (any status). */
const coveredReportIds = async (patientId: string): Promise<Set<string>> => {
  const rows = await prisma.finding.findMany({ where: { patientId, detectorKey: LABS_KEY }, select: { evidence: true } });
  const out = new Set<string>();
  for (const r of rows) for (const id of ((r.evidence as any)?.reportIds ?? []) as string[]) out.add(id);
  return out;
};

export const runLabScanFor = async (patientId: string, opts: { notify?: boolean; reportIds?: string[] } = {}): Promise<LabScanResult | { skipped: string }> => {
  const patient = await prisma.patient.findUnique({ where: { id: patientId }, select: { timeZone: true } });
  if (!patient) return { skipped: "no patient" };
  const tz = safeTz(patient.timeZone);
  const today = moment().tz(tz).format("YYYY-MM-DD");

  const summary = await prisma.patientSummary.findUnique({ where: { patientId }, include: { labResults: { include: { labResults: true } } } });
  const reports = summary?.labResults ?? [];
  const covered = await coveredReportIds(patientId);
  const cutoff = Date.now() - NEW_WITHIN_HOURS * 3_600_000;
  const newIds = opts.reportIds ?? reports.filter((r) => !covered.has(r.id) && new Date(r.createdAt).getTime() >= cutoff).map((r) => r.id);
  if (!newIds.length) return { patientId, newReports: 0, fired: false, reason: "no new reports" };

  const candidate = labsDelta(reports as any, newIds);
  if (!candidate) return { patientId, newReports: newIds.length, fired: false, reason: "nothing changed against the record" };

  // One open row per key (findings.store invariant): a lab finding is a point
  // event, so an earlier one still open today closes before this one opens.
  const at = moment.tz(today, tz).hour(12).toDate();
  await prisma.finding.updateMany({ where: { patientId, detectorKey: LABS_KEY, status: { in: ["OPEN", "ONGOING"] } }, data: { status: "RESOLVED", resolvedAt: at } });
  const finding = await prisma.finding.create({
    data: {
      patientId,
      detectorKey: candidate.detectorKey,
      detectorVersion: candidate.detectorVersion,
      direction: candidate.direction,
      status: "OPEN",
      severity: candidate.severity,
      peakSeverity: candidate.severity,
      evidence: candidate.evidence as object,
      baseline: (candidate.baseline ?? undefined) as object | undefined,
      firstDetectedAt: at,
      lastSeenAt: at,
    },
  });
  const base = { patientId, newReports: newIds.length, fired: true as const, findingId: finding.id, label: candidate.label };

  if (opts.notify === false) return { ...base, threadId: null, notified: false, withheld: "notify=false" };
  const pref = await getPreference(patientId);
  if (!pref.proactiveEnabled || !pref.watchOutsEnabled) return { ...base, threadId: null, notified: false, withheld: "disabled by preference" };

  const proactive = await runProactiveFor(patientId, "watch_out", { instruction: labsInstruction({ ...candidate, baseline: candidate.baseline ?? null }) });
  if ("skipped" in proactive) return { ...base, threadId: proactive.threadId ?? null, notified: false, withheld: proactive.skipped };
  await markNotified(finding.id, proactive.threadId ?? null);
  return { ...base, threadId: proactive.threadId ?? null, notified: proactive.notified };
};
