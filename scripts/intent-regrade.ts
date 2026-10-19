/**
 * Grade saved intent-eval replies with ONE grader, the same way for every run (Oct 19 2026). The R0
 * baseline was graded by gpt-5.5 with cards and tool results; to compare R1 like for like without
 * re-running the agent, both runs are graded here from what both files hold: the messages, the tools
 * called and the reply.
 *
 *   npx ts-node --transpile-only scripts/intent-regrade.ts <results.json> [--judge gpt-6-luna] [--effort low] [--json out.json]
 * Paid (one grading call per request) — ask before running.
 */
import "dotenv/config";
import fs from "fs";
import { getLLM } from "../src/services/agent/llm/openai.client";
import { CASES, GRADE_OUT, GRADE_SYSTEM, RECORD } from "../tests/agent/intentCases";

const args = process.argv.slice(2);
const arg = (k: string) => (args.indexOf(k) >= 0 ? args[args.indexOf(k) + 1] : undefined);
const JUDGE = arg("--judge") ?? "gpt-6-luna";
const EFFORT = (arg("--effort") ?? "low") as "none" | "low" | "medium";

(async () => {
  const rows: any[] = JSON.parse(fs.readFileSync(args[0], "utf8")).filter((r: any) => !r.error && r.reply);
  const only = arg("--keys")?.split(",");
  const todo = rows.filter((r) => !only || only.includes(r.key));
  const out: any[] = [];
  const queue = [...todo];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let r = queue.shift(); r; r = queue.shift()) {
        const c = CASES.find((x) => x.key === r.key);
        if (!c) continue;
        try {
          const g = await getLLM().json<{ analysis: string; score: number; asked: boolean; wrongAction: boolean; misses: string[] }>({
            task: "review",
            model: JUDGE,
            reasoningEffort: EFFORT,
            system: GRADE_SYSTEM,
            user: JSON.stringify({ record: RECORD, messages: c.turns, ...(c.note ? { graderNote: c.note } : {}), lastTurn: { tools: r.tools ?? [], reply: r.reply } }),
            schema: GRADE_OUT as unknown as Record<string, unknown>,
            schemaName: "intent_grade",
          });
          const askOk = c.ask === "either" || (c.ask === "must") === g.asked;
          out.push({ key: r.key, area: r.area, score: g.score, asked: g.asked, askOk, wrongAction: g.wrongAction, misses: g.misses });
        } catch (e: any) {
          out.push({ key: r.key, area: r.area, error: e?.message ?? String(e) });
        }
      }
    })
  );
  const ok = out.filter((r) => !r.error);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
  for (const area of Array.from(new Set(ok.map((r) => r.area)))) {
    const rs = ok.filter((r) => r.area === area);
    console.log(`  ${String(area).padEnd(12)} ${avg(rs.map((r) => r.score)).toFixed(2)}  asked right ${rs.filter((r) => r.askOk).length}/${rs.length}  wrong actions ${rs.filter((r) => r.wrongAction).length}`);
  }
  console.log(`ALL ${avg(ok.map((r) => r.score)).toFixed(2)}/5 over ${ok.length} · asked right ${ok.filter((r) => r.askOk).length}/${ok.length} · wrong actions ${ok.filter((r) => r.wrongAction).length} · errors ${out.length - ok.length} · judge ${JUDGE}:${EFFORT}`);
  const j = arg("--json");
  if (j) fs.writeFileSync(j, JSON.stringify(out, null, 2));
  process.exit(0);
})();
