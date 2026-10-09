import { Prisma } from "@prisma/client";
import prisma from "../../../utility/prismaClient";

/**
 * Persisted conversation threads for the Ollie agent.
 *
 * Every read is scoped by patientId so a thread id from another account can
 * never be opened. Messages are append-only with a per-thread `seq`; the
 * context window handed to the model is "rolling summary + last N turns",
 * cut on a USER boundary so a tool call is never separated from its result.
 */

export type AgentRoleName = "USER" | "ASSISTANT" | "TOOL" | "SYSTEM";

export type NewAgentMessage = {
  role: AgentRoleName;
  content?: string;
  toolCalls?: unknown; // ASSISTANT: [{ id, name, input }]
  toolCallId?: string; // TOOL
  toolName?: string;
  cards?: unknown;
  meta?: unknown;
};

const json = (v: unknown) =>
  v === undefined ? undefined : (v as Prisma.InputJsonValue);

/** Verbatim turns kept in the prompt before older ones fold into `summary`. */
export const VERBATIM_WINDOW = 24;
/** Hard cap on rows loaded per turn (tool rows included). */
export const UNSUMMARIZED_CAP = 300;

/** How long an unopened note keeps being announced. */
export const ANNOUNCE_DAYS = 7;

export const isUnseenNote = (t: { source: string; seenAt: Date | null; lastMessageAt: Date | null }, now = Date.now()) =>
  t.source === "PROACTIVE" && !t.seenAt && !!t.lastMessageAt && now - t.lastMessageAt.getTime() < ANNOUNCE_DAYS * 86_400_000;

class ThreadStore {
  async create(
    patientId: string,
    opts: { source?: "CHAT" | "PROACTIVE" | "VOICE"; title?: string } = {}
  ) {
    return prisma.agentThread.create({
      data: {
        patientId,
        source: opts.source ?? "CHAT",
        title: opts.title ?? null,
      },
    });
  }

  /** Thread header only; null when it does not exist or belongs to someone else. */
  async get(patientId: string, threadId: string) {
    return prisma.agentThread.findFirst({ where: { id: threadId, patientId } });
  }

  async list(patientId: string, opts: { limit?: number; includeArchived?: boolean } = {}) {
    return prisma.agentThread.findMany({
      where: {
        patientId,
        ...(opts.includeArchived ? {} : { archivedAt: null }),
      },
      orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      take: opts.limit ?? 30,
    });
  }

  /**
   * The history list, with `announce` on each row: the ONE rule for "Ollie has
   * something new for you" (the dashboard row reads it and decides nothing).
   * A note is announced while it is a PROACTIVE thread nobody has opened, is
   * under `ANNOUNCE_DAYS` old, and is still true — a signal note whose episode
   * has since resolved ("nothing logged for 3 days", then they logged) is
   * history, not news. It stays in the list either way: the note is the record
   * of what Ollie said, and the place to answer it.
   */
  async listForApp(patientId: string, opts: { limit?: number; includeArchived?: boolean } = {}) {
    const threads = await this.list(patientId, opts);
    const fresh = threads.filter((t) => isUnseenNote(t)).map((t) => t.id);
    const resolved = fresh.length
      ? await prisma.finding.findMany({ where: { patientId, threadId: { in: fresh }, status: "RESOLVED" }, select: { threadId: true } })
      : [];
    const over = new Set(resolved.map((f) => f.threadId));
    return threads.map((t) => ({ ...t, announce: isUnseenNote(t) && !over.has(t.id) }));
  }

  /** The person opened the note. Idempotent; the first opening is the one kept. */
  async markSeen(patientId: string, threadId: string) {
    const r = await prisma.agentThread.updateMany({ where: { id: threadId, patientId, seenAt: null }, data: { seenAt: new Date() } });
    return r.count > 0;
  }

  /** A proactive run wrote into a thread that was already opened: it is news again. */
  async markUnseen(threadId: string) {
    await prisma.agentThread.updateMany({ where: { id: threadId, seenAt: { not: null } }, data: { seenAt: null } });
  }

