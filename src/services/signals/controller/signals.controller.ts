import { Response } from "express";
import { z } from "zod";
import Util from "../../../utils/response";
import prisma from "../../../utility/prismaClient";
import { describeFinding } from "../domain/describe";
import { listFindings } from "../model/findings.store";
import { runScanFor } from "../signals.service";

/**
 * Signals — patient-scoped. Identity ALWAYS from the verified token
 * (`request.user.id`); nothing here reads a patientId from the body.
 */

/**
 * One night as the phone rolled it up. Ranges are sanity bounds, not clinical
 * ones: their job is to keep a HealthKit glitch (a 0 ms HRV, a 40-hour sleep)
 * out of a baseline that later decides whether to interrupt someone.
 */
const Night = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  asleepMinutes: z.number().int().min(0).max(1_000).nullish(),
  hrvMs: z.number().min(1).max(400).nullish(),
  sleepingHr: z.number().min(20).max(200).nullish(),
  restingHr: z.number().min(20).max(200).nullish(),
  respiratoryRate: z.number().min(4).max(60).nullish(),
  wristTempC: z.number().min(20).max(45).nullish(),
});

const SyncBody = z.object({ nights: z.array(Night).min(1).max(120), source: z.string().max(40).optional() });

class SignalsHandler {
  /**
   * Upsert nightly vitals. Idempotent on [patientId, date] so the phone can
   * re-send a night HealthKit has since backfilled, and so a retry after a
   * dropped response cannot double-write.
   */
  syncNightly = async (request: any, response: Response) => {
    const patientId = request.user?.id;
    if (!patientId) return response.status(401).json(Util.error({}, "Unauthorized"));
    const parsed = SyncBody.safeParse(request.body);
    if (!parsed.success) return response.status(400).json(Util.error(parsed.error.flatten(), "Invalid nights"));

    const source = parsed.data.source ?? "healthkit";
    let written = 0;
    for (const night of parsed.data.nights) {
      const { date, ...vitals } = night;
      // A night with no usable numbers is not worth a row — it would only
      // dilute the baseline's `n` and make a usable baseline look ready.
      if (Object.values(vitals).every((v) => v == null)) continue;
      await prisma.nightlyVitals.upsert({
        where: { patientId_date: { patientId, date } },
        create: { patientId, date, source, ...vitals },
        update: { source, ...vitals },
      });
      written += 1;
    }
    return response.json(Util.success({ written, skipped: parsed.data.nights.length - written }, "Nights saved"));
  };

  /** The Signals screen: episodes newest first, with their evidence. */
  list = async (request: any, response: Response) => {
    const patientId = request.user?.id;
    if (!patientId) return response.status(401).json(Util.error({}, "Unauthorized"));
    const openOnly = String(request.query?.open ?? "") === "true";
    const findings = await listFindings(patientId, {
      limit: Math.min(Number(request.query?.limit ?? 50) || 50, 200),
      status: openOnly ? ["OPEN", "ONGOING"] : undefined,
    });
    // `title` / `line`: the finding in words, built in code (domain/describe.ts) — the app prints them as given.
    return response.json(Util.success({ findings: findings.map((f) => ({ ...f, ...describeFinding(f) })) }, "Findings"));
  };

  /**
   * Run the scan now. `?notify=false` records the episodes without sending
   * anything — how a device check is done without spending the week's budget.
   */
  scan = async (request: any, response: Response) => {
    const patientId = request.user?.id;
    if (!patientId) return response.status(401).json(Util.error({}, "Unauthorized"));
    const notify = String(request.query?.notify ?? "") !== "false";
    const result = await runScanFor(patientId, { notify });
    return response.json(Util.success(result, "Scan complete"));
  };
}

export default new SignalsHandler();
