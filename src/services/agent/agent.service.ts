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
import { checkOutput, factsFallback, rewriteUnsafe, SAFE_FALLBACK, SafetyOutcome, SafetyVerdict } from "./safety/outputCheck";
import { trimFlagged, TRIM_NOTE } from "./safety/trim";
import { regionFromTimeZone } from "./safety/policy";
import { registry } from "./tools";
import { Card, cardRoleOf, ToolContext } from "./tools/registry";
import { makeSubjectResolver } from "./tools/subject";
import { checkinModeFor, CheckinMode } from "../encounter/domain/mode";
import encounterService, { CheckinThreadView } from "../encounter/model/encounter.model";
import { historyComplete } from "../encounter/domain/stateMachine";
import { turnEndNudge } from "./turnChecks";

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
  /** The thread's check-in as the app draws it. Sent every turn, after the tools that change it; null = none. */
  | { type: "checkin"; checkin: CheckinThreadView | null }
  | { type: "done"; threadId: string; messageId: string; text: string; cards: Card[]; usage: Usage | null; model: string | null; steps: number }
  | { type: "error"; message: string };

export type TurnInput = {
  patientId: string;
  threadId?: string | null;
  message: string;
  client?: ClientContext | null;
  signal?: AbortSignal;
  /** "voice": the person spoke through Siri and will hear the reply — short, plain, no cards (voice.ts). */
  channel?: "app" | "voice";
};

/**
 * `daily_checkin` was retired on 2026-09-25 (ruling): a clock-driven run has to
 * produce something every day whether or not anything happened, which is what
 * made the notes feel like boring reports. Signals replace it — they fire only
 * when a detector clears its bar.
 */
export type ProactiveKind = "weekly_review" | "signal" | "watch_out" | "plan_week";

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

const INTERRUPTED_RESULT = JSON.stringify({ error: "This tool call was interrupted before it finished. Nothing from it was saved." });

type StoredRow = { role: string; content: string; toolCalls: unknown; toolCallId: string | null; toolName: string | null };

/**
 * The provider rejects a history where an assistant tool call has no result
 * (or a result has no call) — and then EVERY later turn in that thread fails
 * ("Something went wrong answering that"). A turn cut off between the
 * ASSISTANT row and its TOOL rows left exactly that (Sep 14 2026: a phone that
 * dropped mid-turn broke its thread). Repair on read: missing results become
 * an "interrupted" result, stray results are dropped.
 */
const pairToolCalls = (rows: StoredRow[]): StoredRow[] => {
  const out: StoredRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.role === "TOOL") continue; // consumed with its ASSISTANT row below, or stray
    out.push(r);
    const calls = r.role === "ASSISTANT" && Array.isArray(r.toolCalls) ? (r.toolCalls as { id: string; name: string }[]) : [];
    if (!calls.length) continue;
    const answered = new Set<string>();
    while (i + 1 < rows.length && rows[i + 1].role === "TOOL") {
      const t = rows[++i];
      if (t.toolCallId && calls.some((c) => c.id === t.toolCallId) && !answered.has(t.toolCallId)) {
        answered.add(t.toolCallId);
        out.push(t);
      }
    }
    for (const c of calls)
      if (!answered.has(c.id)) out.push({ role: "TOOL", content: INTERRUPTED_RESULT, toolCalls: null, toolCallId: c.id, toolName: c.name });
  }
  return out;
};

