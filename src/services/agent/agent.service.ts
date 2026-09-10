import prisma from "../../utility/prismaClient";
import { buildPatientSnapshot, renderSnapshot, ClientContext, PatientSnapshot } from "./context/snapshot";
import { getLLM } from "./llm/openai.client";
import { ChatMessage, LLMClient, Usage } from "./llm/types";
import { audit } from "./memory/audit";
import { dayKey, safeTz } from "./memory/dates";
import threadStore from "./memory/thread.store";
import proposalStore from "./memory/proposals.store";
import { buildSystemPrompt } from "./prompt/system";
import { detectRedFlag, emergencyAnswer } from "./safety/redFlags";
import { checkOutput, rewriteUnsafe, SAFE_FALLBACK, SafetyOutcome, SafetyVerdict } from "./safety/outputCheck";
import { registry } from "./tools";
import { Card, ToolContext } from "./tools/registry";
import { makeSubjectResolver } from "./tools/subject";

/**
 * The agent loop, as an event stream. Two entry points share it:
 *
 *   runTurn       a user message  → persist USER → red-flag gate → loop
 *   runProactive  a job trigger   → persist SYSTEM instruction → loop
 *
 * Loop = snapshot + system prompt → model/tool steps (write tools become
 * proposals) → output safety check (buffered, never streamed raw) → emit
 * text → persist ASSISTANT + audit → (async) fold old turns into the summary.
 */

export type AgentEvent =
  | { type: "thread"; threadId: string }
  | { type: "status"; text: string }
  | { type: "tool_start"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; name: string; ok: boolean; error?: string }
  | { type: "card"; card: Card }
  | { type: "proposal"; proposalId: string; toolName: string; title: string; summary: string; preview: unknown; expiresAt: string }
  | { type: "text"; delta: string }
  | { type: "safety"; verdict: { outcome: SafetyOutcome; flagged: string[] } | { outcome: "red_flag"; category: string } }
  | { type: "done"; threadId: string; messageId: string; text: string; cards: Card[]; usage: Usage | null; model: string | null; steps: number }
  | { type: "error"; message: string };

export type TurnInput = {
  patientId: string;
  threadId?: string | null;
  message: string;
  client?: ClientContext | null;
  signal?: AbortSignal;
};

export type ProactiveKind = "weekly_review" | "daily_checkin" | "watch_out" | "plan_week";

export type ProactiveInput = {
  patientId: string;
  kind: ProactiveKind;
  title: string;
  /** What the agent should do this run — written by proactive.service.ts. */
  instruction: string;
  /** Reuse an existing PROACTIVE thread (e.g. the week's review thread). */
  threadId?: string | null;
  signal?: AbortSignal;
};

const MAX_STEPS = 8;
const MAX_TOOL_RESULT_CHARS = 12_000;
const SUMMARIZE_AFTER_ROWS = 8;

const addUsage = (a: Usage | null, b: Usage | null): Usage | null =>
  !a ? b : !b ? a : { inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens, cachedInputTokens: (a.cachedInputTokens ?? 0) + (b.cachedInputTokens ?? 0) };

/** Stored rows → provider messages. TOOL rows carry the JSON result string. */
const toChatMessages = (rows: { role: string; content: string; toolCalls: unknown; toolCallId: string | null; toolName: string | null }[]): ChatMessage[] =>
  rows.map((r): ChatMessage => {
    switch (r.role) {
      case "USER":
        return { role: "user", content: r.content };
      case "ASSISTANT":
        return { role: "assistant", content: r.content, toolCalls: (r.toolCalls as any) ?? undefined };
      case "TOOL":
        return { role: "tool", toolCallId: r.toolCallId ?? "", name: r.toolName ?? "", content: r.content };
      default:
        return { role: "system", content: r.content };
    }
  });

/** Emit buffered text in sentence-ish chunks so the client still feels streamed. */
function* chunks(text: string) {
  const re = /[^.!?\n]+[.!?\n]*\s*/g;
  let m: RegExpExecArray | null;
  let last = 0;
  while ((m = re.exec(text))) {
    yield m[0];
    last = re.lastIndex;
  }
  if (last < text.length) yield text.slice(last);
}

/* ============================== entry points ============================== */

/** Phrases that only make sense after a write tool produced a proposal card. */
const CLAIMS_CARD =
  /\b(prepar\w*|ready)\b[^.!?\n]{0,80}\b(card|entry|log|logged|confirm)\b|\bcard\b[^.!?\n]{0,60}\b(confirm|edit|review)\b|\byou'?ll see a card\b|\bconfirm\b[^.!?\n]{0,40}\b(in|on) the app\b|\breview and confirm\b|\btap confirm\b/i;

