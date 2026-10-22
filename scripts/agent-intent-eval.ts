/**
 * Does Ollie do what the person MEANT — in every area? (R0 of docs/ollie-request-handling-plan.md, Oct 19 2026)
 *
 * About fifty requests across food, workouts, labs, check-ins, vitals, insurance, the care team and plain
 * questions, each run through the WHOLE agent on the eval fixture, then graded by a separate model against
 * the request's intent. Some are deliberately ambiguous: for a few a question is the right answer, for most
 * a sensible default is. Ruling (Oct 19): no area may score below its baseline — this is that baseline.
 *
 * Also measures speed and tokens per turn, by kind of turn:
 *   ordinary = only read or chatted · acting = wrote, prepared or designed something · design = a whole
 *   week / meal plan.
 *
 *   npx ts-node --transpile-only scripts/agent-intent-eval.ts [--only key|area] [--sample N] [--no-grade] [--json out.json] [--concurrency 3]
 *   --sample N   the first N requests of each area (a cheap cross-area check)
 *   --no-grade   run only; grade later with scripts/intent-regrade.ts (so two runs are graded alike)
 *
 * Needs the local DB (fixture patient) and OpenAI keys. Writes are proposals: nothing is confirmed.
 */
import "dotenv/config";
import fs from "fs";
import prisma from "../src/utility/prismaClient";
import { runTurnCollect } from "../src/services/agent/agent.service";
import { registry } from "../src/services/agent/tools";
import { getLLM } from "../src/services/agent/llm/openai.client";
import { createFixture, destroyFixture } from "../tests/agent/fixture";
import { CASES, GRADE_OUT, GRADE_SYSTEM, RECORD, type Case } from "../tests/agent/intentCases";

const args = process.argv.slice(2);
const arg = (k: string) => (args.indexOf(k) >= 0 ? args[args.indexOf(k) + 1] : undefined);
// The grader: a strong model that is NOT the one being graded. gpt-6.1-sol ($2 / $10 per M) replaced
// gpt-5.5 ($5 / $30) on Oct 19 2026 — the grader had been the most expensive model in the run.
const JUDGE = process.env.INTENT_EVAL_JUDGE ?? "gpt-6.1-sol";

const short = (v: unknown, n = 600) => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > n ? `${s.slice(0, n)}…` : s;
};

const kindOf = (tools: string[]) => {
  if (tools.some((t) => t === "generate_workout_plan" || t === "generate_meal_plan")) return "design";
  if (tools.some((t) => ["write", "generate"].includes(registry.get(t)?.risk ?? ""))) return "acting";
  return "ordinary";
};

async function runCase(patientId: string, c: Case) {
  await prisma.encounter.deleteMany({ where: { patientId } });
  if (c.setup) await c.setup(patientId);
  let threadId: string | null = null;
  let last: Awaited<ReturnType<typeof runTurnCollect>> | null = null;
  let ms = 0;
  for (const message of c.turns) {
    const t0 = Date.now();
    last = await runTurnCollect({ patientId, threadId, message });
    ms = Date.now() - t0;
    threadId = last.threadId;
  }
  const r = last!;
  const ev = r.events as any[];
  const tools = ev.filter((e) => e.type === "tool_start").map((e) => e.name as string);
  // The last turn's tool results, as saved (the stream carries only ok/error).
  const rows = threadId ? await prisma.agentMessage.findMany({ where: { threadId }, orderBy: { seq: "asc" }, select: { role: true, content: true } }) : [];
  const lastUser = rows.map((x) => x.role).lastIndexOf("USER");
  const results = rows.slice(lastUser + 1).filter((x) => x.role === "TOOL").map((x) => short(x.content, 500));
  const cards = ev.filter((e) => e.type === "card").map((e) => ({ type: e.card.type, title: e.card.title, data: short(e.card.data, 700) }));
  const proposals = ev.filter((e) => e.type === "proposal").map((e) => ({ tool: e.toolName, title: e.title ?? e.proposal?.title, summary: e.summary ?? e.proposal?.summary }));
  const reply = r.done?.text ?? r.error ?? "";
  if (args.includes("--no-grade")) return { key: c.key, area: c.area, kind: kindOf(tools), ms, tokensIn: r.done?.usage?.inputTokens ?? null, tokensOut: r.done?.usage?.outputTokens ?? null, model: r.done?.model ?? null, tools, messages: c.turns, ask: c.ask, note: c.note ?? null, reply, cards, proposals, results, error: r.error, score: null };
  const grade = await getLLM().json<{ analysis: string; score: number; asked: boolean; wrongAction: boolean; misses: string[] }>({
    system: GRADE_SYSTEM,
    user: JSON.stringify({ record: RECORD, messages: c.turns, ...(c.note ? { graderNote: c.note } : {}), lastTurn: { tools, results, cards, proposals, reply } }),
    schema: GRADE_OUT,
    schemaName: "intent_grade",
    task: "review",
    model: JUDGE,
    reasoningEffort: "medium",
  });
  const askOk = c.ask === "either" || (c.ask === "must") === grade.asked;
  return { key: c.key, area: c.area, kind: kindOf(tools), ms, tokensIn: r.done?.usage?.inputTokens ?? null, tokensOut: r.done?.usage?.outputTokens ?? null, model: r.done?.model ?? null, tools, score: grade.score, asked: grade.asked, askOk, wrongAction: grade.wrongAction, misses: grade.misses, reply, analysis: grade.analysis, error: r.error };
}