/** Stored rows → provider messages. TOOL rows carry the JSON result string. */
const toChatMessages = (rows: StoredRow[]): ChatMessage[] =>
  pairToolCalls(rows).map((r): ChatMessage => {
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
    const patient = await prisma.patient.findUnique({ where: { id: patientId }, select: { firstName: true, timeZone: true } });
    const text = emergencyAnswer(flag, patient?.firstName, regionFromTimeZone(patient?.timeZone));
    const card: Card = { type: "emergency", title: "Get help now", data: { category: flag.category, offerCareTeam: true } };
    await audit(patientId, "red_flag", { threadId, messageId: userRow.id, payload: { category: flag.category, matched: flag.matched } });
    const [row] = await threadStore.append(threadId, [{ role: "ASSISTANT", content: text, cards: [card], meta: { redFlag: flag.category, model: null } }]);
    yield { type: "safety", verdict: { outcome: "red_flag", category: flag.category } };
    yield { type: "card", card };
    for (const c of chunks(text)) yield { type: "text", delta: c };
    yield { type: "done", threadId, messageId: row.id, text, cards: [card], usage: null, model: null, steps: 0 };
    return;
  }

  yield* runLoop({ patientId, threadId, client: input.client ?? null, safetyContext: message, signal: input.signal, channel: input.channel });
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

/**
 * Hands-free (Oct 7 2026): on the voice channel these writes are saved the
 * moment the tool prepares them — Siri's confirmation prompt needed a tap on
 * screen, which defeats "phone in the pocket". The person hears what was
 * logged and can say "undo" (voice.ts fast path, or the undo_last_log tool).
 * Everything else (plan changes, messages, bookings) still comes back as a
 * proposal the intent asks about.
 */
export const VOICE_AUTOSAVE_TOOLS = new Set(["log_meal", "log_workout", "undo_last_log"]);

async function* runLoop(p: {
  patientId: string;
  threadId: string;
  client: ClientContext | null;
  /** The user's message (or a note) the output classifier judges the answer against. */
  safetyContext: string;
  proactive?: ProactiveKind;
  signal?: AbortSignal;
  channel?: TurnInput["channel"];
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
  /**
   * A check-in in THIS thread widens what may be said — candidate conditions,
   * in the shape assess_checkin enforces — but only while the interview is in
   * progress (encounter/domain/mode.ts). One lookup serves both the prompt and
   * the guard, so the two can never disagree about which mode the turn is in.
   */
  const mode = await checkinModeForThread(patientId, threadId);
  const checkin = mode.active;
  // A paused check-in changes what Ollie does with that symptom (End = pause, ruling 2026-09-16).
  const pausedView = mode.paused ? await encounterService.threadView(patientId, threadId).catch(() => null) : null;
  const system = buildSystemPrompt({
    snapshotText: renderSnapshot(snapshot),
    threadSummary: window.summary,
    proactive: p.proactive ?? null,
    voice: p.channel === "voice",
    checkin,
    paused: pausedView ? { about: pausedView.about, covered: pausedView.progress.covered, total: pausedView.progress.total } : null,
    assessedConditions: mode.assessedConditions,
    // Patient-wide, unlike the mode: a workout asked for in another thread is shaped by the same check-in.
    trainingGate: await encounterService.trainingGate(patientId, threadId).catch(() => null),
    followed: (await encounterService.followed(patientId).catch(() => [])).map((e) => ({
      id: e.id,
      about: e.complaintTitle,
      inTheirWords: e.complaintText,
      day: e.followUp.day,
      due: e.followUp.due,
      nextDay: e.nextDay,
      askedHere: !!e.awaiting && e.awaiting.threadId === threadId,
      answeredToday: e.answeredToday,
      raise: e.raise,
    })),
  });
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
  /** Cards from lookups (see ToolDef.cardRole) — shown at the end, only if nothing actionable came out of the turn. */
  const lookupCards: Card[] = [];
  /** Each read tool's code-built statement of what it returned — the reply of last resort (`factsFallback`). */
  const readFacts: string[] = [];
  let usage: Usage | null = null;
  let model: string | null = null;
  let steps = 0;
  let draft = "";
  /** Fixed copy a tool pinned for this turn (the crisis script). First one wins. */
  let pinned: string | null = null;
  let proposedThisTurn = false;
  let savedThisTurn = false;
  // A generate tool (workout, meal plan, recipe…) renders a card of its own, so a
  // reply that talks about "the card" is honest — the claim guard must not fire.
  let generatedThisTurn = false;
  let usedTools = false;
  let nudged = false;
  const toolsCalled: string[] = [];
  let assessRejected: string | null = null;

  try {
    while (steps < MAX_STEPS) {
      steps += 1;
      if (steps > 1) yield { type: "status", text: "Thinking" };
      const res = await llm.chat({ messages, tools: registry.specs(), signal: p.signal });
      usage = addUsage(usage, res.usage);
      model = res.model;

      if (res.finishReason !== "tool_calls" || res.toolCalls.length === 0) {
        // The words and the tool calls must agree (turnChecks.ts) — one nudge per turn at most.
        if (!nudged) {
          const live = await encounterService.activeForThread(patientId, threadId).catch(() => null);
          const nudge = turnEndNudge({
            text: res.text ?? "",
            userMessage: p.proactive ? "" : p.safetyContext ?? "",
            proactive: p.proactive ?? null,
            usedTools,
            toolsCalled,
            saved: savedThisTurn,
            proposed: proposedThisTurn,
            generated: generatedThisTurn,
            followUpToRaise: p.proactive ? null : await encounterService.followed(patientId).then((rows) => rows.find((e) => e.raise)?.complaintTitle ?? null).catch(() => null),
            checkin: {
              inThread: checkin || mode.paused || mode.assessedConditions.length > 0 || toolsCalled.includes("start_checkin"),
              active: !!live && live.state.phase !== "ROUTE" && live.state.phase !== "CLOSED",
              historyComplete: !!live && historyComplete(live.state, live.protocol),
              flagged: !!live && live.state.redFlags.length > 0,
              rejected: assessRejected,
            },
          });
          if (nudge) {
            nudged = true;
            void audit(patientId, "error", { threadId, payload: { stage: nudge.stage, text: (res.text ?? "").slice(0, 300) } });
            messages.push({ role: "assistant", content: res.text ?? "" });
            messages.push({ role: "user", content: nudge.message });
            continue;
          }
        }
        draft = res.text;
        break;
      }

      await threadStore.append(threadId, [{ role: "ASSISTANT", content: res.text ?? "", toolCalls: res.toolCalls, meta: { model } }]);
      messages.push({ role: "assistant", content: res.text ?? "", toolCalls: res.toolCalls });
      for (const [n, call] of res.toolCalls.entries()) {
        if (p.signal?.aborted) {
          // Stopped mid-step: answer the calls that will not run so the thread stays valid.
          await threadStore.append(
            threadId,
            res.toolCalls.slice(n).map((c) => ({ role: "TOOL" as const, toolCallId: c.id, toolName: c.name, content: INTERRUPTED_RESULT, meta: { ok: false, error: "cancelled" } }))
          );
          return;
        }
        usedTools = true;
        toolsCalled.push(call.name);
        yield { type: "tool_start", id: call.id, name: call.name, input: call.input };
        const tool = registry.get(call.name);
        if (tool?.risk === "generate") generatedThisTurn = true;
        void audit(patientId, tool?.risk === "memory" ? "memory_write" : "tool_call", { threadId, toolName: call.name, payload: { input: call.input } });
        const out = await registry.execute(call.name, call.input, ctx);
        let modelResult: unknown = out.result;
        if (call.name === "assess_checkin") assessRejected = (out.result as any)?.rejected ? String((out.result as any).fix ?? "rejected") : null;
        if (out.ok && out.proposal) {
          const pr = await proposalStore.create(patientId, threadId, call.name, out.input, out.proposal);
          const auto = p.channel === "voice" && VOICE_AUTOSAVE_TOOLS.has(call.name) ? await proposalStore.confirm(patientId, pr.id, null, undefined, { auto: "voice" }) : null;
          if (auto && auto.status === 200) {
            // Voice: saved at once; the person hears it and can say "undo".
            for (const card of auto.cards) {
              cards.push(card);
              yield { type: "card", card };
            }
            savedThisTurn = true;
            modelResult = { saved: true, summary: pr.summary, result: auto.result, note: "SAVED — no confirmation needed. Say in one sentence what was logged (with the calories), then: say undo if that's wrong." };
          } else {
            // Write tool: nothing happened yet. Park it for the user to confirm.
            const card: Card = { type: "proposal", title: pr.title, data: { proposalId: pr.id, toolName: call.name, summary: pr.summary, preview: pr.preview, expiresAt: pr.expiresAt.toISOString() } };
            cards.push(card);
            proposedThisTurn = true;
            yield { type: "proposal", proposalId: pr.id, toolName: call.name, title: pr.title, summary: pr.summary, preview: pr.preview, expiresAt: pr.expiresAt.toISOString() };
            yield { type: "card", card };
            modelResult = { proposed: true, proposalId: pr.id, summary: pr.summary, preview: out.result, note: "NOT saved yet — the user must confirm the card. Tell them what you prepared and ask them to confirm; do not say it is logged/sent/booked." };
          }
        }
        let content = JSON.stringify(modelResult);
        if (content.length > MAX_TOOL_RESULT_CHARS) content = content.slice(0, MAX_TOOL_RESULT_CHARS) + '…(truncated)"}';
        await threadStore.append(threadId, [{ role: "TOOL", toolCallId: call.id, toolName: call.name, content, meta: { ok: out.ok, error: out.error ?? null } }]);
        messages.push({ role: "tool", toolCallId: call.id, name: call.name, content });
        yield { type: "tool_result", id: call.id, name: call.name, ok: out.ok, ...(out.error ? { error: out.error } : {}) };
        if (out.ok && out.pinnedAnswer && !pinned) pinned = String(out.pinnedAnswer);
        if (out.ok && out.facts) readFacts.push(String(out.facts));
        // A card whose button performs a write: park it now, no proposal card.
        if (out.ok && out.prepared && out.cards?.[out.prepared.card ?? 0]) {
          try {
            const pr = await proposalStore.create(patientId, threadId, out.prepared.toolName, out.prepared.input, out.prepared.proposal, { viaCard: true });
            const target = out.cards[out.prepared.card ?? 0];
            target.data = { ...(target.data as object), proposalId: pr.id };
          } catch (e) {
            // The card still works through the chat fallback.
            console.error("agent: prepared write failed", e);
          }
        }
        const lookup = cardRoleOf(tool) === "lookup";
        for (const card of out.cards ?? []) {
          if (lookup) {
            lookupCards.push(card);
            continue;
          }
          cards.push(card);
          yield { type: "card", card };
        }
      }
    }
    // A lookup is context for the answer. Beside a suggestion, a portion or a
    // proposal it is noise (seen Sep 28 2026: a "1 of 1 days logged" card with
    // empty bars above a dinner portion nobody asked about the day for).
    if (!cards.length)
      for (const card of lookupCards) {
        cards.push(card);
        yield { type: "card", card };
      }
    if (!draft.trim()) {
      draft = steps >= MAX_STEPS ? "I got a bit lost pulling that together — can you ask me in a smaller piece?" : "I didn't manage to put an answer together. Could you rephrase?";
    }
    // Fixed copy wins over whatever the model wrote — see ToolOutcome.pinnedAnswer.
    if (pinned) draft = pinned;

    if (p.signal?.aborted) return;

    /* ---------------------------- output safety ---------------------------- */
    yield { type: "status", text: "Checking" };
    const onRecord = { conditions: snapshot.records.conditions, medications: snapshot.records.medications.map((m) => m.name) };
    let verdict: SafetyVerdict;
    let text = draft;
    const handoffCards: Card[] = [];
    const recheck = (answer: string) => checkOutput(llm, p.safetyContext, answer, onRecord, { checkin, assessedConditions: mode.assessedConditions });
    // No wording passed: state what the turn read, or — having read nothing — decline.
    const lastResort = (v: SafetyVerdict): SafetyVerdict => {
      // A missed emergency is not answered with a list of lab values.
      const facts = v.missedRedFlag ? null : factsFallback(readFacts);
      if (facts) {
        text = facts;
        return { ...v, outcome: "facts" };
      }
      text = SAFE_FALLBACK;
      const card: Card = { type: "care_team_handoff", title: "Ask your care team", data: { reason: "clinical question" } };
      cards.push(card);
      handoffCards.push(card);
      return { ...v, outcome: "fallback" };
    };
    try {
      verdict = pinned
        ? { ok: true, diagnosis: false, medicationAdvice: false, reassurance: false, missedRedFlag: false, lexical: [], quotes: [], reasons: "fixed escalation copy — written by the domain layer, not the model" }
        : await recheck(draft);
      if (verdict.ok) verdict.outcome = "pass";
      else {
        void audit(patientId, "safety_flag", { threadId, payload: { stage: "draft", verdict, draft: draft.slice(0, 2000) } });
        const rewritten = await rewriteUnsafe(llm, draft, verdict);
        const second = await recheck(rewritten);
        if (second.ok) {
          text = rewritten;
          verdict = { ...verdict, outcome: "rewritten" };
        } else {
          void audit(patientId, "safety_flag", { threadId, payload: { stage: "rewrite", verdict: second, draft: rewritten.slice(0, 2000) } });
          // Cut what was flagged and keep the rest. Cutting cannot add the urgent-care line a missed emergency needs.
          const cut = second.missedRedFlag ? null : trimFlagged(rewritten, second.quotes);
          const third = cut ? await recheck(cut.text) : null;
          if (cut && third?.ok) {
            void audit(patientId, "safety_flag", { threadId, payload: { stage: "trimmed", removed: cut.removed } });
            text = `${cut.text}\n\n${TRIM_NOTE}`;
            verdict = { ...second, outcome: "trimmed" };
          } else {
            if (cut && third) void audit(patientId, "safety_flag", { threadId, payload: { stage: "trim", verdict: third, draft: cut.text.slice(0, 2000) } });
            verdict = lastResort(third ?? second);
          }
        }
      }
    } catch (e) {
      // The classifier failing must not leak an unchecked answer.
      console.error("agent safety check failed", e);
      void audit(patientId, "error", { threadId, payload: { stage: "safety", error: String(e) } });
      verdict = lastResort({ ok: false, diagnosis: false, medicationAdvice: false, reassurance: false, missedRedFlag: false, lexical: [], quotes: [], reasons: "classifier unavailable — fallback used" });
    }
    for (const card of handoffCards) yield { type: "card", card };

    const flagged = [
      verdict.diagnosis && "diagnosis",
      verdict.medicationAdvice && "medication_advice",
      verdict.reassurance && "reassurance",
      verdict.missedRedFlag && "missed_red_flag",
      ...(verdict.lexical ?? []).map((f) => `lexical:${f.ruleId}`),
    ].filter((x): x is string => !!x);
    yield { type: "safety", verdict: { outcome: verdict.outcome ?? "pass", flagged } };
    for (const c of chunks(text)) yield { type: "text", delta: c };

    const [row] = await threadStore.append(threadId, [
      { role: "ASSISTANT", content: text, cards, meta: { model, usage, steps, safety: verdict, snapshotChars: system.length, proactive: p.proactive ?? null } },
    ]);
    void audit(patientId, "response", { threadId, messageId: row.id, payload: { model, usage, steps, safety: verdict.reasons, proactive: p.proactive ?? null } });
    // After the tools, since they are what start, advance and end a check-in.
    yield { type: "checkin", checkin: await encounterService.threadView(patientId, threadId).catch(() => null) };
    yield { type: "done", threadId, messageId: row.id, text, cards, usage, model, steps };

    if (window.unsummarized.length >= SUMMARIZE_AFTER_ROWS) void summarizeThread(llm, threadId, window.summary, window.unsummarized);
  } catch (e: any) {
    if (p.signal?.aborted) return;
    console.error("agent loop failed", e);
    void audit(patientId, "error", { threadId, payload: { error: e?.message ?? String(e), steps } });
    yield { type: "error", message: e?.message?.includes("API key") ? "The assistant is not configured (missing API key)" : "Something went wrong answering that" };
  }
}

/**
 * The check-in mode for this thread: its latest encounter, plus the latest
 * assessment only when the interview is over. A lookup failure means OFF —
 * the ordinary boundary is the safe default.
 */
async function checkinModeForThread(patientId: string, threadId: string): Promise<CheckinMode> {
  try {
    const enc = await prisma.encounter.findFirst({
      where: { patientId, threadId },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, phase: true },
    });
    if (!enc) return checkinModeFor(null);
    const mode = checkinModeFor(enc);
    if (mode.active) return mode;
    const assessed = await prisma.encounterEvent.findFirst({
      where: { encounterId: enc.id, kind: "assessment" },
      orderBy: { seq: "desc" },
      select: { payload: true },
    });
    return checkinModeFor(enc, (assessed?.payload as any) ?? null);
  } catch (e) {
    console.error("check-in mode lookup failed", e);
    return checkinModeFor(null);
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
  const checkin = events.find((e): e is Extract<AgentEvent, { type: "checkin" }> => e.type === "checkin")?.checkin ?? null;
  return { threadId, done: done ?? null, error: error?.message ?? null, safety: safety?.verdict ?? null, checkin, events };
}

export const runTurnCollect = (input: TurnInput) => collect(runTurn(input));
export const runProactiveCollect = (input: ProactiveInput) => collect(runProactive(input));
