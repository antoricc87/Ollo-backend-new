/**
 * One-off (Sep 15 2026): lab report summaries used to be model-written and
 * came with nutrition/exercise advice tied to the results. Rewrite every
 * stored summary from its values (reportSummary.ts) and clear the advice.
 * Reads already rebuild the summary; this cleans the rows for raw consumers.
 * Run: npx ts-node --transpile-only scripts/backfill-lab-report-summary.ts [--dry]
 */
import prisma from "../src/utility/prismaClient";
import { buildLabReportSummary } from "../src/services/lab_extraction/reportSummary";

const dry = process.argv.includes("--dry");

async function main() {
  const reports = await prisma.labResultSummary.findMany({ include: { labResults: true } });
  let changed = 0;
  for (const r of reports) {
    const labReport = buildLabReportSummary(r.labResults);
    const advice = r.recommendations;
    const hasAdvice = !!advice && typeof advice === "object" && Object.keys(advice as object).length > 0;
    if (r.labReport === labReport && !hasAdvice) continue;
    changed++;
    if (dry) {
      console.log(`${r.id}\n  before: ${r.labReport.slice(0, 140)}\n  after:  ${labReport}`);
      continue;
    }
    await prisma.labResultSummary.update({ where: { id: r.id }, data: { labReport, recommendations: {} } });
  }
  console.log(`${dry ? "Would rewrite" : "Rewrote"} ${changed} of ${reports.length} lab report(s).`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
