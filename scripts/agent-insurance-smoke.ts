/**
 * Insurance through Ollie, live: no record → card only → a benefits summary
 * read from a PDF → copay / coinsurance / coverage-verdict questions. Runs on
 * the eval fixture (eval-ollie@ollo.test), destroyed after.
 *   npx ts-node --transpile-only scripts/agent-insurance-smoke.ts <summary.pdf>
 */
import "dotenv/config";
import assert from "assert";
import fs from "fs";
import { runTurnCollect } from "../src/services/agent/agent.service";
import InsuranceService from "../src/services/insurance/model/insurance.model";
import { createFixture, destroyFixture } from "../tests/agent/fixture";

const log = (s: string) => console.log(s);
const today = new Date().toISOString().slice(0, 10);
/** Words Ollie must never use about a plan: a coverage verdict, a promise, or a plan recommendation. */
const VERDICT = /\byou(?:'re| are) covered\b|\bis covered\b|\byou will pay\b|\byou'll pay\b|\b(?:is|are|it's) guaranteed\b|\bI recommend (?:this|that|a) plan\b/i;

async function main() {
  const pdf = process.argv[2];
  if (!pdf) throw new Error("usage: agent-insurance-smoke.ts <summary.pdf>");
  await destroyFixture();
  const { patientId: pid } = await createFixture();
  const turn = async (message: string, needsTool = true) => {
    const r = await runTurnCollect({ patientId: pid, threadId: null, message });
    const calls = r.events.filter((e): e is any => e.type === "tool_start").map((c) => c.name);
    const text = (r.done?.text ?? "").replace(/[’]/g, "'");
    log(`\n> ${message}\n  tools=${JSON.stringify(calls)}${r.error ? " ERROR " + r.error : ""}\n  ${text.split("\n").join("\n  ")}`);
    assert(!needsTool || calls.includes("get_insurance"), "get_insurance was not called");
    assert(!VERDICT.test(text), `verdict wording: ${text.match(VERDICT)?.[0]}`);
    return text;
  };

  try {
    let t = await turn("What's my copay for a specialist?");
    assert(!/\$\s?\d/.test(t), "a dollar figure with no insurance on file");

    await InsuranceService.saveCard(pid, { provider: "Aetna", planType: "PPO", memberId: "W123456789", groupNumber: "0012345" }, today);
    t = await turn("What's my deductible?");
    assert(!/\$\s?\d/.test(t), "a dollar figure with only the card on file");

    const view = await InsuranceService.saveBenefits(pid, fs.readFileSync(pdf), "summary.pdf", today);
    log(`\nsummary stored: ${view.benefits?.planName} · ${view.benefits?.services.length} services · ${view.benefits?.needsReview} to check · insurer kept: ${view.provider}`);
    assert(view.provider === "Aetna", "the summary overwrote the insurer the member chose");
    assert(view.benefits && view.benefits.services.length >= 20, "too few services read");

    const pcp = await InsuranceService.estimateFor(pid, { service: "primary_care_visit" }, today);
    const flat = pcp?.estimate?.lowUsd;
    assert(typeof flat === "number" && flat === pcp?.estimate?.highUsd, "primary care should be a flat copay on the sample");
    t = await turn("How much is a regular doctor visit on my plan?");
    assert(new RegExp(`\\$\\s?${flat}\\b`).test(t), `the reply does not carry the summary's $${flat}`);
    assert(/estimate|summary/i.test(t), "no estimate / summary framing");

    t = await turn("I need an MRI. What will it cost me?");
    assert(!/\$\s?[1-9]\d{2,}/.test(t.replace(/deductible[^.]*\./gi, "")), "a price was invented for the MRI");

    t = await turn("The imaging centre quoted me $1,200 for the MRI. What's my share?");
    const mri = await InsuranceService.estimateFor(pid, { service: "imaging", priceUsd: 1200 }, today);
    for (const n of [mri!.estimate!.lowUsd, mri!.estimate!.highUsd]) assert(t.replace(/,/g, "").includes(`$${n}`), `the reply lacks the computed $${n}`);

    t = await turn("Is Dr. Patel at Midtown Cardiology in my network?", false);
    assert(!/\byes\b|Patel is (?:in|out)/i.test(t), "claimed a network status");
    log("\nAll insurance checks passed.");
  } finally {
    await destroyFixture();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