export async function* runTurn(input: TurnInput): AsyncGenerator<AgentEvent> {
  const { patientId } = input;
  const message = input.message.trim();

  let thread = input.threadId ? await threadStore.get(patientId, input.threadId) : null;
  if (!thread) thread = await threadStore.create(patientId);
  const threadId = thread.id;
  yield { type: "thread", threadId };

  const [userRow] = await threadStore.append(threadId, [{ role: "USER", content: message }]);

  /* ------------------------- red-flag gate (no model) ------------------------ */
  const flag = detectRedFlag(message);
  if (flag) {
    const patient = await prisma.patient.findUnique({ where: { id: patientId }, select: { firstName: true } });
    const text = emergencyAnswer(flag, patient?.firstName);
    const card: Card = { type: "emergency", title: "Get help now", data: { category: flag.category, offerCareTeam: true } };
    await audit(patientId, "red_flag", { threadId, messageId: userRow.id, payload: { category: flag.category, matched: flag.matched } });
    const [row] = await threadStore.append(threadId, [{ role: "ASSISTANT", content: text, cards: [card], meta: { redFlag: flag.category, model: null } }]);
    yield { type: "safety", verdict: { outcome: "red_flag", category: flag.category } };
    yield { type: "card", card };
    for (const c of chunks(text)) yield { type: "text", delta: c };
    yield { type: "done", threadId, messageId: row.id, text, cards: [card], usage: null, model: null, steps: 0 };
    return;
  }

  yield* runLoop({ patientId, threadId, client: input.client ?? null, safetyContext: message, signal: input.signal });
}

export async function* runProactive(input: ProactiveInput): AsyncGenerator<AgentEvent> {
  const { patientId } = input;
  let thread = input.threadId ? await threadStore.get(patientId, input.threadId) : null;
  if (!thread) thread = await threadStore.create(patientId, { source: "PROACTIVE", title: input.title });
  const threadId = thread.id;
  yield { type: "thread", threadId };
  await threadStore.append(threadId, [{ role: "SYSTEM", content: input.instruction, meta: { proactive: input.kind } }]);
  yield* runLoop({ patientId, threadId, client: null, safetyContext: `(scheduled ${input.kind.replace("_", " ")} — no user message)`, proactive: input.kind, signal: input.signal });
}

/* ================================ the loop ================================ */

