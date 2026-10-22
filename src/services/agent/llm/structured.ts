import OpenAI from "openai";

/**
 * THE OpenAI connection for structured Responses-API calls (meals, food matching, labs, insurance).
 * Before (R1, Oct 19 2026) each of those areas opened its own client with its own habits — the lab
 * client had NO deadline, so a call OpenAI never answered (seen: 3 of 13 verify calls on a scanned
 * report, Oct 19) held the upload for the SDK default of 10 minutes × 3 attempts. Now every caller gets
 * a deadline and one retry from here; the deadline is the caller's, because a long extraction (an
 * insurance summary) legitimately takes minutes while a meal never should.
 * Which MODEL runs is still agent/llm/policy.ts's decision, not this file's.
 */
const clients = new Map<number, OpenAI>();

export const DEADLINE_MS = {
  /** A meal or a food-database pick: typically 3–6 s; hung requests were seen at ~45 s. */
  quick: Number(process.env.LLM_DEADLINE_QUICK_MS || 20_000),
  /** One page or strip of a document, thinking included: typically 2–12 s. */
  page: Number(process.env.LLM_DEADLINE_PAGE_MS || 60_000),
  /** A whole long document in one call (an insurance benefits summary). */
  document: Number(process.env.LLM_DEADLINE_DOCUMENT_MS || 180_000),
};

export const structuredClient = (deadlineMs: number): OpenAI => {
  let c = clients.get(deadlineMs);
  if (!c) {
    // One retry: a request that hit its deadline is sent again once, then the error surfaces.
    c = new OpenAI({ apiKey: process.env.REACT_APP_OPENAI_API_KEY || process.env.OPENAI_API_KEY || "", timeout: deadlineMs, maxRetries: 1 });
    clients.set(deadlineMs, c);
  }
  return c;
};
