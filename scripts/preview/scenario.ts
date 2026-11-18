/**
 * LOCAL TEST SCENARIO — data signals through the REAL pipeline.
 *
 *   npx ts-node --transpile-only scripts/preview/scenario.ts <day 0–12>
 *
 * Puts the preview account (signals-preview@ollo.local) at day <k> of one
 * story and makes day <k> TODAY: it wipes the account's signal data, writes
 * the nights, weigh-ins and lab reports dated so that day k is today, then
 * runs the real morning scan for every day from day −3 to k (and the real lab
 * scan on the upload day). Nothing is written into the findings by hand — what
 * the Signals page shows is what the detectors, episodes and lifecycle decided.
 * Notes are off (notify:false): no model call, no push, nothing paid.
 *
 * The story (HRV usual ≈ 58 ± 6 ms from 60 earlier nights):
 *   nights   day 0, 1, 2 off (HRV 40)  → the dip opens on day 2 (3rd off night)
 *            day 3 off                  → still firing
 *            day 4 good                 → 1 of 4 nights back
 *            day 5 off                  → count back to 0 (one good night is not "back")
 *            day 6, 7, 8, 9 good        → 1…4 of 4 → closes day 9, back to your usual
 *   weight   78.0 kg 20 days before day 0; 74.0 on day 1 (−5.1%) → opens day 1, on record only
 *            74.6 on day 6 (−4.4%) → 1 of 2 weigh-ins back; 75.0 on day 8 → closes day 8
 *   labs     report on day 3: LDL 162 (was 128, range 0–130) and vitamin D 24
 *            (was 31, 30–100) newly outside, ferritin 88 (was 19) back inside
 *            → opens day 3, closes the next morning (one-day event)
 *   check-in day 3 they tell Ollie "Sleeping badly and tired all week" from the
 *            dip's card (linked); day 5 follow-up answer "no different"
 */
import moment from "moment-timezone";
import bcrypt from "bcryptjs";
import prisma from "../../src/utility/prismaClient";
import { runScanFor } from "../../src/services/signals/signals.service";
import { runLabScanFor } from "../../src/services/signals/labs.service";

const EMAIL = "signals-preview@ollo.local";
const TZ = "America/New_York";
const OFF_NIGHTS = new Set([0, 1, 2, 3, 5]);
const LAST_NIGHT_DAY = 12;

const k = Number(process.argv[2]);
if (!Number.isInteger(k) || k < 0 || k > LAST_NIGHT_DAY) {
  console.error("Usage: scenario.ts <day 0–12>");
  process.exit(1);
}

const today = moment().tz(TZ).format("YYYY-MM-DD");
/** Scenario day i as a local date, with day k = today. */
const D = (i: number) => moment.tz(today, TZ).subtract(k - i, "days").format("YYYY-MM-DD");
const noonOf = (i: number) => moment.tz(D(i), TZ).hour(12).toDate();

const wipe = async (id: string) => {
  await prisma.finding.deleteMany({ where: { patientId: id } });
  await prisma.nightlyVitals.deleteMany({ where: { patientId: id } });
  await prisma.encounter.deleteMany({ where: { patientId: id } });
  await prisma.agentThread.deleteMany({ where: { patientId: id } });
  await prisma.weightTracker.deleteMany({ where: { userId: id } });
  const summary = await prisma.patientSummary.findUnique({ where: { patientId: id } });
  if (summary) {
    const reports = await prisma.labResultSummary.findMany({ where: { patientSummaryId: summary.id }, select: { id: true } });
    await prisma.labResult.deleteMany({ where: { labResultSummaryId: { in: reports.map((r) => r.id) } } });
    await prisma.labResultSummary.deleteMany({ where: { patientSummaryId: summary.id } });
  }
};

const lab = (testType: string, result: string, units: string, referenceRange: string, isOutOfRange: boolean) => ({
  category: "Others",
  testType,
  result,
  units,
  referenceRange,
  isOutOfRange,
  aboutTestType: "",
});

