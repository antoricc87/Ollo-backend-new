import { Response } from "express";
import prisma from "../../../utility/prismaClient";
import { runLabScanFor } from "../../signals/labs.service";
import Util from "../../../utils/response";
import threadStore from "../memory/thread.store";
import memoryStore, { MEMORY_CATEGORIES, MemoryCategory } from "../memory/memory.store";
import { buildPatientSnapshot, renderSnapshot, ClientContext } from "../context/snapshot";
import { runTurn, runTurnCollect } from "../agent.service";
import { liveTurns } from "../liveTurns";
import { registry } from "../tools";
import proposalStore from "../memory/proposals.store";
import { getPreference, runProactiveFor, setPreference } from "../proactive/proactive.service";
import { speechToText, transcriptionPrompt } from "../../openAI/model/openai.model";
import { z } from "zod";
import { WatchWorkoutSummary } from "../../workouts/domain/workout.schema";
import encounterService from "../../encounter/model/encounter.model";
import { DICTATION_HINTS, voiceThread, voiceTurn } from "../voice";

const MAX_MESSAGE_CHARS = 4000;

/**
 * Ollie agent — patient-scoped. Identity ALWAYS comes from the verified
 * token (`request.user.id`); nothing here reads a patientId from the body.
 */

const pickClientContext = (raw: any): ClientContext | null => {
  if (!raw || typeof raw !== "object") return null;
  const keys: Exclude<keyof ClientContext, "recentWorkouts">[] = [
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
  const rw = z.array(WatchWorkoutSummary).max(20).safeParse(raw.recentWorkouts);
  if (rw.success && rw.data.length) out.recentWorkouts = rw.data;
  return Object.keys(out).length ? out : null;
};

class AgentHandler {
  /* ------------------------------ threads ------------------------------ */
  async listThreads(request: any, response: Response) {
    const { id } = request.user;
    try {
      const threads = await threadStore.listForApp(id, {
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
      // `answering`: a turn is still running on this thread (its reply is not saved yet).
      // `checkin`: the thread's check-in, so reopening a conversation restores check-in mode.
      const checkin = await encounterService.threadView(id, threadId).catch(() => null);
      return response.status(200).json(Util.success({ ...thread, answering: liveTurns.isAnswering(id, threadId), checkin }, "Thread"));
    } catch (error) {
      console.error("agent getThread", error);
      return response.status(400).json(Util.error({}, "Error fetching thread"));
    }
  }

  /** The app opened a note from Ollie — stop announcing it. A plain read never does this. */
  async markThreadSeen(request: any, response: Response) {
    const { id } = request.user;
    const { threadId } = request.params;
    try {
      const thread = await threadStore.get(id, threadId);
      if (!thread) return response.status(404).json(Util.error({}, "Thread not found"));
      await threadStore.markSeen(id, threadId);
      return response.status(200).json(Util.success({ threadId, seen: true }, "Seen"));
    } catch (error) {
      console.error("agent markThreadSeen", error);
      return response.status(400).json(Util.error({}, "Error marking thread seen"));
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
   * JSON reply. Body: `{ message, threadId?, client?, stream?, turnId? }`.
   * The turn outlives the connection (see liveTurns.ts): a closed stream
   * stops the writes, not the turn — only `POST /agent/chat/cancel` does.
   */
  async chat(request: any, response: Response) {
    const { id } = request.user;
    const body = request.body ?? {};
    let message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) return response.status(400).json(Util.error({}, "message is required"));
    const threadId = typeof body.threadId === "string" ? body.threadId : null;
    // Registered before transcription so the thread already reads as answering.
    const turn = liveTurns.start(id, body.turnId, threadId);
    try {
      await AgentHandler.answer(request, response, id, body, message, threadId, turn);
    } finally {
      turn.finish();
    }
  }

  private static async answer(request: any, response: Response, id: string, body: any, message: string, threadId: string | null, turn: ReturnType<typeof liveTurns.start>) {
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
    const client = pickClientContext(body.client);
    const wantsStream = body.stream !== false && body.stream !== "false";

    if (!wantsStream) {
      try {
        const r = await runTurnCollect({ patientId: id, threadId, message, client, signal: turn.signal });
        if (r.error && !r.done) return response.status(502).json(Util.error({ threadId: r.threadId }, r.error));
        return response.status(200).json(
          Util.success(
            { threadId: r.threadId, messageId: r.done!.messageId, text: r.done!.text, cards: r.done!.cards, safety: r.safety, checkin: r.checkin, usage: r.done!.usage, model: r.done!.model },
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
    // NB: listen on the RESPONSE — `request` emits "close" as soon as its body is consumed.
    // A closed stream only stops the writes; the turn runs on and saves its reply.
    let open = true;
    response.on("close", () => {
      open = false;
    });
    const write = (chunk: string) => {
      if (open && !response.writableEnded) response.write(chunk);
    };
    const heartbeat = setInterval(() => write(": ping\n\n"), 15_000);
    const send = (event: string, data: unknown) => write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    send("turn", { turnId: turn.turnId });
    try {
      // No `break` on cancel: returning the generator at a yield can land between an
      // ASSISTANT tool-call row and its TOOL rows. runLoop watches the signal itself.
      for await (const ev of runTurn({ patientId: id, threadId, message, client, signal: turn.signal })) {
        if (ev.type === "thread") turn.setThread(ev.threadId);
        const { type, ...data } = ev;
        send(type, data);
      }
    } catch (error) {
      console.error("agent chat stream", error);
      if (!turn.signal.aborted) send("error", { message: "Something went wrong" });
    } finally {
      clearInterval(heartbeat);
      if (open) response.end();
    }
  }

  /** Stop a running turn — the Stop button. Body: `{ turnId? , threadId? }`. */
  async cancelTurn(request: any, response: Response) {
    const { id } = request.user;
    const { turnId, threadId } = request.body ?? {};
    if (typeof turnId !== "string" && typeof threadId !== "string")
      return response.status(400).json(Util.error({}, "turnId or threadId is required"));
    const cancelled = liveTurns.cancel(id, { turnId, threadId });
    return response.status(200).json(Util.success({ cancelled }, cancelled ? "Stopped" : "Nothing running"));
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

  /** Body: any of `{ proactiveEnabled, weeklyReviewEnabled, watchOutsEnabled, planWeekEnabled }`.
   *  `dailyCheckinHour` is gone with the daily check-in (2026-09-25) — the
   *  column is still there but nothing reads it, so it is not writable either. */
  async updatePreferences(request: any, response: Response) {
    const { id } = request.user;
    const b = request.body ?? {};
    const patch: any = {};
    for (const k of ["proactiveEnabled", "weeklyReviewEnabled", "watchOutsEnabled", "planWeekEnabled"]) if (typeof b[k] === "boolean") patch[k] = b[k];
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
    if (!["weekly_review", "watch_out", "plan_week"].includes(kind))
      return response.status(400).json(Util.error({}, "kind must be weekly_review | watch_out | plan_week"));
    try {
      // watch_out is no longer a free-text prompt: it re-judges the newest lab
      // report against the record and speaks only if that changed something.
      if (kind === "watch_out") {
        const newest = await prisma.labResultSummary.findFirst({ where: { patientSummary: { patientId: id } }, orderBy: { createdAt: "desc" }, select: { id: true } });
        const r = newest ? await runLabScanFor(id, { reportIds: [newest.id], notify: request.body?.notify === true }) : { skipped: "no lab report" };
        if ("skipped" in r) return response.status(502).json(Util.error({}, `Skipped: ${r.skipped}`));
        return response.status(200).json(Util.success(r, r.fired ? "Done" : `Nothing to say: ${(r as { reason: string }).reason}`));
      }
      const r = await runProactiveFor(id, kind, { notify: request.body?.notify === true });
      if ("skipped" in r) return response.status(502).json(Util.error({ threadId: (r as any).threadId ?? null }, `Skipped: ${r.skipped}`));
      return response.status(200).json(Util.success(r, "Done"));
    } catch (error) {
      console.error("agent runProactive", error);
      return response.status(400).json(Util.error({}, "Error running check"));
    }
  }

  /* -------------------------------- voice ------------------------------ */
  /**
   * One hands-free turn (Siri, the watch — see ../voice.ts). Body: `{ text,
   * client? }`, or `{ audio }` (a base64 m4a data URL, transcribed first with
   * the default hints; `heard` in the reply is the transcript).
   * Reply: `{ threadId, heard?, text, saved, proposal }` — `text` is what is read out;
   * `proposal` (id, title, summary) is something Ollie prepared that the
   * intent confirms or cancels through /agent/proposals/:id/{confirm,cancel}.
   * Not streamed: Siri waits for the whole answer.
   */
  async voice(request: any, response: Response) {
    const { id } = request.user;
    const body = request.body ?? {};
    let text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text && typeof body.audio === "string" && body.audio) {
      try {
        text = (await speechToText(body.audio, { prompt: transcriptionPrompt(DICTATION_HINTS, ""), minBytes: 4000 })).trim();
      } catch (error) {
        console.error("agent voice transcription", error);
        return response.status(400).json(Util.error({}, "Could not understand the recording"));
      }
      if (!text) return response.status(400).json(Util.error({}, "The recording was silent"));
    }
    if (!text) return response.status(400).json(Util.error({}, "text or audio is required"));
    if (text.length > MAX_MESSAGE_CHARS)
      return response.status(400).json(Util.error({}, `text is longer than ${MAX_MESSAGE_CHARS} characters`));
    const client = pickClientContext(body.client);
    let threadId: string;
    try {
      threadId = await voiceThread(id);
    } catch (error) {
      console.error("agent voice thread", error);
      return response.status(400).json(Util.error({}, "Error answering"));
    }
    const turn = liveTurns.start(id, body.turnId, threadId);
    try {
      const r = await voiceTurn({ patientId: id, threadId, text, client, signal: turn.signal });
      if ("error" in r) return response.status(502).json(Util.error({ threadId }, r.error));
      return response.status(200).json(Util.success({ ...r, heard: body.audio ? text : undefined }, "Reply"));
    } catch (error) {
      console.error("agent voice", error);
      return response.status(400).json(Util.error({}, "Error answering"));
    } finally {
      turn.finish();
    }
  }

  /* ----------------------------- transcribe ---------------------------- */
  /**
   * Speech → text only, no turn. The app records while it shows on-device
   * live text, then swaps in this (more accurate) transcript when the person
   * taps stop. `hints` = words they are likely to say (spelling bias only).
   * A long voice note arrives in segments cut at pauses; `previous` = the
   * text of the segments before, so this one is transcribed in context.
   */
  async transcribe(request: any, response: Response) {
    const audio = typeof request.body?.audio === "string" ? request.body.audio : "";
    if (!audio) return response.status(400).json(Util.error({}, "audio is required"));
    const sent = Array.isArray(request.body?.hints)
      ? request.body.hints.filter((h: unknown): h is string => typeof h === "string" && !!h.trim()).map((h: string) => h.trim().slice(0, 40)).slice(0, 60)
      : [];
    const hints = sent.length ? sent : DICTATION_HINTS;
    const previous = typeof request.body?.previous === "string" ? request.body.previous.slice(-2000) : "";
    try {
      // Segments can end on a short phrase ("thanks"), so accept ~0.5 s clips;
      // the app only sends segments it heard speech in.
      const text = await speechToText(audio, { prompt: transcriptionPrompt(hints, previous), minBytes: 4000 });
      return response.status(200).json(Util.success({ text }, "Transcript"));
    } catch (error) {
      console.error("agent transcribe", error);
      return response.status(400).json(Util.error({}, "Could not understand the recording"));
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
