/** Smoke test for the agent stores against the local DB. Cleans up after itself. */
import assert from "assert";
import prisma from "../src/utility/prismaClient";
import threadStore from "../src/services/agent/memory/thread.store";
import memoryStore from "../src/services/agent/memory/memory.store";
import { audit } from "../src/services/agent/memory/audit";

async function main() {
  const p = await prisma.patient.findUnique({ where: { email: "antoricciardelli@gmail.com" } });
  assert(p, "dev patient missing");
  const pid = p.id;

  // threads
  const t = await threadStore.create(pid);
  await threadStore.append(t.id, [{ role: "USER", content: "what should I eat tonight?" }]);
  await threadStore.append(t.id, [
    { role: "ASSISTANT", content: "", toolCalls: [{ id: "c1", name: "get_meals", input: { range: "today" } }] },
    { role: "TOOL", toolCallId: "c1", toolName: "get_meals", content: JSON.stringify([{ kcal: 635 }]) },
    { role: "ASSISTANT", content: "You have ~1,000 kcal left; salmon + veg would fit.", cards: [{ type: "meal_suggestion" }] },
  ]);
  await threadStore.append(t.id, [{ role: "USER", content: "and tomorrow?" }, { role: "ASSISTANT", content: "Sure —" }]);
  const full = await threadStore.getWithMessages(pid, t.id, { includeTool: true });
  assert.equal(full!.messages.length, 6);
  assert.deepEqual(full!.messages.map((m) => m.seq), [1, 2, 3, 4, 5, 6]);
  assert.equal(full!.title, "what should I eat tonight?");
  const visible = await threadStore.getWithMessages(pid, t.id);
  assert.equal(visible!.messages.length, 5, "tool rows hidden by default");

  // window: 1 verbatim user turn → starts at seq 5, seq 1-4 unsummarized
  const w1 = await threadStore.contextWindow(t.id, 1);
  assert.deepEqual(w1.messages.map((m) => m.seq), [5, 6]);
  assert.deepEqual(w1.unsummarized.map((m) => m.seq), [1, 2, 3, 4]);
  await threadStore.setSummary(t.id, "User asked for dinner ideas; ~1,000 kcal left.", 4);
  const w2 = await threadStore.contextWindow(t.id, 10);
  assert.equal(w2.summary, "User asked for dinner ideas; ~1,000 kcal left.");
  assert.deepEqual(w2.messages.map((m) => m.seq), [5, 6], "summarized turns excluded");

  // ownership
  assert.equal(await threadStore.get("00000000-0000-0000-0000-000000000000", t.id), null);
  assert.equal(await threadStore.remove("00000000-0000-0000-0000-000000000000", t.id), false);
  const list = await threadStore.list(pid);
  assert(list.some((x) => x.id === t.id));

  // memories
  const m1 = await memoryStore.remember(pid, { content: "Hates cilantro", category: "PREFERENCE" });
  const m1b = await memoryStore.remember(pid, { content: "  hates   cilantro " });
  assert.equal(m1.id, m1b.id, "dedupes case/whitespace");
  await memoryStore.remember(pid, { content: "Trains at 7am on weekdays", category: "ROUTINE" });
  const hits = await memoryStore.recall(pid, "can you plan something with cilantro and lime?");
  assert.equal(hits[0].id, m1.id);
  assert(await memoryStore.forget(pid, m1.id));
  assert.equal((await memoryStore.listActive(pid)).some((m) => m.id === m1.id), false);

  // audit
  const a = await audit(pid, "tool_call", { threadId: t.id, toolName: "get_meals", payload: { range: "today" } });
  assert(a && a.id);

  // cleanup
  await threadStore.remove(pid, t.id);
  await prisma.agentMemory.deleteMany({ where: { patientId: pid, content: { in: ["Hates cilantro", "Trains at 7am on weekdays"] } } });
  await prisma.agentAuditLog.deleteMany({ where: { id: a!.id } });
  assert.equal(await prisma.agentMessage.count({ where: { threadId: t.id } }), 0, "cascade delete");
  console.log("agent store smoke: OK");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
