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
      this.client = new OpenAI({ apiKey });
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

    if (!opts.onTextDelta) {
      const res = await this.api.chat.completions.create({ ...base, stream: false }, { signal: opts.signal });
      const choice = res.choices[0];
      const toolCalls: ToolCallRequest[] = (choice.message.tool_calls ?? [])
        .filter((c): c is OpenAI.Chat.Completions.ChatCompletionMessageToolCall & { type: "function" } => c.type === "function")
        .map((c) => ({ id: c.id, name: c.function.name, input: parseArgs(c.function.arguments) }));
      return {
        text: choice.message.content ?? "",
        toolCalls,
        finishReason: mapFinish(choice.finish_reason, toolCalls.length),
        usage: usageOf(res.usage),
        model: res.model,
      };
    }

    const stream = await this.api.chat.completions.create(
      { ...base, stream: true, stream_options: { include_usage: true } },
      { signal: opts.signal }
    );
    let text = "";
    let finish: string | null = null;
    let usage: Usage | null = null;
    let modelName = model;
    const calls = new Map<number, { id: string; name: string; args: string }>();
    for await (const chunk of stream) {
      if (chunk.usage) usage = usageOf(chunk.usage);
      if (chunk.model) modelName = chunk.model;
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta;
      if (delta?.content) {
        text += delta.content;
        opts.onTextDelta(delta.content);
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
    const toolCalls = Array.from(calls.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, c]) => ({ id: c.id, name: c.name, input: parseArgs(c.args) }));
    return { text, toolCalls, finishReason: mapFinish(finish, toolCalls.length), usage, model: modelName };
  }

  async json<T = unknown>(opts: JsonOptions<T>): Promise<T> {
    const model = opts.model || this.fastModel;
    const res = await this.api.chat.completions.create({
      model,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: opts.schemaName, schema: opts.schema, strict: true },
      },
      ...sampling(model, 0),
    });
    const raw = res.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw);
    return opts.parse ? opts.parse(parsed) : (parsed as T);
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
