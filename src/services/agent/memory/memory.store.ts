import prisma from "../../../utility/prismaClient";

/**
 * Long-term facts the agent learns about a patient ("hates cilantro",
 * "trains at 7am", "mom has T2D"). Small, human-readable, user-deletable.
 *
 * Recall is keyword-scored in code for now — the whole active set for one
 * patient is a few dozen rows. Swap for pgvector if it ever grows.
 */

export type MemoryCategory =
  | "PREFERENCE"
  | "ROUTINE"
  | "CONSTRAINT"
  | "CONTEXT"
  | "FEEDBACK";

export const MEMORY_CATEGORIES: MemoryCategory[] = [
  "PREFERENCE",
  "ROUTINE",
  "CONSTRAINT",
  "CONTEXT",
  "FEEDBACK",
];

const MAX_ACTIVE = 200;
const MAX_CONTENT = 240;

const normalise = (s: string) => s.trim().replace(/\s+/g, " ");

const tokens = (s: string) =>
  normalise(s)
    .toLowerCase()
    .split(/[^a-z0-9à-ÿ]+/)
    .filter((t) => t.length > 2);

class MemoryStore {
  /**
   * Store a fact. Near-duplicates (same normalised text) refresh the existing
   * row instead of creating a second one.
   */
  async remember(
    patientId: string,
    input: {
      content: string;
      category?: MemoryCategory;
      sourceMsg?: string;
      expiresAt?: Date | null;
    }
  ) {
    const content = normalise(input.content).slice(0, MAX_CONTENT);
    if (!content) throw new Error("memory content is empty");
    const existing = await prisma.agentMemory.findFirst({
      where: { patientId, content: { equals: content, mode: "insensitive" } },
    });
    if (existing) {
      return prisma.agentMemory.update({
        where: { id: existing.id },
        data: {
          active: true,
          category: input.category ?? existing.category,
          sourceMsg: input.sourceMsg ?? existing.sourceMsg,
          expiresAt: input.expiresAt === undefined ? existing.expiresAt : input.expiresAt,
        },
      });
    }
    const active = await prisma.agentMemory.count({ where: { patientId, active: true } });
    if (active >= MAX_ACTIVE) {
      // Retire the least recently used memory to make room.
      const oldest = await prisma.agentMemory.findFirst({
        where: { patientId, active: true },
        orderBy: [{ lastUsedAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
      });
      if (oldest)
        await prisma.agentMemory.update({ where: { id: oldest.id }, data: { active: false } });
    }
    return prisma.agentMemory.create({
      data: {
        patientId,
        content,
        category: input.category ?? "CONTEXT",
        sourceMsg: input.sourceMsg ?? null,
        expiresAt: input.expiresAt ?? null,
      },
    });
  }

  async listActive(patientId: string, limit = 50) {
    const now = new Date();
    return prisma.agentMemory.findMany({
      where: {
        patientId,
        active: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: [{ updatedAt: "desc" }],
      take: limit,
    });
  }

  /** Keyword-scored recall; returns the best `limit` matches (score > 0). */
  async recall(patientId: string, query: string, limit = 8) {
    const all = await this.listActive(patientId, MAX_ACTIVE);
    const q = new Set(tokens(query));
    if (q.size === 0) return all.slice(0, limit);
    const scored = all
      .map((m) => {
        const t = tokens(m.content);
        const hits = t.filter((x) => q.has(x)).length;
        return { m, score: hits / Math.sqrt(t.length || 1) };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    const ids = scored.map((x) => x.m.id);
    if (ids.length)
      await prisma.agentMemory.updateMany({
        where: { id: { in: ids } },
        data: { lastUsedAt: new Date() },
      });
    return scored.map((x) => x.m);
  }

  async forget(patientId: string, memoryId: string) {
    const r = await prisma.agentMemory.updateMany({
      where: { id: memoryId, patientId },
      data: { active: false },
    });
    return r.count > 0;
  }

  async remove(patientId: string, memoryId: string) {
    const r = await prisma.agentMemory.deleteMany({ where: { id: memoryId, patientId } });
    return r.count > 0;
  }
}

export default new MemoryStore();