(async () => {
  const only = arg("--only");
  const sample = Number(arg("--sample") ?? 0);
  const cases = CASES.filter((c) => !only || c.key.includes(only) || c.area === only).filter((c, _i, list) => !sample || list.filter((x) => x.area === c.area).indexOf(c) < sample);
  const conc = Number(arg("--concurrency") ?? 3);
  const { patientId } = (await createFixture()) as any;
  const results: any[] = [];
  const log = (r: any) =>
    console.log(`${r.error ? "ERR" : r.askOk ? "ok " : "Q! "} ${r.score ?? "-"}/5 ${r.wrongAction ? "W" : " "} ${String(r.area).padEnd(11)} ${String(r.key).padEnd(24)} ${String(r.kind ?? "").padEnd(8)} ${((r.ms ?? 0) / 1000).toFixed(1).padStart(5)} s ${String(r.tokensIn ?? "").padStart(6)} tok  ${(r.misses ?? []).slice(0, 1).join("").slice(0, 110)}`);
  // Cases with a setup seed check-ins, which shape other requests patient-wide: run those alone, after.
  const parallel = cases.filter((c) => !c.setup);
  const serial = cases.filter((c) => c.setup);
  const queue = [...parallel];
  try {
    await Promise.all(
      Array.from({ length: conc }, async () => {
        for (let c = queue.shift(); c; c = queue.shift()) {
          const r = await runCase(patientId, c).catch((e) => ({ key: c.key, area: c.area, error: e?.message ?? String(e) }));
          results.push(r);
          log(r);
        }
      })
    );
    for (const c of serial) {
      const r = await runCase(patientId, c).catch((e) => ({ key: c.key, area: c.area, error: e?.message ?? String(e) }));
      results.push(r);
      log(r);
    }
  } finally {
    await destroyFixture().catch(() => {});
  }

  if (args.includes("--no-grade")) {
    const out = arg("--json");
    if (out) fs.writeFileSync(out, JSON.stringify(results, null, 2));
    const ran = results.filter((r) => !r.error);
    const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? NaN;
    for (const kind of ["ordinary", "acting", "design"]) {
      const rs = ran.filter((r) => r.kind === kind);
      if (rs.length) console.log(`  ${kind.padEnd(9)} n=${rs.length} median ${(med(rs.map((r) => r.ms)) / 1000).toFixed(1)} s · median input tokens ${med(rs.filter((r) => r.tokensIn).map((r) => r.tokensIn))}`);
    }
    console.log(`RAN ${ran.length}/${results.length} (ungraded) · errors ${results.length - ran.length}`);
    process.exit(0);
  }
  const ok = results.filter((r) => !r.error && typeof r.score === "number");
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
  const pct = (xs: number[], p: number) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN;
  };
  console.log(`\nby area (score 1–5 · questions right · wrong actions):`);
  for (const area of Array.from(new Set(ok.map((r) => r.area)))) {
    const rs = ok.filter((r) => r.area === area);
    console.log(`  ${area.padEnd(12)} ${avg(rs.map((r) => r.score)).toFixed(2)}  ${rs.filter((r) => r.askOk).length}/${rs.length}  ${rs.filter((r) => r.wrongAction).length}`);
  }
  console.log(`by kind of turn (median / slowest 10% seconds · median input tokens):`);
  for (const kind of ["ordinary", "acting", "design"]) {
    const rs = ok.filter((r) => r.kind === kind);
    if (!rs.length) continue;
    console.log(`  ${kind.padEnd(9)} n=${String(rs.length).padStart(2)}  ${(pct(rs.map((r) => r.ms), 0.5) / 1000).toFixed(1)} / ${(pct(rs.map((r) => r.ms), 0.9) / 1000).toFixed(1)} s  ${pct(rs.filter((r) => r.tokensIn).map((r) => r.tokensIn), 0.5)} tok`);
  }
  console.log(`ALL: ${avg(ok.map((r) => r.score)).toFixed(2)}/5 over ${ok.length} · questions right ${ok.filter((r) => r.askOk).length}/${ok.length} · wrong actions ${ok.filter((r) => r.wrongAction).length} · errors ${results.length - ok.length} · model ${ok[0]?.model ?? "?"} · judge ${JUDGE}`);
  const out = arg("--json");
  if (out) fs.writeFileSync(out, JSON.stringify(results, null, 2));
  process.exit(0);
})();
