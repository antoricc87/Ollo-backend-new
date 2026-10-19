import type { Effort, Task } from "./policy";

/**
 * Provider-neutral LLM surface used by the agent loop. Keep this small so a
 * second provider is a one-file adapter, not a rewrite.
 */

export type ChatRole = "system" | "user" | "assistant" | "tool";

export type ToolCallRequest = { id: string; name: string; input: Record<string, unknown> };

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCallRequest[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export type ToolSpec = {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
};

export type Usage = { inputTokens: number; outputTokens: number; cachedInputTokens?: number };

export type ChatResult = {
  text: string;
  toolCalls: ToolCallRequest[];
  finishReason: "stop" | "tool_calls" | "length" | "other";
  usage: Usage | null;
  model: string;
};

export type ChatOptions = {
  messages: ChatMessage[];
  tools?: ToolSpec[];
  /** Called with text deltas as they stream. Omit for a non-streaming call. */
  onTextDelta?: (delta: string) => void;
  maxOutputTokens?: number;
  /** The kind of work (llm/policy.ts) — it picks the model and the thinking. Default "converse". */
  task?: Task;
  /** Only to compare models in an eval; production code names a task instead. */
  model?: string;
  /** Overrides the task's thinking level (reasoning models only). */
  reasoningEffort?: Effort;
  /** Groups calls that share a long prefix (one person's turns) so OpenAI's prompt cache hits. */
  cacheKey?: string;
  signal?: AbortSignal;
};

export type JsonOptions<T> = {
  system: string;
  user: string;
  /** JSON Schema the model must satisfy; the adapter parses and returns it. */
  schema: Record<string, unknown>;
  schemaName: string;
  /** The kind of work (llm/policy.ts) — it picks the model, the thinking and the escalation. */
  task: Task;
  /** Only to compare models in an eval; production code names a task instead. */
  model?: string;
  reasoningEffort?: Effort;
  /** Images to read with the text (data: URLs or https), for extract_vision. */
  images?: string[];
  /**
   * The caller's own check of the result: true, or why it fails. When it fails (or the reply is not
   * valid JSON) and the task has an escalation model, the same call runs once more there.
   */
  accept?: (value: T) => true | string;
  parse?: (raw: unknown) => T;
  signal?: AbortSignal;
};

export interface LLMClient {
  readonly defaultModel: string;
  readonly fastModel: string;
  chat(opts: ChatOptions): Promise<ChatResult>;
  /** Small structured call for classifiers / summarizers. */
  json<T = unknown>(opts: JsonOptions<T>): Promise<T>;
}