async function* runLoop(p: {
  patientId: string;
  threadId: string;
  client: ClientContext | null;
  /** The user's message (or a note) the output classifier judges the answer against. */
  safetyContext: string;
  proactive?: ProactiveKind;
  signal?: AbortSignal;
}): AsyncGenerator<AgentEvent> {
  const llm: LLMClient = getLLM();
  const { patientId, threadId } = p;

  yield { type: "status", text: "Reading your data" };
  let snapshot: PatientSnapshot | null = null;
  try {
    snapshot = await buildPatientSnapshot(patientId, p.client);
  } catch (e) {
    console.error("agent snapshot failed", e);
  }
  if (!snapshot) {
    yield { type: "error", message: "Could not load your profile" };
    return;
  }
  const tz = safeTz(snapshot.timeZone);
  const window = await threadStore.contextWindow(threadId);
  const system = buildSystemPrompt({ snapshotText: renderSnapshot(snapshot), threadSummary: window.summary, proactive: p.proactive ?? null });
  const messages: ChatMessage[] = [{ role: "system", content: system }, ...toChatMessages(window.messages)];

  const ctx: ToolContext = {
    patientId,
    threadId,
    timeZone: tz,
    today: dayKey(tz),
    resolveSubject: makeSubjectResolver(patientId),
    client: p.client,
  };

  const cards: Card[] = [];
  let usage: Usage | null = null;
  let model: string | null = null;
  let steps = 0;
  let draft = "";
  let proposedThisTurn = false;
  let usedTools = false;
  let nudged = false;

  try {
    while (steps < MAX_STEPS) {
      steps += 1;
      if (steps > 1) yield { type: "status", text: "Thinking" };
      const res = await llm.chat({ messages, tools: registry.specs(), signal: p.signal });
      usage = addUsage(usage, res.usage);
      model = res.model;

      if (res.finishReason !== "tool_calls" || res.toolCalls.length === 0) {
        // A reply that talks about a card or asks for confirmation when no
        // write tool ran this turn is a hallucinated proposal (seen 2026-08-27:
        // "I've prepared a card to log…" with tools=[]). Nudge once to call it.
        // Weekly review: the snapshot is THIS week; judging last week without
        // reading it (seen 2026-08-27: no tool calls, this week's numbers quoted
        // as last week's) is wrong. Force the reads once.
        if (!nudged && p.proactive === "weekly_review" && !usedTools) {
          nudged = true;
          void audit(patientId, "error", { threadId, payload: { stage: "weekly_review_without_reads", text: (res.text ?? "").slice(0, 300) } });
          messages.push({ role: "assistant", content: res.text ?? "" });
          messages.push({
            role: "user",
            content: "[System: the snapshot describes the CURRENT week, not the week under review. Call get_nutrition_summary, get_activity and get_workouts for the exact range given in the review instruction, then write the review from those results.]",
          });
          continue;
        }
        if (!nudged && !proposedThisTurn && !p.proactive && CLAIMS_CARD.test(res.text ?? "")) {
          nudged = true;
          void audit(patientId, "error", { threadId, payload: { stage: "claim_without_proposal", text: (res.text ?? "").slice(0, 300) } });
          messages.push({ role: "assistant", content: res.text ?? "" });
          messages.push({
            role: "user",
            content:
              "[System: your reply describes a card or asks the user to confirm, but no tool was called this turn — nothing was prepared. Call the right tool now with the user's words verbatim (log_meal, log_workout, log_vital, message_care_team, book_appointment, update_plan_targets, save_workout_plan, update_training_profile, move_workout), or answer plainly without claiming anything was prepared.]",
          });
          continue;
        }
        draft = res.text;
        break;
      }

      await threadStore.append(threadId, [{ role: "ASSISTANT", content: res.text ?? "", toolCalls: res.toolCalls, meta: { model } }]);
      messages.push({ role: "assistant", content: res.text ?? "", toolCalls: res.toolCalls });
      for (const call of res.toolCalls) {
        usedTools = true;
        yield { type: "tool_start", id: call.id, name: call.name, input: call.input };
        const tool = registry.get(call.name);
        void audit(patientId, tool?.risk === "memory" ? "memory_write" : "tool_call", { threadId, toolName: call.name, payload: { input: call.input } });
        const out = await registry.execute(call.name, call.input, ctx);
        let modelResult: unknown = out.result;
        if (out.ok && out.proposal) {
          // Write tool: nothing happened yet. Park it for the user to confirm.
          const pr = await proposalStore.create(patientId, threadId, call.name, out.input, out.proposal);
          const card: Card = { type: "proposal", title: pr.title, data: { proposalId: pr.id, toolName: call.name, summary: pr.summary, preview: pr.preview, expiresAt: pr.expiresAt.toISOString() } };
          cards.push(card);
          proposedThisTurn = true;
          yield { type: "proposal", proposalId: pr.id, toolName: call.name, title: pr.title, summary: pr.summary, preview: pr.preview, expiresAt: pr.expiresAt.toISOString() };
          yield { type: "card", card };
          modelResult = { proposed: true, proposalId: pr.id, summary: pr.summary, preview: out.result, note: "NOT saved yet — the user must confirm the card in the app. Tell them what you prepared and ask them to confirm; do not say it is logged/sent/booked." };
        }
        let content = JSON.stringify(modelResult);
        if (content.length > MAX_TOOL_RESULT_CHARS) content = content.slice(0, MAX_TOOL_RESULT_CHARS) + '…(truncated)"}';
        await threadStore.append(threadId, [{ role: "TOOL", toolCallId: call.id, toolName: call.name, content, meta: { ok: out.ok, error: out.error ?? null } }]);
        messages.push({ role: "tool", toolCallId: call.id, name: call.name, content });
        yield { type: "tool_result", id: call.id, name: call.name, ok: out.ok, ...(out.error ? { error: out.error } : {}) };
        for (const card of out.cards ?? []) {
          cards.push(card);
          yield { type: "card", card };
        }
      }
    }
    if (!draft.trim()) {
      draft = steps >= MAX_STEPS ? "I got a bit lost pulling that together — can you ask me in a smaller piece?" : "I didn't manage to put an answer together. Could you rephrase?";
    }

    /* ---------------------------- output safety ---------------------------- */
    yield { type: "status", text: "Checking" };
    const onRecord = { conditions: snapshot.records.conditions, medications: snapshot.records.medications.map((m) => m.name) };
    let verdict: SafetyVerdict;
    let text = draft;
    try {
      verdict = await checkOutput(llm, p.safetyContext, draft, onRecord);
      if (verdict.ok) verdict.outcome = "pass";
      else {
        void audit(patientId, "safety_flag", { threadId, payload: { stage: "draft", verdict, draft: draft.slice(0, 2000) } });
        const rewritten = await rewriteUnsafe(llm, draft, verdict);
        const second = await checkOutput(llm, p.safetyContext, rewritten, onRecord);
        if (second.ok) {
          text = rewritten;
          verdict = { ...verdict, outcome: "rewritten" };
        } else {
          void audit(patientId, "safety_flag", { threadId, payload: { stage: "rewrite", verdict: second, draft: rewritten.slice(0, 2000) } });
          text = SAFE_FALLBACK;
          const card: Card = { type: "care_team_handoff", title: "Ask your care team", data: { reason: "clinical question" } };
          cards.push(card);
          yield { type: "card", card };
          verdict = { ...second, outcome: "fallback" };
        }
      }
    } catch (e) {
      // The classifier failing must not leak an unchecked answer.
      console.error("agent safety check failed", e);
      void audit(patientId, "error", { threadId, payload: { stage: "safety", error: String(e) } });
      text = SAFE_FALLBACK;
      verdict = { ok: false, diagnosis: false, medicationAdvice: false, missedRedFlag: false, reasons: "classifier unavailable — fallback used", outcome: "fallback" };
    }

    const flagged = [verdict.diagnosis && "diagnosis", verdict.medicationAdvice && "medication_advice", verdict.missedRedFlag && "missed_red_flag"].filter((x): x is string => !!x);
    yield { type: "safety", verdict: { outcome: verdict.outcome ?? "pass", flagged } };
    for (const c of chunks(text)) yield { type: "text", delta: c };

    const [row] = await threadStore.append(threadId, [
      { role: "ASSISTANT", content: text, cards, meta: { model, usage, steps, safety: verdict, snapshotChars: system.length, proactive: p.proactive ?? null } },
    ]);
    void audit(patientId, "response", { threadId, messageId: row.id, payload: { model, usage, steps, safety: verdict.reasons, proactive: p.proactive ?? null } });
    yield { type: "done", threadId, messageId: row.id, text, cards, usage, model, steps };

    if (window.unsummarized.length >= SUMMARIZE_AFTER_ROWS) void summarizeThread(llm, threadId, window.summary, window.unsummarized);
  } catch (e: any) {
    if (p.signal?.aborted) return;
    console.error("agent loop failed", e);
    void audit(patientId, "error", { threadId, payload: { error: e?.message ?? String(e), steps } });
    yield { type: "error", message: e?.message?.includes("API key") ? "The assistant is not configured (missing API key)" : "Something went wrong answering that" };
  }
}

