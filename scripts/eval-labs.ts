/**
 * Lab extraction eval: runs the pipeline over every PDF in a folder and, when
 * a sibling <name>.expected.json exists, scores value/flag/date accuracy.
 *
 *   npx ts-node --transpile-only scripts/eval-labs.ts [folder] [--model gpt-4.1]
 *
 * Default folder: tests/fixtures/labs. Drop real reports (never committed —
 * see .gitignore) into docs/lab-samples/ and point the script there.
 * expected.json shape: { collectedAt: "YYYY-MM-DD", results: [{ testType, result, isOutOfRange }] }
 * testType is matched via canonicalBiomarkerKey, result numerically (comma or dot).
 */
import fs from "fs";
import path from "path";
import { extractLabReport } from "../src/services/lab_extraction/extractLabs";
import { canonicalBiomarkerKey } from "../src/utils/labBiomarkers";
import { parseNumericResult } from "../src/services/lab_extraction/validateLabs";
import prisma from "../src/utility/prismaClient";

const args = process.argv.slice(2);
// --write-expected: save this run's output as <name>.expected.json. ONLY after
// you have verified every value by eye — it becomes the regression truth.
const writeExpected = args.includes("--write-expected");
const modelIdx = args.indexOf("--model");
const model = modelIdx >= 0 ? args[modelIdx + 1] : undefined;
const vIdx = args.indexOf("--verify-model");
if (vIdx >= 0) process.env.LAB_VISION_VERIFY_MODEL = args[vIdx + 1];
const positional = args.filter((a, i) => !a.startsWith("--") && (modelIdx < 0 || i !== modelIdx + 1) && (vIdx < 0 || i !== vIdx + 1));
const folder = positional[0] ?? path.join(__dirname, "..", "tests", "fixtures", "labs");

const sameValue = (a: string, b: string) => {
  const na = parseNumericResult(a), nb = parseNumericResult(b);
  if (na !== null && nb !== null) return Math.abs(na - nb) < 1e-9;
  return a.replace(/\s+/g, "").toLowerCase() === b.replace(/\s+/g, "").toLowerCase();
};

(async () => {
  const patient = await prisma.patient.findFirst({ where: { email: process.env.SEED_EMAIL ?? "antoricciardelli@gmail.com" } });
  if (!patient) throw new Error("dev patient not found");
  const pdfs = fs.readdirSync(folder).filter((f) => f.toLowerCase().endsWith(".pdf"));
  let totalExpected = 0, valueHits = 0, flagHits = 0, extra = 0, review = 0;
  for (const pdf of pdfs) {
    const buf = fs.readFileSync(path.join(folder, pdf));
    const expPath = path.join(folder, pdf.replace(/\.pdf$/i, ".expected.json"));
    const expected = fs.existsSync(expPath) ? JSON.parse(fs.readFileSync(expPath, "utf8")) : null;
    const t0 = Date.now();
    let r;
    try {
      r = await extractLabReport(buf, { firstName: "Zzz", lastName: "Zzz", dob: "1900-01-01", patientId: patient.id, model });
    } catch (e: any) {
      console.log(`\n=== ${pdf} — FAILED: ${e?.message ?? e}`);
      continue;
    }
    console.log(`\n=== ${pdf} — ${r.extraction.model}, ${r.extraction.pages}p/${r.extraction.rowCount} rows, ${r.labResults.length} results, ${r.extraction.reviewCount} to review, ${r.extraction.uncapturedRows} uncaptured → +${r.extraction.secondPassAdded} on 2nd pass, ${Date.now() - t0}ms`);
    console.log(`collectedAt: ${r.collectedAt?.toISOString().slice(0, 10) ?? "—"}${expected ? ` (expected ${expected.collectedAt}) ${r.collectedAt?.toISOString().slice(0, 10) === expected.collectedAt ? "✓" : "✗"}` : ""}`);
    const byKey = new Map(r.labResults.map((l) => [canonicalBiomarkerKey(l.testType, l.category), l]));
    for (const l of r.labResults) {
      const key = canonicalBiomarkerKey(l.testType, l.category);
      const exp = expected?.results.find((e: any) => canonicalBiomarkerKey(e.testType, e.category ?? (/(urine)/i.test(e.testType) ? "Urinalysis" : null)) === key);
      let mark = " ";
      if (exp) { mark = sameValue(exp.result, l.result) ? (exp.isOutOfRange === l.isOutOfRange ? "✓" : "~") : "✗"; }
      else if (expected) { mark = "+"; extra++; }
      if (l.needsReview) review++;
      console.log(`  ${mark} ${l.testType.padEnd(28)} ${String(l.result).padStart(8)} ${(l.units || "").padEnd(14)} ${l.referenceRange.padEnd(14)} ${l.isOutOfRange ? "OUT" : "   "} ${l.needsReview ? "REVIEW: " + l.reviewReason : ""}`);
    }
    if (writeExpected && !expected) {
      fs.writeFileSync(expPath, JSON.stringify({
        collectedAt: r.collectedAt?.toISOString().slice(0, 10) ?? null,
        results: r.labResults.map((l) => ({ testType: l.testType, result: l.result, isOutOfRange: l.isOutOfRange })),
      }, null, 2));
      console.log(`  → wrote ${path.basename(expPath)} (${r.labResults.length} results) — verify it by eye`);
    }
    if (expected) {
      for (const e of expected.results) {
        totalExpected++;
        const got = byKey.get(canonicalBiomarkerKey(e.testType, e.category ?? (/(urine)/i.test(e.testType) ? "Urinalysis" : null)));
        if (!got) { console.log(`  ✗ MISSING ${e.testType} ${e.result}`); continue; }
        if (sameValue(e.result, got.result)) { valueHits++; if (e.isOutOfRange === got.isOutOfRange) flagHits++; }
      }
    }
  }
  if (totalExpected) console.log(`\nSCORE: values ${valueHits}/${totalExpected}, flags ${flagHits}/${totalExpected}, extra ${extra}, flagged for review ${review}`);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
