import { z } from "zod";
import prisma from "../../../utility/prismaClient";
import { buildCurrentLabs, labFreshness } from "../../../utils/labBiomarkers";
import { defineTool } from "./registry";

export const getLabs = defineTool({
  name: "get_labs",
  description:
    "Current lab picture: the latest value per biomarker across all uploaded reports, with the lab's reference range, whether the lab flagged it, test date and freshness (current ≤6mo / aging ≤12mo / stale), plus history per biomarker when asked. Filter by biomarker keys or to flagged only. Explain what a biomarker measures and lifestyle levers; never interpret results into a diagnosis.",
  schema: z.object({
    keys: z.array(z.string()).optional().describe("Canonical biomarker keys to return, e.g. ['ldl','hba1c']. Omit for all."),
    flaggedOnly: z.boolean().optional().describe("Only values outside the reference range. Default false."),
    includeHistory: z.boolean().optional().describe("Include prior values per biomarker. Default false."),
  }),
  risk: "read",
  async run(ctx, input) {
    const summary = await prisma.patientSummary.findUnique({
      where: { patientId: ctx.patientId },
      include: { labResults: { include: { labResults: true } } },
    });
    const current = buildCurrentLabs((summary?.labResults ?? []) as any);
    const wanted = input.keys?.map((k) => k.toLowerCase().trim());
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
      reports: (summary?.labResults ?? []).length,
      returned: rows.length,
      ...(wanted && rows.length === 0 ? { note: `no biomarker matched ${wanted.join(", ")}; known keys: ${current.map((b) => b.key).slice(0, 40).join(", ")}` } : {}),
      biomarkers: rows,
    };
    return { result, cards: rows.length ? [{ type: "labs", title: input.flaggedOnly ? "Flagged labs" : "Labs", data: result }] : [] };
  },
});
