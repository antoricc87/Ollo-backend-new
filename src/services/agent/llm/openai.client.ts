import "dotenv/config";
import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import { ChatMessage, ChatOptions, ChatResult, JsonOptions, LLMClient, ToolCallRequest, Usage } from "./types";
import { policyTable, route, type Effort } from "./policy";

export type { Effort } from "./policy";

/**
 * OpenAI adapter (Chat Completions / Responses, streaming, function tools).
 * Which model runs is NOT decided here or by callers: every call names a task and llm/policy.ts
 * resolves it (R1, Oct 19 2026).
 */

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
const THINKING_IDLE_MS = Number(process.env.AGENT_LLM_THINKING_IDLE_MS || 120_000);

class LLMStalled extends Error {
  constructor(readonly phase: "first_chunk" | "idle", readonly afterMs: number) {
    super(`OpenAI stream stalled (${phase === "first_chunk" ? "no response" : "no data"} for ${Math.round(afterMs / 1000)} s)`);
  }
}

export const isReasoningModel = (model: string) => /^(o\d|gpt-([5-9]|\d{2}))/i.test(model) && !/chat/i.test(model);

/** Chat Completions spells the reasoning knob `reasoning_effort`; others take temperature. "none" is newer than the SDK's types. */
const sampling = (model: string, temperature: number, effort: Effort = "low") =>
  isReasoningModel(model) ? { reasoning_effort: effort as "low" } : { temperature };

/**
 * Chat Completions refuses function tools together with reasoning for gpt-5.4
 * and later ("use /v1/responses"), and the pro models are Responses-only. Those
 * go through the Responses API below; everything else stays where it was.
 */
const needsResponses = (model: string) => {
  if (/-pro\b/i.test(model)) return true;
  const m = /^gpt-(\d+)(?:\.(\d+))?/i.exec(model);
  return !!m && (Number(m[1]) > 5 || (Number(m[1]) === 5 && Number(m[2] ?? 0) >= 4));
};

/** The conversation as Responses input items. Reasoning items are not carried between calls (stateless, `store: false`). */
const toResponsesInput = (messages: ChatMessage[]): any[] => {
  const out: any[] = [];
  for (const m of messages) {
    if (m.role === "system") out.push({ role: "developer", content: m.content });
    else if (m.role === "user") out.push({ role: "user", content: m.content });
    else if (m.role === "assistant") {
      if (m.content) out.push({ role: "assistant", content: m.content });
      for (const c of m.toolCalls ?? []) out.push({ type: "function_call", call_id: c.id, name: c.name, arguments: JSON.stringify(c.input ?? {}) });
    } else out.push({ type: "function_call_output", call_id: m.toolCallId, output: m.content });
  }
  return out;
};

/**
 * A Responses stream read as Chat Completions chunks, so one reader and one
 * pair of watchdogs (`streamed`) serve both APIs. Every event becomes a chunk
 * — the ones that carry nothing still prove the connection is alive.
 */
