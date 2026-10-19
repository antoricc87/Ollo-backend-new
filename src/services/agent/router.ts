import { getLLM } from "./llm/openai.client";
import { PACK_KEYS, PACKS, isPackKey, type PackKey } from "./tools/packs";

/**
 * Which area packs a turn needs (agent/tools/packs.ts). One small Luna call on the person's message and
 * the reply it answers; when it is unsure, or fails, EVERY pack is loaded — a wrong guess may cost
 * tokens, never a missing ability. Mid-turn the model can still load_tools for anything it lacks.
 */

const SYSTEM = `You route a message to a health app's assistant. Pick the areas whose tools the assistant may need to answer THIS message well, including what the reply it answers was about when the message refers back ("yes", "the same for dinner", "make it longer").
Areas:
${PACK_KEYS.map((k) => `- ${k}: ${PACKS[k].covers}`).join("\n")}
Pick every area that could be needed; two or three is fine. Greetings, thanks and general health questions need none. unsure = true when you cannot tell.`;

const SCHEMA = {
  type: "object",
  properties: { areas: { type: "array", items: { type: "string", enum: [...PACK_KEYS] } }, unsure: { type: "boolean" } },
  required: ["areas", "unsure"],
  additionalProperties: false,
} as const;

export type RouteResult = { packs: PackKey[]; reason: "routed" | "unsure" | "failed" | "forced"; ms: number };

export async function pickPacks(input: { message: string; previousReply?: string | null; always?: PackKey[] }): Promise<RouteResult> {
  const t0 = Date.now();
  const always = input.always ?? [];
  try {
    const r = await getLLM().json<{ areas: string[]; unsure: boolean }>({
      task: "classify",
      system: SYSTEM,
      user: JSON.stringify({ message: input.message.slice(0, 2000), replyItAnswers: input.previousReply?.slice(0, 800) ?? null }),
      schema: SCHEMA as unknown as Record<string, unknown>,
      schemaName: "pack_route",
    });
    if (r.unsure) return { packs: [...PACK_KEYS], reason: "unsure", ms: Date.now() - t0 };
    const packs = Array.from(new Set([...always, ...(r.areas ?? []).filter(isPackKey)]));
    return { packs, reason: "routed", ms: Date.now() - t0 };
  } catch (e) {
    console.warn(`[router] failed, loading every pack: ${(e as Error).message?.slice(0, 120)}`);
    return { packs: [...PACK_KEYS], reason: "failed", ms: Date.now() - t0 };
  }
}
