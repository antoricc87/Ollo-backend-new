/**
 * Read a Summary of Benefits and Coverage PDF and print what the app would
 * store and show, without touching the database.
 *
 *   npx ts-node --transpile-only scripts/insurance-benefits.ts <file.pdf> [--json] [--model x]
 */
import "dotenv/config";
import fs from "fs";
import { extractBenefits } from "../src/services/insurance/extract/extractBenefits";
import { estimate, headline } from "../src/services/insurance/domain/benefits";

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--") && a.endsWith(".pdf"));
  if (!file) throw new Error("usage: insurance-benefits.ts <file.pdf> [--json] [--model x]");
  const model = args.includes("--model") ? args[args.indexOf("--model") + 1] : undefined;
  const t = Date.now();
  const { benefits } = await extractBenefits(fs.readFileSync(file), { model });
  if (args.includes("--json")) return console.log(JSON.stringify(benefits, null, 2));
  const h = headline(benefits);
  const usd = (n: number | null) => (n === null ? "—" : `$${n.toLocaleString("en-US")}`);
  console.log(`${h.planName ?? "?"} · ${h.issuer ?? "?"} · ${h.planType ?? "?"} · ${h.coverageFor ?? "?"} · ${h.period?.start ?? "?"} → ${h.period?.end ?? "?"}`);
  console.log(`summary: ${benefits.isBenefitsSummary} · ${benefits.source.engine} · ${benefits.source.pages} pages · ${benefits.source.model} · ${((Date.now() - t) / 1000).toFixed(1)} s`);
  for (const k of ["deductible", "outOfPocketMax"] as const)
    console.log(`${k}: in ${usd(h[k]?.inNetwork.individualUsd ?? null)} / ${usd(h[k]?.inNetwork.familyUsd ?? null)} · out ${usd(h[k]?.outOfNetwork.individualUsd ?? null)} / ${usd(h[k]?.outOfNetwork.familyUsd ?? null)}`);
  console.log(`referral: ${h.referralRequired} · out-of-network covered: ${h.outOfNetworkCovered}\n`);
  for (const s of h.services) console.log(`${s.label.padEnd(42)} ${String(s.inNetwork ?? "CHECK").padEnd(48)} | ${s.outOfNetwork ?? "CHECK"}`);
  console.log(`\nreview (${benefits.review.length}):`);
  for (const r of benefits.review) console.log(`  ${r.where}: ${r.why}`);
  console.log("\nestimates:");
  for (const [service, priceUsd] of [["primary_care_visit", null], ["preventive_care", null], ["imaging", 1200], ["emergency_room", 2500]] as const) {
    const e = estimate(benefits, { service, priceUsd });
    console.log(`  ${service}${priceUsd ? ` at $${priceUsd}` : ""}: ${e ? `${e.lowUsd === null ? "no dollars" : `$${e.lowUsd}–$${e.highUsd}`} · ${e.rule} · ${e.basis.join("; ")}` : "not in the summary"}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