async function* asChatChunks(events: AsyncIterable<any>): AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk> {
  let calls = 0;
  for await (const ev of events) {
    if (ev.type === "response.output_text.delta" && ev.delta) yield { choices: [{ index: 0, delta: { content: ev.delta } }] } as any;
    else if (ev.type === "response.output_item.done" && ev.item?.type === "function_call")
      yield { choices: [{ index: 0, delta: { tool_calls: [{ index: calls++, id: ev.item.call_id, function: { name: ev.item.name, arguments: ev.item.arguments ?? "" } }] } }] } as any;
    else if (ev.type === "response.completed" || ev.type === "response.incomplete") {
      const u = ev.response?.usage;
      yield {
        model: ev.response?.model,
        usage: u ? { prompt_tokens: u.input_tokens, completion_tokens: u.output_tokens, total_tokens: u.total_tokens, prompt_tokens_details: { cached_tokens: u.input_tokens_details?.cached_tokens } } : undefined,
        choices: [{ index: 0, delta: {}, finish_reason: calls ? "tool_calls" : ev.type === "response.incomplete" ? "length" : "stop" }],
      } as any;
    } else if (ev.type === "response.failed" || ev.type === "error") throw new Error(ev.response?.error?.message ?? ev.message ?? "OpenAI response failed");
    else yield { choices: [] } as any;
  }
}

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
  get defaultModel() {
    return route("converse").model;
  }
  get fastModel() {
    return route("summarize").model;
  }
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
    const r = route(opts.task ?? "converse");
    const model = opts.model || r.model;
    const effort = opts.reasoningEffort ?? r.effort;
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
      ...sampling(model, 0.3, effort),
      ...(r.tier === "fast" ? { service_tier: "fast" as any } : {}),
      ...(opts.cacheKey ? { prompt_cache_key: opts.cacheKey } : {}),
    };

    const out = needsResponses(model)
      ? await this.streamed(
          "chat",
          model,
          opts.signal,
          !!opts.onTextDelta,
          async (signal) =>
            asChatChunks(
              (await this.api.responses.create(
                {
                  model,
                  input: toResponsesInput(opts.messages),
                  ...(opts.tools?.length ? { tools: opts.tools.map((t) => ({ type: "function" as const, name: t.name, description: t.description, parameters: t.parameters, strict: false })) } : {}),
                  ...(opts.maxOutputTokens ? { max_output_tokens: opts.maxOutputTokens } : {}),
                  reasoning: { effort: effort as "low" },
                  ...(r.tier === "fast" ? { service_tier: "fast" } : {}),
                  ...(opts.cacheKey ? { prompt_cache_key: opts.cacheKey } : {}),
                  store: false,
                  stream: true,
                } as any,
                { signal }
              )) as any
            ),
          opts.onTextDelta,
          // A reasoning model thinks in silence before its first word; that is not a stall.
          THINKING_IDLE_MS
        )
      : await this.streamed("chat", model, opts.signal, !!opts.onTextDelta, (signal) => this.api.chat.completions.create({ ...base, stream: true, stream_options: { include_usage: true } }, { signal }), opts.onTextDelta);
    return { text: out.text, toolCalls: out.toolCalls, finishReason: mapFinish(out.finish, out.toolCalls.length), usage: out.usage, model: out.model };
  }

  async json<T = unknown>(opts: JsonOptions<T>): Promise<T> {
    const r = route(opts.task);
    const once = async (model: string, effort: Effort): Promise<T> => {
      // A reasoning model thinks before its first token: give it the thinking allowance, not the 45 s hang limit.
      const wait = isReasoningModel(model) && effort !== "none" ? THINKING_IDLE_MS : undefined;
      const user: any = opts.images?.length
        ? [{ type: "text", text: opts.user }, ...opts.images.map((url) => ({ type: "image_url", image_url: { url, detail: "high" } }))]
        : opts.user;
      const out = await this.streamed(
        `json:${opts.schemaName}`,
        model,
        opts.signal,
        false,
        (signal) =>
          this.api.chat.completions.create(
            {
              model,
              messages: [
                { role: "system", content: opts.system },
                { role: "user", content: user },
              ],
              response_format: {
                type: "json_schema",
                json_schema: { name: opts.schemaName, schema: opts.schema, strict: true },
              },
              stream: true,
              ...sampling(model, 0, effort),
              ...(r.tier === "fast" ? { service_tier: "fast" as any } : {}),
            },
            { signal }
          ),
        undefined,
        wait,
        wait
      );
      const parsed = JSON.parse(out.text || "{}");
      return opts.parse ? opts.parse(parsed) : (parsed as T);
    };
    const model = opts.model || r.model;
    const effort = opts.reasoningEffort ?? r.effort;
    // An explicit model is an eval comparing models: no escalation behind its back.
    const escalate = opts.model ? null : r.escalate;
    let first: T;
    try {
      first = await once(model, effort);
    } catch (e) {
      if (!escalate || !(e instanceof SyntaxError || (e as any)?.name === "ZodError")) throw e;
      console.warn(`[llm] escalate ${opts.task} ${opts.schemaName}: ${model} gave no usable JSON (${(e as Error).message.slice(0, 120)}) → ${escalate.model}`);
      return once(escalate.model, escalate.effort);
    }
    const verdict = opts.accept ? opts.accept(first) : true;
    if (verdict === true || !escalate) return first;
    console.warn(`[llm] escalate ${opts.task} ${opts.schemaName}: ${model} failed its check (${verdict.slice(0, 160)}) → ${escalate.model}`);
    try {
      const second = await once(escalate.model, escalate.effort);
      const v2 = opts.accept!(second);
      if (v2 !== true) console.warn(`[llm] escalated ${opts.task} ${opts.schemaName} still fails its check (${v2.slice(0, 160)})`);
      return second;
    } catch (e) {
      console.warn(`[llm] escalation ${opts.task} ${opts.schemaName} failed, keeping ${model}'s result: ${(e as Error).message.slice(0, 160)}`);
      return first;
    }
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
    onTextDelta?: (delta: string) => void,
    idleMs: number = IDLE_MS,
    firstMs: number = FIRST_CHUNK_MS
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
      arm(firstMs, "first_chunk");
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
          arm(idleMs, "idle");
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
export const getLLM = (): LLMClient => {
  if (!singleton) {
    singleton = new OpenAIClient();
    console.log(`[llm] policy ${policyTable().join(" · ")}`);
  }
  return singleton;
};
