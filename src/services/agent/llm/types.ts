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
  model?: string;
  signal?: AbortSignal;
};

export type JsonOptions<T> = {
  system: string;
  user: string;
  /** JSON Schema the model must satisfy; the adapter parses and returns it. */
  schema: Record<string, unknown>;
  schemaName: string;
  model?: string;
  parse?: (raw: unknown) => T;
};

export interface LLMClient {
  readonly defaultModel: string;
  readonly fastModel: string;
  chat(opts: ChatOptions): Promise<ChatResult>;
  /** Small structured call for classifiers / summarizers. */
  json<T = unknown>(opts: JsonOptions<T>): Promise<T>;
}