(async () => {
  let patient = await prisma.patient.findFirst({ where: { email: EMAIL } });
  if (!patient) patient = await prisma.patient.create({ data: { email: EMAIL, password: await bcrypt.hash("preview-1234", 10), firstName: "Preview", onBoardingComplete: true, timeZone: TZ } as any });
  const id = patient.id;
  await wipe(id);

  // Nights: 60 usual before day 0, then the story up to today.
  const nights = [];
  for (let i = -60; i <= k; i++) {
    const off = OFF_NIGHTS.has(i);
    nights.push({ patientId: id, date: D(i), source: "scenario", hrvMs: off ? 40 + (Math.abs(i) % 3) : 58 + ((Math.abs(i) % 5) - 2) * 2, sleepingHr: 52, asleepMinutes: 420 });
  }
  await prisma.nightlyVitals.createMany({ data: nights });

  // Weigh-ins.
  const weighIns: [number, number][] = [[-20, 78.0], [-10, 77.2], [1, 74.0], [6, 74.6], [8, 75.0]];
  await prisma.weightTracker.create({
    data: { userId: id, weightEntries: { create: weighIns.filter(([i]) => i <= k).map(([i, kg]) => ({ createdAt: noonOf(i).toISOString(), weight: kg, unit: "kg" })) } },
  });

  // An earlier lab report (seven months back) to compare the new one against.
  const summary = (await prisma.patientSummary.findUnique({ where: { patientId: id } })) ?? (await prisma.patientSummary.create({ data: { patientId: id, immunizations: [] } as any }));
  await prisma.labResultSummary.create({
    data: {
      patientSummaryId: summary.id,
      labReport: "Earlier report",
      recommendations: [],
      createdAt: noonOf(-210),
      collectedAt: noonOf(-212),
      labResults: { create: [lab("LDL cholesterol", "128", "mg/dL", "0-130", false), lab("Vitamin D", "31", "ng/mL", "30-100", false), lab("Ferritin", "19", "ng/mL", "30-400", true)] },
    },
  });

  const log: string[] = [];
  for (let i = -3; i <= k; i++) {
    const r: any = await runScanFor(id, { notify: false, today: D(i) });
    if (i === 3) {
      // The report arrives on day 3, read the same day.
      const report = await prisma.labResultSummary.create({
        data: {
          patientSummaryId: summary.id,
          labReport: "New report",
          recommendations: [],
          createdAt: noonOf(3),
          collectedAt: noonOf(2),
          labResults: { create: [lab("LDL cholesterol", "162", "mg/dL", "0-130", true), lab("Vitamin D", "24", "ng/mL", "30-100", true), lab("Ferritin", "88", "ng/mL", "30-400", false)] },
        },
      });
      await runLabScanFor(id, { notify: false, reportIds: [report.id], today: D(3) });

      // They tap "Tell Ollie how you feel" on the dip and finish a check-in (written as its result: no model call).
      const dip = await prisma.finding.findFirst({ where: { patientId: id, detectorKey: "recovery.dip", status: { not: "RESOLVED" } } });
      if (dip) {
        const thread = await prisma.agentThread.create({ data: { patientId: id, source: "CHAT", title: null } });
        const enc = await prisma.encounter.create({
          data: { patientId: id, status: "OPEN", complaintKey: "general_unwell", protocolVersion: 1, complaintText: "Sleeping badly and tired all week.", phase: "ROUTE", slots: { severity: 5 }, askedKeys: ["severity"], redFlags: [], threadId: thread.id, createdAt: noonOf(3) },
        });
        await prisma.encounterEvent.create({ data: { encounterId: enc.id, seq: 0, kind: "assessment", payload: { possibilities: [{ condition: "Poor sleep catching up", fits: ["Tired all week"] }, { condition: "A cold coming on", fits: ["On record: overnight readings away from usual"] }] } } });
        await prisma.finding.update({ where: { id: dip.id }, data: { threadId: thread.id, encounterId: enc.id } });
      }
    }
    if (i === 5) {
      const enc = await prisma.encounter.findFirst({ where: { patientId: id, complaintKey: "general_unwell" } });
      if (enc) await prisma.encounterCheckIn.create({ data: { encounterId: enc.id, day: 2, trend: "SAME", createdAt: noonOf(5) } });
    }
    if (i >= 0) log.push(`day ${i} (${D(i)}): ${r.candidates} firing, ${r.episodesOpened} opened`);
  }

  const rows = await prisma.finding.findMany({ where: { patientId: id }, orderBy: { firstDetectedAt: "asc" } });
  console.log(`Day ${k} of the scenario = today (${today}).`);
  console.log(log.join("\n"));
  console.log("\nFindings now:");
  for (const f of rows)
    console.log(`  ${f.detectorKey.padEnd(14)} ${f.status.padEnd(9)} opened ${moment(f.firstDetectedAt).tz(TZ).format("ddd D MMM")} · quiet ${f.quietDays}${f.closeReason ? ` · closed: ${f.closeReason}` : ""}${f.encounterId ? " · linked check-in" : ""}`);
  await prisma.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
