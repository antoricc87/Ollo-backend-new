/**
 * Print the guideline-based lab panel for a patient.
 *   npx ts-node --transpile-only scripts/labs-panel.ts <email> [--json]
 */
import "dotenv/config";
import prisma from "../src/utility/prismaClient";
import LabsJourneyService from "../src/services/labs_journey/model/labsJourney.model";

(async () => {
  const email = process.argv[2];
  if (!email) throw new Error("usage: labs-panel.ts <email> [--json]");
  const p = await prisma.patient.findUnique({ where: { email }, select: { id: true } });
  if (!p) throw new Error("patient not found");
  const panel = await LabsJourneyService.getPanel(p.id);
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(panel, null, 2));
  } else {
    console.log(JSON.stringify({ profile: panel.profile, counts: panel.counts, journey: panel.journey }));
    for (const i of panel.items)
      console.log(
        `- [${i.priority.padEnd(8)}] ${i.kind.padEnd(9)} ${i.title.padEnd(42)} ${i.source.org} ${i.source.grade ?? ""} ${i.source.year}  covered=${i.covered ? i.covered.freshness : "-"}`
      );
    console.log("\n" + panel.checklistText);
  }
  await prisma.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
