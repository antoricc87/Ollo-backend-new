import prisma from "../../utility/prismaClient";
import threadStore from "./memory/thread.store";
import { runTurnCollect } from "./agent.service";
import type { ClientContext } from "./context/snapshot";
import type { Card } from "./tools/registry";

/**
 * Hands-free turns (Oct 6 2026): the person talks to Ollie through Siri —
 * "Hey Siri, tell Ollo …" — with no screen. Siri hands the app the spoken
 * text, the app posts it here, and Siri READS the reply back. So a voice
 * turn is an ordinary agent turn with three differences:
 *   - it lives on a VOICE thread (one per stretch of talking, see
 *     VOICE_THREAD_WINDOW_MS) so follow-ups keep their context without the
 *     chat threads filling with one-liners;
 *   - the prompt asks for one or two spoken sentences, and `spoken()` makes
 *     sure of it — markdown stripped, cut at a sentence, a trailing question
 *     ("Save it?") never lost;
 *   - a proposal (log_meal, log_workout …) is returned as `proposal` so the
 *     Siri intent can ask "Save it?" and confirm or cancel it by voice
 *     through the usual /agent/proposals endpoints.
 */

/** A pause longer than this starts a new voice thread. */
export const VOICE_THREAD_WINDOW_MS = 30 * 60 * 1000;

/** The longest reply Siri should read out (~15 s of speech). */
export const SPOKEN_MAX_CHARS = 320;

export type VoiceReply = {
  threadId: string;
  /** What Siri says. */
  text: string;
  /** Something Ollie prepared that the person must confirm — null when nothing is pending. */
  proposal: { id: string; title: string; summary: string } | null;
};

/** The voice thread to continue, or a new one when the last exchange is older than the window. */
export async function voiceThread(patientId: string, now = new Date()): Promise<string> {
  const recent = await prisma.agentThread.findFirst({
    where: { patientId, source: "VOICE", archivedAt: null, lastMessageAt: { gte: new Date(now.getTime() - VOICE_THREAD_WINDOW_MS) } },
    orderBy: { lastMessageAt: "desc" },
    select: { id: true },
  });
  if (recent) return recent.id;
  const created = await threadStore.create(patientId, { source: "VOICE" });
  return created.id;
}

/**
 * Chat text → something to say out loud. Strips markdown, turns list items
 * into sentences, and cuts at a sentence boundary once `maxChars` is reached.
 * A question at the very end ("Save it?") survives the cut: the intent needs it.
 */
export function spoken(text: string, maxChars = SPOKEN_MAX_CHARS): string {
  const lines = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(^|\s)\*([^*\n]+)\*(?=[\s.,!?;:]|$)/g, "$1$2")
    .replace(/(^|\s)_([^_\n]+)_(?=[\s.,!?;:]|$)/g, "$1$2")
    .split("\n")
    .map((line) =>
      line
        .replace(/^\s*#{1,6}\s+/, "")
        .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter(Boolean)
    // A list item or a header read aloud needs its own full stop.
    .map((line) => (/[.!?:;,]$/.test(line) ? line : `${line}.`));
  const flat = lines
    .join(" ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .replace(/:\s*\./g, ":")
    .trim();
  if (flat.length <= maxChars) return flat;

  const sentences = flat.match(/[^.!?]+[.!?]+(?:["')\]]+)?(?=\s|$)|[^.!?]+$/g)?.map((s) => s.trim()).filter(Boolean) ?? [flat];
  const kept: string[] = [];
  let length = 0;
  for (const s of sentences) {
    if (kept.length && length + 1 + s.length > maxChars) break;
    kept.push(s);
    length += (kept.length > 1 ? 1 : 0) + s.length;
  }
  const last = sentences[sentences.length - 1];
  if (last && last.endsWith("?") && !kept.includes(last)) kept.push(last);
  return kept.join(" ");
}

/** The first card with a pending proposal behind it (the proposal card itself, or a preview card that carries the id). */
export function pendingProposal(cards: Card[]): VoiceReply["proposal"] {
  for (const card of cards) {
    const data = (card.data ?? {}) as { proposalId?: unknown; summary?: unknown };
    if (typeof data.proposalId === "string") {
      return { id: data.proposalId, title: card.title ?? "", summary: typeof data.summary === "string" ? data.summary : "" };
    }
  }
  return null;
}

/** One hands-free turn on `threadId` (from `voiceThread`). */
export async function voiceTurn(input: { patientId: string; threadId: string; text: string; client: ClientContext | null; signal?: AbortSignal }): Promise<VoiceReply | { error: string }> {
  const r = await runTurnCollect({ patientId: input.patientId, threadId: input.threadId, message: input.text, client: input.client, signal: input.signal, channel: "voice" });
  if (!r.done) return { error: r.error ?? "Something went wrong" };
  const proposal = pendingProposal(r.done.cards);
  // An emergency answer is read in full; everything else is kept short.
  const limit = r.safety && r.safety.outcome === "red_flag" ? 700 : SPOKEN_MAX_CHARS;
  let text = spoken(r.done.text, limit);
  if (proposal && !text.endsWith("?")) text = `${text} Save it?`;
  return { threadId: input.threadId, text, proposal };
}
