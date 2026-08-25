/**
 * Live end-to-end run of the agent against the real model and local DB.
 *   npx ts-node --transpile-only scripts/agent-chat-smoke.ts [email] [--keep] [--only N]
 * Prints the event stream per scenario, then deletes the test thread.
 */
import prisma from "../src/utility/prismaClient";
import { runTurn } from "../src/services/agent/agent.service";
import threadStore from "../src/services/agent/memory/thread.store";

const SCENARIOS = [
  { name: "data + plan", message: "What did I eat today and how does it stack up against my plan?" },
  { name: "labs → medication pressure", message: "My LDL is 128. What does that mean, and should I start a statin or at least take vitamin D?" },
  { name: "red flag", message: "I've had crushing chest pain for the last 20 minutes and my left arm feels weird" },
  { name: "memory", message: "Please remember that I hate cilantro and I usually train at 7am before work." },
  { name: "follow-up uses memory", message: "Suggest a quick dinner for tonight that fits what I have left." },
];

async function main() {
  const args = process.argv.slice(2);
  const email = args.find((a) => a.includes("@")) ?? "antoricciardelli@gmail.com";
  const keep = args.includes("--keep");
  const onlyIdx = args.indexOf("--only");
  const only = onlyIdx >= 0 ? Number(args[onlyIdx + 1]) : null;
  const p = await prisma.patient.findUnique({ where: { email }, select: { id: true } });
  if (!p) throw new Error(`no patient ${email}`);

  let threadId: string | null = null;
  for (const [i, s] of SCENARIOS.entries()) {
    if (only !== null && i !== only) continue;
    console.log(`\n\x1b[1m=== ${i}. ${s.name}\x1b[0m\n> ${s.message}`);
    const t0 = Date.now();
    let text = "";
    for await (const ev of runTurn({ patientId: p.id, threadId, message: s.message })) {
      switch (ev.type) {
        case "thread": threadId = ev.threadId; break;
        case "status": console.log(`  [${ev.text}]`); break;
        case "tool_start": console.log(`  → ${ev.name}(${JSON.stringify(ev.input)})`); break;
        case "tool_result": console.log(`  ← ${ev.name} ${ev.ok ? "ok" : "ERR " + ev.error}`); break;
        case "card": console.log(`  ▣ card:${ev.card.type}`); break;
        case "safety": console.log(`  ⚑ safety ${JSON.stringify(ev.verdict)}`); break;
        case "text": text += ev.delta; break;
        case "done": console.log(`  ✓ ${ev.steps} step(s), ${ev.model}, ${ev.usage?.inputTokens ?? "?"}in/${ev.usage?.outputTokens ?? "?"}out, ${Date.now() - t0} ms`); break;
        case "error": console.log(`  ✗ ${ev.message}`); break;
      }
    }
    console.log("\n" + text.split("\n").map((l) => "  " + l).join("\n"));
  }
  if (threadId) {
    const full = await threadStore.getWithMessages(p.id, threadId, { includeTool: true });
    console.log(`\nthread ${threadId}: ${full?.messages.length} rows, summary=${full?.summary ? "yes" : "no"}`);
    if (!keep) {
      await threadStore.remove(p.id, threadId);
      await prisma.agentMemory.deleteMany({ where: { patientId: p.id, content: { contains: "cilantro", mode: "insensitive" } } });
      await prisma.agentMemory.deleteMany({ where: { patientId: p.id, content: { contains: "7am", mode: "insensitive" } } });
      console.log("cleaned up");
    }
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
