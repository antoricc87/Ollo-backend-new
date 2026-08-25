/**
 * One-off: legacy LabResultSummary rows have no collectedAt (test date).
 * Backfill it from createdAt (upload time) so the merged labs view is dated.
 * Run: npx ts-node --transpile-only scripts/backfill-lab-collected-at.ts
 */
import prisma from "../src/utility/prismaClient";

async function main() {
  const updated = await prisma.$executeRaw`
    UPDATE "LabResultSummary" SET "collectedAt" = "createdAt" WHERE "collectedAt" IS NULL
  `;
  console.log(`Backfilled collectedAt on ${updated} lab report(s).`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
