/**
 * Dev seed: two older, partial lab reports for the dev account so the merged
 * My Labs view shows history + all three freshness states.
 * Idempotent (skips if the marker report exists).
 * Run: npx ts-node --transpile-only scripts/seed-lab-history.ts
 */
import prisma from "../src/utility/prismaClient";

const EMAIL = process.env.SEED_EMAIL ?? "antoricciardelli@gmail.com";

async function main() {
  const patient = await prisma.patient.findFirst({ where: { email: EMAIL } });
  if (!patient) throw new Error(`No patient ${EMAIL}`);
  const summary = await prisma.patientSummary.findUnique({ where: { patientId: patient.id } });
  if (!summary) throw new Error("No patient summary");

  const marker = await prisma.labResultSummary.findFirst({
    where: { patientSummaryId: summary.id, labReport: { startsWith: "[seed-history]" } },
  });
  if (marker) { console.log("Seed already present, skipping."); return; }

  // 14 months ago → stale. Lipids only; LDL worse than the current report.
  await prisma.labResultSummary.create({
    data: {
      patientSummaryId: summary.id,
      collectedAt: new Date("2025-06-10T00:00:00Z"),
      createdAt: new Date("2025-06-12T09:00:00Z"),
      labReport: "[seed-history] Lipid panel: LDL well above target; HDL and triglycerides within range. Vitamin D low.",
      recommendations: { nutrition: "Cut saturated fat; add soluble fibre (oats, legumes).", exercise: "150 min/week moderate aerobic activity." },
      labResults: { create: [
        { category: "Lipid panel", testType: "LDL Cholesterol", result: "168", units: "MG/DL", referenceRange: "0-99", isOutOfRange: true, aboutTestType: "LDL is the cholesterol fraction that builds up in artery walls." },
        { category: "Lipid panel", testType: "HDL", result: "48", units: "MG/DL", referenceRange: "40-60", isOutOfRange: false, aboutTestType: "HDL carries cholesterol away from the arteries." },
        { category: "Lipid panel", testType: "Cholesterol, Total", result: "236", units: "MG/DL", referenceRange: "100-199", isOutOfRange: true, aboutTestType: "Total cholesterol in the blood." },
        { category: "Lipid panel", testType: "Triglycerides", result: "112", units: "MG/DL", referenceRange: "0-149", isOutOfRange: false, aboutTestType: "Fat circulating in the blood." },
        { category: "Vitamins", testType: "Vitamin D, 25-Hydroxy", result: "19", units: "NG/ML", referenceRange: "30-100", isOutOfRange: true, aboutTestType: "Vitamin D supports bone and immune health." },
        { category: "Iron", testType: "Ferritin", result: "88", units: "NG/ML", referenceRange: "30-400", isOutOfRange: false, aboutTestType: "Ferritin reflects stored iron." },
      ] },
    },
  });

  // 7 months ago → aging. Thyroid + inflammation, not in any other report.
  await prisma.labResultSummary.create({
    data: {
      patientSummaryId: summary.id,
      collectedAt: new Date("2026-01-15T00:00:00Z"),
      createdAt: new Date("2026-01-16T09:00:00Z"),
      labReport: "[seed-history] Thyroid and inflammatory markers all within range.",
      recommendations: { nutrition: "No changes indicated.", exercise: "Keep current routine." },
      labResults: { create: [
        { category: "Thyroid", testType: "TSH", result: "2.1", units: "MIU/L", referenceRange: "0.4-4.0", isOutOfRange: false, aboutTestType: "TSH signals the thyroid to make hormone." },
        { category: "Inflammatory Markers", testType: "hs-CRP", result: "0.8", units: "MG/L", referenceRange: "0-3.0", isOutOfRange: false, aboutTestType: "CRP rises with inflammation." },
        { category: "Iron", testType: "Ferritin", result: "74", units: "NG/ML", referenceRange: "30-400", isOutOfRange: false, aboutTestType: "Ferritin reflects stored iron." },
      ] },
    },
  });
  console.log("Seeded 2 historical lab reports.");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
