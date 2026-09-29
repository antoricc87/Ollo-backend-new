import "dotenv/config";
import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import { ChatMessage, ChatOptions, ChatResult, JsonOptions, LLMClient, ToolCallRequest, Usage } from "./types";

/**
 * OpenAI adapter (Chat Completions, streaming, function tools).
 *   AGENT_MODEL       orchestration model   (default gpt-4.1)
 *   AGENT_FAST_MODEL  classifier/summarizer (default gpt-4.1-mini)
 */

const DEFAULT_MODEL = process.env.AGENT_MODEL || "gpt-4.1";
const FAST_MODEL = process.env.AGENT_FAST_MODEL || "gpt-4.1-mini";

/**
 * Deadlines (Sep 28 2026). The client had the SDK defaults — 10 min per
 * attempt, 2 retries — and the agent loop called it WITHOUT streaming, so a
 * request OpenAI never answered held the whole turn: eval turns took ~520 s
 * (5 of 12 in one run) and on the phone the 5-min turn cap turned them into
 * "Something went wrong". Every call now streams internally so two watchdogs
 * can tell a hang from a long answer: nothing received within FIRST_CHUNK_MS,
 * or silence for IDLE_MS mid-stream, aborts it. A long meal plan keeps
 * producing chunks, so it is never cut. An abort before ANY output is retried
 * once (nothing was shown or half-parsed); after output it throws.
 */
const FIRST_CHUNK_MS = Number(process.env.AGENT_LLM_FIRST_CHUNK_MS || 45_000);
const IDLE_MS = Number(process.env.AGENT_LLM_IDLE_MS || 30_000);
const SLOW_LOG_MS = 15_000;

class LLMStalled extends Error {
  constructor(readonly phase: "first_chunk" | "idle", readonly afterMs: number) {
    super(`OpenAI stream stalled (${phase === "first_chunk" ? "no response" : "no data"} for ${Math.round(afterMs / 1000)} s)`);
  }
}

const isReasoningModel = (model: string) => /^(o\d|gpt-5)/i.test(model) && !/chat/i.test(model);

/** Chat Completions spells the reasoning knob `reasoning_effort`; others take temperature. */
const sampling = (model: string, temperature: number) =>
  isReasoningModel(model) ? { reasoning_effort: "low" as const } : { temperature };

const toOpenAI = (m: ChatMessage): ChatCompletionMessageParam => {
  switch (m.role) {
    case "system":
      return { role: "system", content: m.content };
    case "user":
      return { role: "user", content: m.content };
    case "assistant":
      return m.toolCalls && m.toolCalls.length
        ? {
            role: "assistant",
            content: m.content || null,
            tool_calls: m.toolCalls.map((c) => ({
              id: c.id,
              type: "function" as const,
              function: { name: c.name, arguments: JSON.stringify(c.input ?? {}) },
            })),
          }
        : { role: "assistant", content: m.content };
    case "tool":
      return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
  }
};

const parseArgs = (raw: string): Record<string, unknown> => {
  if (!raw || !raw.trim()) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? v : {};
  } catch {
    return { __unparsed: raw };
  }
};

const usageOf = (u: OpenAI.CompletionUsage | null | undefined): Usage | null =>
  u
    ? {
        inputTokens: u.prompt_tokens,
        outputTokens: u.completion_tokens,
        cachedInputTokens: u.prompt_tokens_details?.cached_tokens,
      }
    : null;

export class OpenAIClient implements LLMClient {
  readonly defaultModel = DEFAULT_MODEL;
  readonly fastModel = FAST_MODEL;
  private client: OpenAI | null = null;

  private get api() {
    if (!this.client) {
      const apiKey = process.env.REACT_APP_OPENAI_API_KEY || process.env.OPENAI_API_KEY || "";
      if (!apiKey) throw new Error("OpenAI API key missing (REACT_APP_OPENAI_API_KEY)");
      // Transport errors / 5xx: one SDK retry. Hangs are the watchdogs' job (see FIRST_CHUNK_MS).
      this.client = new OpenAI({ apiKey, maxRetries: 1 });
    }
    return this.client;
  }

  async chat(opts: ChatOptions): Promise<ChatResult> {
    const model = opts.model || this.defaultModel;
    const tools: ChatCompletionTool[] | undefined = opts.tools?.length
      ? opts.tools.map((t) => ({
          type: "function",
          function: { name: t.name, description: t.description, parameters: t.parameters },
        }))
      : undefined;
    const base = {
      model,
      messages: opts.messages.map(toOpenAI),
      ...(tools ? { tools, tool_choice: "auto" as const } : {}),
      ...(opts.maxOutputTokens ? { max_completion_tokens: opts.maxOutputTokens } : {}),
      ...sampling(model, 0.3),
    };

    const out = await this.streamed("chat", model, opts.signal, !!opts.onTextDelta, (signal) => this.api.chat.completions.create({ ...base, stream: true, stream_options: { include_usage: true } }, { signal }), opts.onTextDelta);
    return { text: out.text, toolCalls: out.toolCalls, finishReason: mapFinish(out.finish, out.toolCalls.length), usage: out.usage, model: out.model };
  }

