import { z } from "zod";
import prisma from "../../../utility/prismaClient";
import { buildCurrentLabs, canonicalBiomarkerKey, labFreshness } from "../../../utils/labBiomarkers";
import { defineTool } from "./registry";

export const getLabs = defineTool({
  name: "get_labs",
  description:
    "Current lab picture: the latest value per biomarker across all uploaded reports, with the lab's reference range, whether the lab flagged it, test date and freshness (current ≤6mo / aging ≤12mo / stale), plus history per biomarker when asked. Filter by biomarker keys or to flagged only. With reportDate: every value on that ONE report as uploaded, in range or not. Explain what a biomarker measures and lifestyle levers; never interpret results into a diagnosis or a verdict.",
  schema: z.object({
    keys: z.array(z.string()).optional().describe("Canonical biomarker keys to return, e.g. ['ldl','hba1c']. Omit for all."),
    flaggedOnly: z.boolean().optional().describe("Only values outside the reference range. Default false."),
    includeHistory: z.boolean().optional().describe("Include prior values per biomarker. Default false."),
    reportDate: z.string().optional().describe("Test date (YYYY-MM-DD) of ONE report to read as uploaded — use when they ask about a specific report (\"explain my lab report from 3 Aug 2026\"). Omit for the current picture."),
  }),
  risk: "read",
  async run(ctx, input) {
    const summary = await prisma.patientSummary.findUnique({
      where: { patientId: ctx.patientId },
      include: { labResults: { include: { labResults: true } } },
    });
    const reports = summary?.labResults ?? [];
    const wanted = input.keys?.map((k) => k.toLowerCase().trim());
    if (input.reportDate) return readReport(reports, input.reportDate, !!input.flaggedOnly, wanted);
    const current = buildCurrentLabs(reports as any);
    const now = new Date();
    const rows = current
      .filter((b) => (!wanted || wanted.includes(b.key)) && (!input.flaggedOnly || b.isOutOfRange))
      .map((b) => ({
        key: b.key,
        testType: b.testType,
        category: b.category,
        result: b.result,
        units: b.units ?? null,
        referenceRange: b.referenceRange,
        flaggedByLab: b.isOutOfRange,
        collectedAt: b.collectedAt.slice(0, 10),
        freshness: labFreshness(b.collectedAt, now),
        ...(input.includeHistory
          ? { history: b.history.map((h) => ({ collectedAt: h.collectedAt.slice(0, 10), result: h.result, units: h.units, flaggedByLab: h.isOutOfRange })) }
          : {}),
      }));
    const result = {
      totalBiomarkers: current.length,
      reports: reports.length,
      returned: rows.length,
      ...(wanted && rows.length === 0 ? { note: `no biomarker matched ${wanted.join(", ")}; known keys: ${current.map((b) => b.key).slice(0, 40).join(", ")}` } : {}),
      biomarkers: rows,
    };
    return { result, cards: rows.length ? [{ type: "labs", title: input.flaggedOnly ? "Flagged labs" : "Labs", data: result }] : [] };
  },
});

const DAY_MS = 86400000;
const testDay = (r: { collectedAt: Date | null; createdAt: Date }) => (r.collectedAt ?? r.createdAt).toISOString().slice(0, 10);

/** One report as uploaded. Dates match exactly, else within a day (the app prints local dates; rows store UTC). */
const readReport = (reports: any[], reportDate: string, flaggedOnly: boolean, wanted?: string[]) => {
  const target = Date.parse(reportDate.slice(0, 10));
  const report =
    reports.find((r) => testDay(r) === reportDate.slice(0, 10)) ??
    reports.find((r) => Math.abs(Date.parse(testDay(r)) - target) <= DAY_MS);
  if (!report) return { result: { note: `no report with test date ${reportDate}`, reportDates: reports.map(testDay).sort().reverse() } };
  const seen = new Map<string, number>();
  const rows = (report.labResults as any[])
    .map((l) => ({ l, key: canonicalBiomarkerKey(l.testType, l.category) }))
    .filter(({ l, key }) => (!flaggedOnly || l.isOutOfRange) && (!wanted || wanted.includes(key)))
    .map(({ l, key }) => {
      const n = seen.get(key) ?? 0;
      seen.set(key, n + 1);
      return {
        key: n ? `${key} #${n + 1}` : key,
        testType: l.testType,
        category: l.category,
        result: l.result,
        units: l.units ?? null,
        referenceRange: l.referenceRange,
        flaggedByLab: l.isOutOfRange,
        collectedAt: testDay(report),
        ...(l.needsReview ? { checkAgainstPdf: true } : {}),
      };
    });
  const result = {
    report: { testDate: testDay(report), values: report.labResults.length, flagged: report.labResults.filter((l: any) => l.isOutOfRange).length },
    totalBiomarkers: report.labResults.length,
    returned: rows.length,
    biomarkers: rows,
  };
  return { result, cards: rows.length ? [{ type: "labs", title: `Report · ${testDay(report)}`, data: result }] : [] };
};