  /** Full transcript for the app's history view (USER/ASSISTANT rows only by default). */
  async getWithMessages(
    patientId: string,
    threadId: string,
    opts: { includeTool?: boolean } = {}
  ) {
    const thread = await this.get(patientId, threadId);
    if (!thread) return null;
    const messages = await prisma.agentMessage.findMany({
      where: {
        threadId,
        ...(opts.includeTool ? {} : { role: { in: ["USER", "ASSISTANT"] } }),
      },
      orderBy: { seq: "asc" },
    });
    return { ...thread, messages };
  }

  /**
   * Append one or more messages atomically, assigning consecutive `seq`
   * values. Returns the created rows in order.
   */
  async append(threadId: string, messages: NewAgentMessage[]) {
    if (messages.length === 0) return [];
    return prisma.$transaction(async (tx) => {
      const last = await tx.agentMessage.findFirst({
        where: { threadId },
        orderBy: { seq: "desc" },
        select: { seq: true },
      });
      let seq = last?.seq ?? 0;
      const created = [];
      for (const m of messages) {
        seq += 1;
        created.push(
          await tx.agentMessage.create({
            data: {
              threadId,
              seq,
              role: m.role,
              content: m.content ?? "",
              toolCalls: json(m.toolCalls),
              toolCallId: m.toolCallId ?? null,
              toolName: m.toolName ?? null,
              cards: json(m.cards),
              meta: json(m.meta),
            },
          })
        );
      }
      const firstUser = messages.find((m) => m.role === "USER" && m.content);
      await tx.agentThread.update({
        where: { id: threadId },
        data: {
          lastMessageAt: new Date(),
          // First user message becomes the title until something better is set.
          ...(firstUser && seq === messages.length
            ? { title: firstUser.content!.slice(0, 80) }
            : {}),
        },
      });
      return created;
    });
  }

  /**
   * What the model sees: the rolling summary (if any) plus the most recent
   * turns verbatim. The window starts at a USER message so assistant tool
   * calls always travel with their TOOL results.
   */
  async contextWindow(threadId: string, verbatim: number = VERBATIM_WINDOW) {
    const thread = await prisma.agentThread.findUnique({
      where: { id: threadId },
      select: { summary: true, summarizedUpTo: true },
    });
    const recent = await prisma.agentMessage.findMany({
      where: {
        threadId,
        ...(thread?.summarizedUpTo ? { seq: { gt: thread.summarizedUpTo } } : {}),
      },
      orderBy: { seq: "desc" },
      // Everything not yet folded into the summary, bounded so a thread that
      // was never summarized cannot pull unbounded rows. If the cap is hit the
      // caller sees a full `unsummarized` set and should summarize.
      take: UNSUMMARIZED_CAP,
    });
    const asc = recent.reverse();
    // Keep at most `verbatim` USER-initiated turns, starting on a USER row.
    let userTurns = 0;
    let startIdx = 0;
    for (let i = asc.length - 1; i >= 0; i--) {
      if (asc[i].role === "USER") {
        userTurns += 1;
        startIdx = i;
        if (userTurns >= verbatim) break;
      }
    }
    const messages = asc.slice(startIdx);
    /** Turns that fell outside the window and are not yet in the summary. */
    const unsummarized = asc.slice(0, startIdx);
    return { summary: thread?.summary ?? null, messages, unsummarized };
  }

  async setSummary(threadId: string, summary: string, summarizedUpTo: number) {
    return prisma.agentThread.update({
      where: { id: threadId },
      data: { summary, summarizedUpTo },
    });
  }

  async rename(patientId: string, threadId: string, title: string) {
    const r = await prisma.agentThread.updateMany({
      where: { id: threadId, patientId },
      data: { title: title.slice(0, 120) },
    });
    return r.count > 0;
  }

  async archive(patientId: string, threadId: string) {
    const r = await prisma.agentThread.updateMany({
      where: { id: threadId, patientId },
      data: { archivedAt: new Date() },
    });
    return r.count > 0;
  }

  async remove(patientId: string, threadId: string) {
    const r = await prisma.agentThread.deleteMany({ where: { id: threadId, patientId } });
    return r.count > 0;
  }
}

export default new ThreadStore();
