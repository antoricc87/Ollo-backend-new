import { z } from "zod";
import memoryStore, { MEMORY_CATEGORIES } from "../memory/memory.store";
import { defineTool } from "./registry";

export const remember = defineTool({
  name: "remember",
  description:
    "Save one durable fact about the user for future conversations — a preference, routine, constraint, life context, or feedback on your advice. Only for things that will still matter next week; never health data that is already tracked, and never anything the user asked you not to keep. One short sentence in the user's terms.",
  schema: z.object({
    content: z.string().min(3).max(240).describe("e.g. 'Hates cilantro', 'Travels Tue–Thu most weeks and eats out'"),
    category: z.enum(MEMORY_CATEGORIES as [string, ...string[]]).describe("PREFERENCE | ROUTINE | CONSTRAINT | CONTEXT | FEEDBACK"),
  }),
  risk: "memory",
  async run(ctx, input) {
    const m = await memoryStore.remember(ctx.patientId, { content: input.content, category: input.category as any });
    return { result: { saved: true, id: m.id, content: m.content }, cards: [{ type: "memory_saved", data: { id: m.id, content: m.content, category: m.category } }] };
  },
});

export const recallMemory = defineTool({
  name: "recall_memory",
  description: "Search what you have remembered about the user beyond the few shown in the snapshot. Use when a past preference or context might change your answer.",
  schema: z.object({ query: z.string().min(2).describe("Keywords to search, e.g. 'breakfast travel'") }),
  risk: "read",
  async run(ctx, input) {
    const hits = await memoryStore.recall(ctx.patientId, input.query, 10);
    return { result: hits.map((m) => ({ id: m.id, category: m.category, content: m.content, since: m.createdAt.toISOString().slice(0, 10) })) };
  },
});

export const forgetMemory = defineTool({
  name: "forget_memory",
  description: "Remove a remembered fact when the user asks you to forget it or says it is no longer true.",
  schema: z.object({ memoryId: z.string().describe("id from the snapshot or recall_memory") }),
  risk: "memory",
  async run(ctx, input) {
    const ok = await memoryStore.forget(ctx.patientId, input.memoryId);
    return { result: { forgotten: ok } };
  },
});