  async json<T = unknown>(opts: JsonOptions<T>): Promise<T> {
    const model = opts.model || this.fastModel;
    const out = await this.streamed(`json:${opts.schemaName}`, model, opts.signal, false, (signal) =>
      this.api.chat.completions.create(
        {
          model,
          messages: [
            { role: "system", content: opts.system },
            { role: "user", content: opts.user },
          ],
          response_format: {
            type: "json_schema",
            json_schema: { name: opts.schemaName, schema: opts.schema, strict: true },
          },
          stream: true,
          ...sampling(model, 0),
        },
        { signal }
      )
    );
    const parsed = JSON.parse(out.text || "{}");
    return opts.parse ? opts.parse(parsed) : (parsed as T);
  }

  /**
   * One streamed completion under the watchdogs, retried once when it stalled
   * before sending anything. `live` = deltas go to the caller as they arrive,
   * so a stall after the first one can't be retried without repeating text.
   */
  private async streamed(
    label: string,
    model: string,
    outer: AbortSignal | undefined,
    live: boolean,
    open: (signal: AbortSignal) => Promise<AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>>,
    onTextDelta?: (delta: string) => void
  ) {
    const t0 = Date.now();
    for (let attempt = 1; ; attempt++) {
      const ctl = new AbortController();
      const relay = () => ctl.abort(outer?.reason);
      if (outer?.aborted) relay();
      outer?.addEventListener("abort", relay, { once: true });
      let stalled: LLMStalled | null = null;
      let timer: NodeJS.Timeout | null = null;
      let received = false;
      const arm = (ms: number, phase: LLMStalled["phase"]) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          stalled = new LLMStalled(phase, ms);
          ctl.abort(stalled);
        }, ms);
      };
      arm(FIRST_CHUNK_MS, "first_chunk");
      let firstChunkMs: number | null = null;
      try {
        const stream = await open(ctl.signal);
        let text = "";
        let finish: string | null = null;
        let usage: Usage | null = null;
        let modelName = model;
        const calls = new Map<number, { id: string; name: string; args: string }>();
        for await (const chunk of stream) {
          if (!received) firstChunkMs = Date.now() - t0;
          received = true;
          arm(IDLE_MS, "idle");
          if (chunk.usage) usage = usageOf(chunk.usage);
          if (chunk.model) modelName = chunk.model;
          const choice = chunk.choices?.[0];
          if (!choice) continue;
          const delta = choice.delta;
          if (delta?.content) {
            text += delta.content;
            onTextDelta?.(delta.content);
          }
          for (const tc of delta?.tool_calls ?? []) {
            const cur = calls.get(tc.index) ?? { id: "", name: "", args: "" };
            if (tc.id) cur.id = tc.id;
            if (tc.function?.name) cur.name += tc.function.name;
            if (tc.function?.arguments) cur.args += tc.function.arguments;
            calls.set(tc.index, cur);
          }
          if (choice.finish_reason) finish = choice.finish_reason;
        }
        // An abort mid-stream can END the iterator instead of throwing — never return that half answer.
        if (stalled) throw stalled;
        const ms = Date.now() - t0;
        if (ms > SLOW_LOG_MS || attempt > 1) console.warn(`[llm] slow ${label} ${modelName}: ${ms} ms total, first chunk ${firstChunkMs} ms, attempt ${attempt}`);
        const toolCalls = Array.from(calls.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([, c]) => ({ id: c.id, name: c.name, input: parseArgs(c.args) }));
        return { text, toolCalls, finish, usage, model: modelName };
      } catch (e) {
        if (!stalled || outer?.aborted) throw e; // a real error, or the caller stopped the turn
        const s = stalled as LLMStalled;
        console.warn(`[llm] stalled ${label} ${model}: ${s.message}, attempt ${attempt}, ${Date.now() - t0} ms since start`);
        if (attempt >= 2 || (received && live)) throw s;
      } finally {
        if (timer) clearTimeout(timer);
        outer?.removeEventListener("abort", relay);
      }
    }
  }
}

const mapFinish = (reason: string | null, toolCalls: number): ChatResult["finishReason"] => {
  if (toolCalls > 0 || reason === "tool_calls") return "tool_calls";
  if (reason === "stop") return "stop";
  if (reason === "length") return "length";
  return "other";
};

let singleton: LLMClient | null = null;
export const getLLM = (): LLMClient => (singleton ??= new OpenAIClient());