async function summarizeThread(llm: LLMClient, threadId: string, previous: string | null, rows: { seq: number; role: string; content: string; toolName: string | null }[]) {
  try {
    const transcript = rows
      .map((r) => (r.role === "TOOL" ? `[tool ${r.toolName}] ${r.content.slice(0, 300)}` : `${r.role}: ${r.content.slice(0, 1200)}`))
      .join("\n");
    const { summary } = await llm.json<{ summary: string }>({
      system: "Maintain a running summary of a coaching conversation between a user and their health assistant. Keep facts, numbers, decisions, open questions and the user's stated preferences. Drop pleasantries. Max 200 words. Return the updated summary.",
      user: `PREVIOUS SUMMARY:\n${previous ?? "(none)"}\n\nNEW TURNS:\n${transcript}`,
      schema: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"], additionalProperties: false },
      schemaName: "thread_summary",
    });
    await threadStore.setSummary(threadId, summary, rows[rows.length - 1].seq);
  } catch (e) {
    console.error("agent summarize failed", e);
  }
}

/** Collect a generator's events into one result (non-streaming callers, jobs, tests). */
export async function collect(gen: AsyncGenerator<AgentEvent>) {
  const events: AgentEvent[] = [];
  for await (const ev of gen) events.push(ev);
  const done = events.find((e): e is Extract<AgentEvent, { type: "done" }> => e.type === "done");
  const error = events.find((e): e is Extract<AgentEvent, { type: "error" }> => e.type === "error");
  const safety = events.find((e): e is Extract<AgentEvent, { type: "safety" }> => e.type === "safety");
  const threadId = events.find((e): e is Extract<AgentEvent, { type: "thread" }> => e.type === "thread")?.threadId ?? null;
  return { threadId, done: done ?? null, error: error?.message ?? null, safety: safety?.verdict ?? null, events };
}

export const runTurnCollect = (input: TurnInput) => collect(runTurn(input));
export const runProactiveCollect = (input: ProactiveInput) => collect(runProactive(input));
