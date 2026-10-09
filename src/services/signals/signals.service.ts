import moment from "moment-timezone";
import prisma from "../../utility/prismaClient";
import { safeTz } from "../agent/memory/dates";
import { getPreference, runProactiveFor, signalInstruction, SIGNAL_SCAN_HOUR } from "../agent/proactive/proactive.service";
import { detectorBy } from "./domain/registry";
import { runDay } from "./domain/run";
import { collect } from "./model/collect";
import { markNotified, notifyState, openEpisodes, persistDay } from "./model/findings.store";

/**
 * THE DAILY SCAN — run the detectors for one patient, write the episodes down,
 * and let the budget decide whether any of it is worth an interruption.
 *
 * Most days this writes nothing and sends nothing, and that is the point: the
 * run it replaced (`daily_checkin`) had to produce a note every day because it
 * was driven by a clock rather than by the data.
 *
 * The record and the notification are separate (ruling 2026-09-24): every
 * episode is stored whether or not anyone is told, because the timeline a
 * clinician reads must not have holes where the budget happened to be spent.
 */

export type ScanResult = {
  patientId: string;
  today: string;
  candidates: number;
  episodesOpened: number;
  notified: { detectorKey: string; threadId: string | null }[];
  withheld: { detectorKey: string; reason: string }[];
};

export const runScanFor = async (patientId: string, opts: { notify?: boolean } = {}): Promise<ScanResult | { skipped: string }> => {
  const patient = await prisma.patient.findUnique({ where: { id: patientId }, select: { timeZone: true } });
  if (!patient) return { skipped: "no patient" };
  const tz = safeTz(patient.timeZone);
  const today = moment().tz(tz).format("YYYY-MM-DD");

  const [input, open, notify] = await Promise.all([collect(patientId, today, tz), openEpisodes(patientId, tz), notifyState(patientId, today, tz)]);
  const run = runDay(input, open.episodes, notify);
  const ids = await persistDay(patientId, run, today, tz, open);

  const result: ScanResult = {
    patientId,
    today,
    candidates: run.candidates.length,
    episodesOpened: run.opened.length,
    notified: [],
    withheld: run.decisions.filter((d) => !d.notify).map((d) => ({ detectorKey: d.candidate.detectorKey, reason: d.reason })),
  };
  if (opts.notify === false) return result;

  for (const decision of run.decisions.filter((d) => d.notify)) {
    const candidate = decision.candidate;
    const findingId = ids[candidate.detectorKey];
    try {
      const proactive = await runProactiveFor(patientId, "signal", {
        instruction: signalInstruction({ detectorKey: candidate.detectorKey, label: candidate.label, severity: candidate.severity, evidence: candidate.evidence, baseline: candidate.baseline ?? null, against: detectorBy(candidate.detectorKey)?.against ?? "rule" }),
        title: candidate.direction === "POSITIVE" ? "Worth knowing" : "Something changed",
      });
      const threadId = "threadId" in proactive ? proactive.threadId ?? null : null;
      // Stamped only once the note actually exists: a failed run must be
      // retried tomorrow, not silently counted as said.
      if (!("skipped" in proactive) && findingId) await markNotified(findingId, threadId);
      if (!("skipped" in proactive)) result.notified.push({ detectorKey: candidate.detectorKey, threadId });
    } catch (e) {
      console.error(`signal notify failed for ${patientId} (${candidate.detectorKey})`, e);
    }
  }
  return result;
};

/** Logged anything in the last two weeks? Same bar the other proactive runs use. */
const recentlyActive = async (patientId: string) => {
  const since = moment().subtract(14, "days").format("YYYY-MM-DD");
  const [food, threads] = await Promise.all([
    prisma.dailyFood.count({ where: { userId: patientId, date: { gte: since } } }),
    prisma.agentThread.count({ where: { patientId, source: "CHAT", lastMessageAt: { gte: new Date(since) } } }),
  ]);
  return food > 0 || threads > 0;
};

/**
 * Called once per UTC hour by the agent tick: scan every patient whose LOCAL
 * clock has just reached the scan hour. Sequential — one model at a time, and
 * most patients never reach the model at all.
 */
export const runSignalScanDue = async (now = new Date()) => {
  const patients = await prisma.patient.findMany({
    where: { subAccountOf: null, onBoardingComplete: true },
    select: { id: true, timeZone: true, agentPreference: { select: { proactiveEnabled: true } } },
  });
  let scanned = 0;
  let episodesOpened = 0;
  let notified = 0;
  for (const p of patients) {
    if (moment(now).tz(safeTz(p.timeZone)).hour() !== SIGNAL_SCAN_HOUR) continue;
    if (p.agentPreference && !p.agentPreference.proactiveEnabled) continue;
    if (!(await recentlyActive(p.id))) continue;
    try {
      const r = await runScanFor(p.id);
      scanned += 1;
      if (!("skipped" in r)) {
        episodesOpened += r.episodesOpened;
        notified += r.notified.length;
      }
    } catch (e) {
      console.error(`signal scan failed for ${p.id}`, e);
    }
  }
  return { scanned, episodesOpened, notified };
};

export { getPreference };
