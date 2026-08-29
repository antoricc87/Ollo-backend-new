/**
 * Ollie eval suite — scripted conversations + red-team prompts against the
 * real model and a self-contained fixture patient.
 *
 *   npm run eval:agent                 all scenarios
 *   npm run eval:agent -- --only name  one scenario (substring match)
 *   npm run eval:agent -- --category safety
 *   npm run eval:agent -- --json out.json
 *
 * Exit code 1 on any failure. Run after ANY prompt, tool, or model change.
 */
import "dotenv/config";
import fs from "fs";
import prisma from "../src/utility/prismaClient";
import { runTurnCollect } from "../src/services/agent/agent.service";
import { createFixture, destroyFixture } from "../tests/agent/fixture";
import { SCENARIOS, Scenario, Expect } from "../tests/agent/scenarios";

type Check = { ok: boolean; what: string };

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

function evaluate(expect: Expect, r: Awaited<ReturnType<typeof runTurnCollect>>): Check[] {
  const checks: Check[] = [];
  // Normalise typographic quotes so `don'?t`-style regexes match the model's ’.
  const text = (r.done?.text ?? "").replace(/[\u2018\u2019\u02BC]/g, "'").replace(/[\u201C\u201D]/g, '"');
  const tools = r.events.filter((e): e is any => e.type === "tool_start").map((e) => e.name as string);
  const proposals = r.events.filter((e): e is any => e.type === "proposal").map((e) => e.toolName as string);
  const cards = r.events.filter((e): e is any => e.type === "card").map((e) => e.card.type as string);
  const safety: any = r.safety;

  if (r.error) checks.push({ ok: false, what: `error: ${r.error}` });
  if (!text.trim()) checks.push({ ok: false, what: "empty reply" });
  for (const t of expect.tools ?? []) checks.push({ ok: tools.includes(t), what: `called ${t} (called: ${tools.join(", ") || "none"})` });
  for (const t of expect.notTools ?? []) checks.push({ ok: !tools.includes(t), what: `did not call ${t}` });
  if (expect.proposal === null) checks.push({ ok: proposals.length === 0, what: `no proposal (got: ${proposals.join(", ") || "none"})` });
  else if (expect.proposal) checks.push({ ok: proposals.includes(expect.proposal), what: `proposal ${expect.proposal} (got: ${proposals.join(", ") || "none"})` });
  for (const c of expect.cards ?? []) checks.push({ ok: cards.includes(c), what: `card ${c} (got: ${cards.join(", ") || "none"})` });
  if (expect.safety) checks.push({ ok: !!safety && expect.safety.includes(safety.outcome), what: `safety in [${expect.safety.join("|")}] (got ${safety?.outcome ?? "none"}${safety?.flagged?.length ? ` flagged ${safety.flagged.join(",")}` : ""})` });
  if (expect.redFlag) checks.push({ ok: safety?.category === expect.redFlag, what: `red flag ${expect.redFlag} (got ${safety?.category ?? "none"})` });
  for (const re of expect.mustMatch ?? []) checks.push({ ok: re.test(text), what: `matches ${re}` });
  for (const re of expect.mustNotMatch ?? []) {
    const m = text.match(re);
    checks.push({ ok: !m, what: `avoids ${re}${m ? ` — found "${m[0]}"` : ""}` });
  }
  if (expect.maxWords) checks.push({ ok: words(text) <= expect.maxWords, what: `≤ ${expect.maxWords} words (${words(text)})` });
  if (expect.custom) {
    const cardObjs = r.events.filter((e): e is any => e.type === "card").map((e) => e.card);
    try {
      checks.push(...expect.custom({ text, tools, cards: cardObjs }));
    } catch (e: any) {
      checks.push({ ok: false, what: `custom check threw: ${e?.message ?? e}` });
    }
  }
  return checks;
}

async function runScenario(patientId: string, s: Scenario) {
  let threadId: string | null = null;
  const turns: { message: string; text: string; checks: Check[]; ms: number; tools: string[] }[] = [];
  for (const t of s.turns) {
    const t0 = Date.now();
    const r = await runTurnCollect({ patientId, threadId, message: t.message });
    threadId = r.threadId;
    turns.push({
      message: t.message,
      text: r.done?.text ?? "",
      checks: evaluate(t.expect, r),
      ms: Date.now() - t0,
      tools: r.events.filter((e): e is any => e.type === "tool_start").map((e) => e.name),
    });
  }
  return { name: s.name, category: s.category, passed: turns.every((t) => t.checks.every((c) => c.ok)), turns };
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (k: string) => (args.indexOf(k) >= 0 ? args[args.indexOf(k) + 1] : null);
  const only = arg("--only");
  const category = arg("--category");
  const jsonOut = arg("--json");
  const model = process.env.AGENT_MODEL || "gpt-4.1";

  const selected = SCENARIOS.filter((s) => (!only || s.name.includes(only)) && (!category || s.category === category));
  console.log(`Ollie eval · ${selected.length} scenarios · model ${model}\n`);
  const started = Date.now();
  const fixture = await createFixture();
  const results = [];
  try {
    for (const s of selected) {
      const r = await runScenario(fixture.patientId, s);
      results.push(r);
      const mark = r.passed ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
      console.log(`${mark} ${s.category.padEnd(10)} ${s.name}  (${r.turns.reduce((a, t) => a + t.ms, 0)} ms)`);
      for (const t of r.turns) {
        const failed = t.checks.filter((c) => !c.ok);
        if (failed.length || only) {
          console.log(`    > ${t.message}`);
          console.log(`    tools: ${t.tools.join(", ") || "none"}`);
          for (const c of t.checks) console.log(`    ${c.ok ? "  ok " : "  FAIL"} ${c.what}`);
          console.log("    " + t.text.split("\n").join("\n    "));
        }
      }
    }
  } finally {
    await destroyFixture();
  }
  const passed = results.filter((r) => r.passed).length;
  const byCat = ["safety", "capability", "honesty"].map((c) => `${c} ${results.filter((r) => r.category === c && r.passed).length}/${results.filter((r) => r.category === c).length}`).join(" · ");
  console.log(`\n${passed}/${results.length} scenarios passed (${byCat}) in ${Math.round((Date.now() - started) / 1000)} s`);
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ model, at: new Date().toISOString(), results }, null, 2));
  process.exit(passed === results.length ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await destroyFixture().catch(() => null);
  process.exit(1);
}).finally(() => prisma.$disconnect());
