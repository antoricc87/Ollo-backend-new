import { Response } from "express";
import Util from "../../../utils/response";
import threadStore from "../memory/thread.store";
import memoryStore, { MEMORY_CATEGORIES, MemoryCategory } from "../memory/memory.store";
import { buildPatientSnapshot, renderSnapshot, ClientContext } from "../context/snapshot";
import { runTurn, runTurnCollect } from "../agent.service";
import { registry } from "../tools";
import proposalStore from "../memory/proposals.store";
import { getPreference, runProactiveFor, setPreference } from "../proactive/proactive.service";
import { speechToText } from "../../openAI/model/openai.model";

const MAX_MESSAGE_CHARS = 4000;

/**
 * Ollie agent — patient-scoped. Identity ALWAYS comes from the verified
 * token (`request.user.id`); nothing here reads a patientId from the body.
 */

const pickClientContext = (raw: any): ClientContext | null => {
  if (!raw || typeof raw !== "object") return null;
  const keys: (keyof ClientContext)[] = [
    "sleepMinutesLastNight",
    "stepsToday",
    "activeEnergyToday",
    "restingHeartRate",
    "hrvMs",
    "weekSleepAvgMinutes",
    "weekStepsAvg",
  ];
  const out: ClientContext = {};
  for (const k of keys) {
    const v = Number(raw[k]);
    if (raw[k] !== undefined && raw[k] !== null && isFinite(v)) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
};

class AgentHandler {
  /* ------------------------------ threads ------------------------------ */
  async listThreads(request: any, response: Response) {
    const { id } = request.user;
    try {
      const threads = await threadStore.list(id, {
        includeArchived: request.query?.archived === "true",
      });
      return response.status(200).json(Util.success(threads, "Threads"));
    } catch (error) {
      console.error("agent listThreads", error);
      return response.status(400).json(Util.error({}, "Error listing threads"));
    }
  }

  async createThread(request: any, response: Response) {
    const { id } = request.user;
    const { title } = request.body ?? {};
    try {
      const thread = await threadStore.create(id, {
        title: typeof title === "string" ? title : undefined,
      });
      return response.status(200).json(Util.success(thread, "Thread created"));
    } catch (error) {
      console.error("agent createThread", error);
      return response.status(400).json(Util.error({}, "Error creating thread"));
    }
  }

  async getThread(request: any, response: Response) {
    const { id } = request.user;
    const { threadId } = request.params;
    try {
      const thread = await threadStore.getWithMessages(id, threadId, {
        includeTool: request.query?.tools === "true",
      });
      if (!thread) return response.status(404).json(Util.error({}, "Thread not found"));
      return response.status(200).json(Util.success(thread, "Thread"));
    } catch (error) {
      console.error("agent getThread", error);
      return response.status(400).json(Util.error({}, "Error fetching thread"));
    }
  }

  async renameThread(request: any, response: Response) {
    const { id } = request.user;
    const { threadId } = request.params;
    const { title } = request.body ?? {};
    if (typeof title !== "string" || !title.trim())
      return response.status(400).json(Util.error({}, "title is required"));
    try {
      const ok = await threadStore.rename(id, threadId, title.trim());
      if (!ok) return response.status(404).json(Util.error({}, "Thread not found"));
      return response.status(200).json(Util.success({ threadId, title }, "Thread renamed"));
    } catch (error) {
      console.error("agent renameThread", error);
      return response.status(400).json(Util.error({}, "Error renaming thread"));
    }
  }

  async deleteThread(request: any, response: Response) {
    const { id } = request.user;
    const { threadId } = request.params;
    try {
      const ok = await threadStore.remove(id, threadId);
      if (!ok) return response.status(404).json(Util.error({}, "Thread not found"));
      return response.status(200).json(Util.success({ threadId }, "Thread deleted"));
    } catch (error) {
      console.error("agent deleteThread", error);
      return response.status(400).json(Util.error({}, "Error deleting thread"));
    }
  }

  /* ------------------------------ memories ----------------------------- */
  async listMemories(request: any, response: Response) {
    const { id } = request.user;
    try {
      const memories = await memoryStore.listActive(id, 200);
      return response.status(200).json(Util.success(memories, "Memories"));
    } catch (error) {
      console.error("agent listMemories", error);
      return response.status(400).json(Util.error({}, "Error listing memories"));
    }
  }

  /** User-authored memory ("remember that I…") — same store the agent writes to. */
  async createMemory(request: any, response: Response) {
    const { id } = request.user;
    const { content, category } = request.body ?? {};
    if (typeof content !== "string" || !content.trim())
      return response.status(400).json(Util.error({}, "content is required"));
    if (category !== undefined && !MEMORY_CATEGORIES.includes(category))
      return response.status(400).json(Util.error({}, "invalid category"));
    try {
      const memory = await memoryStore.remember(id, {
        content,
        category: category as MemoryCategory | undefined,
      });
      return response.status(200).json(Util.success(memory, "Memory saved"));
    } catch (error) {
      console.error("agent createMemory", error);
      return response.status(400).json(Util.error({}, "Error saving memory"));
    }
  }

  async deleteMemory(request: any, response: Response) {
    const { id } = request.user;
    const { memoryId } = request.params;
    try {
      const ok = await memoryStore.remove(id, memoryId);
      if (!ok) return response.status(404).json(Util.error({}, "Memory not found"));
      return response.status(200).json(Util.success({ memoryId }, "Memory deleted"));
    } catch (error) {
      console.error("agent deleteMemory", error);
      return response.status(400).json(Util.error({}, "Error deleting memory"));
    }
  }

  /* -------------------------------- chat ------------------------------- */
  /**
   * One turn. Streams Server-Sent Events (`event: <type>` / `data: <json>`)
   * unless `stream: false` is sent, in which case the final result is one
   * JSON reply. Body: `{ message, threadId?, client?, stream? }`.
   */
  async chat(request: any, response: Response) {
    const { id } = request.user;
    const body = request.body ?? {};
    let message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) return response.status(400).json(Util.error({}, "message is required"));
    if (body.isAudio === true) {
      // Voice: `message` is base64 audio — transcribe first (same Whisper path the old agent used).
      try {
        message = (await speechToText(message))?.trim() ?? "";
      } catch (error) {
        console.error("agent chat transcription", error);
        return response.status(400).json(Util.error({}, "Could not understand the recording"));
      }
      if (!message) return response.status(400).json(Util.error({}, "The recording was silent"));
    }
    if (message.length > MAX_MESSAGE_CHARS)
      return response.status(400).json(Util.error({}, `message is longer than ${MAX_MESSAGE_CHARS} characters`));
    const threadId = typeof body.threadId === "string" ? body.threadId : null;
    const client = pickClientContext(body.client);
    const wantsStream = body.stream !== false && body.stream !== "false";

    if (!wantsStream) {
      try {
        const r = await runTurnCollect({ patientId: id, threadId, message, client });
        if (r.error && !r.done) return response.status(502).json(Util.error({ threadId: r.threadId }, r.error));
        return response.status(200).json(
          Util.success(
            { threadId: r.threadId, messageId: r.done!.messageId, text: r.done!.text, cards: r.done!.cards, safety: r.safety, usage: r.done!.usage, model: r.done!.model },
            "Reply"
          )
        );
      } catch (error) {
        console.error("agent chat", error);
        return response.status(400).json(Util.error({}, "Error answering"));
      }
    }

    response.status(200);
    response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("Connection", "keep-alive");
    response.setHeader("X-Accel-Buffering", "no");
    response.flushHeaders();
    const abort = new AbortController();
    // NB: listen on the RESPONSE — `request` emits "close" as soon as its body is consumed.
    response.on("close", () => abort.abort());
    const heartbeat = setInterval(() => response.write(": ping\n\n"), 15_000);
    const send = (event: string, data: unknown) => response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    try {
      for await (const ev of runTurn({ patientId: id, threadId, message, client, signal: abort.signal })) {
        if (abort.signal.aborted) break;
        const { type, ...data } = ev;
        send(type, data);
      }
    } catch (error) {
      console.error("agent chat stream", error);
      if (!abort.signal.aborted) send("error", { message: "Something went wrong" });
    } finally {
      clearInterval(heartbeat);
      response.end();
    }
  }

  /** Tool catalogue as the model sees it (for the app's debug screen / evals). */
  async tools(_request: any, response: Response) {
    return response.status(200).json(Util.success(registry.specs(), "Tools"));
  }

  /* ----------------------------- proposals ----------------------------- */
  async listProposals(request: any, response: Response) {
    const { id } = request.user;
    const status = typeof request.query?.status === "string" ? request.query.status.toUpperCase() : "PENDING";
    if (!["PENDING", "CONFIRMED", "CANCELLED", "EXPIRED", "FAILED", "ALL"].includes(status))
      return response.status(400).json(Util.error({}, "invalid status"));
    try {
      const proposals = await proposalStore.list(id, {
        status: status === "ALL" ? undefined : (status as any),
        threadId: typeof request.query?.threadId === "string" ? request.query.threadId : undefined,
      });
      return response.status(200).json(Util.success(proposals, "Proposals"));
    } catch (error) {
      console.error("agent listProposals", error);
      return response.status(400).json(Util.error({}, "Error listing proposals"));
    }
  }

  /** Body: `{ edits?: { …partial tool input }, previewEdits?: tool-specific }` — both validated. */
  async confirmProposal(request: any, response: Response) {
    const { id } = request.user;
    const { proposalId } = request.params;
    const edits = request.body?.edits && typeof request.body.edits === "object" ? request.body.edits : null;
    const previewEdits = request.body?.previewEdits && typeof request.body.previewEdits === "object" ? request.body.previewEdits : undefined;
    try {
      const r = await proposalStore.confirm(id, proposalId, edits, previewEdits);
      if (r.status !== 200) return response.status(r.status).json(Util.error({}, r.error));
      return response.status(200).json(Util.success({ proposal: r.proposal, result: r.result, cards: r.cards }, "Confirmed"));
    } catch (error) {
      console.error("agent confirmProposal", error);
      return response.status(400).json(Util.error({}, "Error confirming proposal"));
    }
  }

  async cancelProposal(request: any, response: Response) {
    const { id } = request.user;
    const { proposalId } = request.params;
    try {
      const r = await proposalStore.cancel(id, proposalId);
      if (r.status !== 200) return response.status(r.status).json(Util.error({}, r.error));
      return response.status(200).json(Util.success(r.proposal, "Cancelled"));
    } catch (error) {
      console.error("agent cancelProposal", error);
      return response.status(400).json(Util.error({}, "Error cancelling proposal"));
    }
  }

  /* ---------------------------- preferences ---------------------------- */
  async getPreferences(request: any, response: Response) {
    const { id } = request.user;
    try {
      return response.status(200).json(Util.success(await getPreference(id), "Preferences"));
    } catch (error) {
      console.error("agent getPreferences", error);
      return response.status(400).json(Util.error({}, "Error reading preferences"));
    }
  }

  /** Body: any of `{ proactiveEnabled, dailyCheckinHour (0-23 | null), weeklyReviewEnabled, watchOutsEnabled }`. */
  async updatePreferences(request: any, response: Response) {
    const { id } = request.user;
    const b = request.body ?? {};
    const patch: any = {};
    for (const k of ["proactiveEnabled", "weeklyReviewEnabled", "watchOutsEnabled"]) if (typeof b[k] === "boolean") patch[k] = b[k];
    if (b.dailyCheckinHour === null) patch.dailyCheckinHour = null;
    else if (b.dailyCheckinHour !== undefined) {
      const h = Number(b.dailyCheckinHour);
      if (!Number.isInteger(h) || h < 0 || h > 23) return response.status(400).json(Util.error({}, "dailyCheckinHour must be 0-23 or null"));
      patch.dailyCheckinHour = h;
    }
    if (!Object.keys(patch).length) return response.status(400).json(Util.error({}, "nothing to update"));
    try {
      return response.status(200).json(Util.success(await setPreference(id, patch), "Preferences updated"));
    } catch (error) {
      console.error("agent updatePreferences", error);
      return response.status(400).json(Util.error({}, "Error updating preferences"));
    }
  }

  /** Run a proactive check for the caller now (dev/testing and "review my week" buttons). */
  async runProactive(request: any, response: Response) {
    const { id } = request.user;
    const { kind } = request.params;
    if (!["weekly_review", "daily_checkin", "watch_out"].includes(kind))
      return response.status(400).json(Util.error({}, "kind must be weekly_review | daily_checkin | watch_out"));
    const reason = typeof request.body?.reason === "string" ? request.body.reason.slice(0, 200) : undefined;
    try {
      const r = await runProactiveFor(id, kind, { reason, notify: request.body?.notify === true });
      if ("skipped" in r) return response.status(502).json(Util.error({ threadId: (r as any).threadId ?? null }, `Skipped: ${r.skipped}`));
      return response.status(200).json(Util.success(r, "Done"));
    } catch (error) {
      console.error("agent runProactive", error);
      return response.status(400).json(Util.error({}, "Error running check"));
    }
  }

  /* ------------------------------ snapshot ----------------------------- */
  /**
   * The per-turn context block, exposed so the app (and developers) can see
   * exactly what the agent knows. POST so the app can attach HealthKit data.
   */
  async snapshot(request: any, response: Response) {
    const { id } = request.user;
    try {
      const snapshot = await buildPatientSnapshot(id, pickClientContext(request.body?.client));
      if (!snapshot) return response.status(404).json(Util.error({}, "Patient not found"));
      return response
        .status(200)
        .json(Util.success({ snapshot, text: renderSnapshot(snapshot) }, "Snapshot"));
    } catch (error) {
      console.error("agent snapshot", error);
      return response.status(400).json(Util.error({}, "Error building snapshot"));
    }
  }
}

export default new AgentHandler();
