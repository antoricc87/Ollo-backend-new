/**
 * ONE MODEL POLICY FOR EVERY CALL (R1 of docs/ollie-request-handling-plan.md, Oct 19 2026).
 *
 * Every model call in the backend names the KIND of work it does (`Task`), never a model. This table
 * says which model and how much thinking each kind gets, and what it escalates to when its own check
 * fails. Before this, each area picked its own model (gpt-4.1 here, gpt-4o-mini there, its own OpenAI
 * client and retry habits) — Ollie worked as several products. Ruling (Antonio, Oct 19 2026): one shared
 * infrastructure; gpt-4 models are being retired; GPT-6 Luna first, GPT-6.1 Sol only where Luna falls
 * short. "Falls short" is decided by the caller's own check (`accept` on a JSON call), the same way for
 * everyone, and every escalation is logged so we can see where Luna needs help.
 *
 * Overrides, one per task (Railway or .env): LLM_<TASK>=model[:effort]  ·  LLM_<TASK>_ESCALATE=model[:effort] | off
 *   · LLM_<TASK>_TIER=fast | default   e.g. LLM_DESIGN=gpt-6.1-sol:medium, LLM_SAFETY_ESCALATE=off.
 *
 * Tier: OpenAI's "fast" service tier (formerly Priority) — up to 2.5× faster and steadier latency at 2× the
 * token price. For work where one slow call holds up a whole result (a scanned report's strips).
 */

export type Effort = "none" | "low" | "medium" | "high";

export type Task =
  /** Ollie's own turn: reads the conversation, picks tools, writes the reply. */
  | "converse"
  /** Ollie's turn while a check-in interview runs (a clinical history: needs more thought). */
  | "checkin"
  /** The output safety classifier and its rewrite. Moved only when its own tests match (ruling Oct 19). */
  | "safety"
  /** Folding old turns into the thread summary. */
  | "summarize"
  /** Short labelling: which complaint, which slot value. */
  | "classify"
  /** Copying structured facts out of text the person or a document gave (meals, workouts, lab rows, plan forms). */
  | "extract"
  /** The same from an image or a scanned page. */
  | "extract_vision"
  /** An independent read-back of an extraction (it can only flag, never overwrite). */
  | "verify"
  /** Designing one thing: a session, a meal, a recipe, a meal plan, a grocery list. */
  | "design"
  /** Laying out several things that depend on each other (a training week). */
  | "plan"
  /** Checking a result against what was asked. */
  | "review";

export type Tier = "default" | "fast" | "flex";
export type Route = { model: string; effort: Effort; escalate: { model: string; effort: Effort } | null; tier: Tier };

const LUNA = "gpt-6-luna";
const SOL = "gpt-6.1-sol";
const toSol = { model: SOL, effort: "medium" as Effort };

/**
 * Starting points. Luna with no thinking is the closest to gpt-4.1's behaviour (OpenAI's own
 * migration advice, quoted by Antonio Oct 19); work that needs judgement gets low or medium.
 * Each line is changed only with its area's tests (plan § Testing cost).
 */
// Interactive work runs on the FAST tier (his OK, Oct 19 2026): on the standard tier single Luna calls
// sometimes took 1–2 minutes (a meal analysis timed out and the card lost its one-tap log). Luna fast is
// $0.20 / $1.00 per M — still ~10× cheaper than gpt-4.1. Background runs (proactive) use standard: nobody waits.
const DEFAULTS: Record<Task, Omit<Route, "tier"> & { tier?: Tier }> = {
  converse: { model: LUNA, effort: "none", escalate: null, tier: "fast" },
  checkin: { model: LUNA, effort: "medium", escalate: null, tier: "fast" },
  // Moved alone, Oct 19 2026, after its own test matched case for case (13/13, same as gpt-4.1-mini).
  safety: { model: LUNA, effort: "none", escalate: null, tier: "fast" },
  summarize: { model: LUNA, effort: "none", escalate: null },
  classify: { model: LUNA, effort: "none", escalate: null, tier: "fast" },
  extract: { model: LUNA, effort: "none", escalate: toSol, tier: "fast" },
  // Images need a little thinking (effort none misread 11 values on a scanned report) and the fast tier
  // (standard tier: single calls of 1–2 minutes stalled whole uploads). Oct 19 2026, scripts/eval-labs.ts.
  extract_vision: { model: LUNA, effort: "low", escalate: toSol, tier: "fast" },
  // The independent read-back is a DIFFERENT model on purpose: Sol caught Luna's ALT 9→99 misread
  // ("99 belongs to EGFR, not ALT") that a same-model check would share. 226/241 = gpt-4.1's score.
  verify: { model: SOL, effort: "low", escalate: null, tier: "fast" },
  design: { model: LUNA, effort: "none", escalate: toSol, tier: "fast" },
  plan: { model: LUNA, effort: "low", escalate: toSol, tier: "fast" },
  review: { model: LUNA, effort: "low", escalate: null, tier: "fast" },
};

/** Variables that predate the policy, still honoured so nothing set on a machine silently stops working. */
const LEGACY_ENV: Partial<Record<Task, string[]>> = {
  converse: ["AGENT_MODEL"],
  checkin: ["AGENT_CHECKIN_MODEL"],
  summarize: ["AGENT_FAST_MODEL"],
};

const EFFORTS: Effort[] = ["none", "low", "medium", "high"];
/** Models that accept no "none" effort. */
const NO_NONE = /-(sol|astra)\b/i;

const parse = (raw: string | undefined, fallbackEffort: Effort): { model: string; effort: Effort } | null => {
  if (!raw?.trim()) return null;
  const [model, effort] = raw.trim().split(":");
  return { model, effort: EFFORTS.includes(effort as Effort) ? (effort as Effort) : fallbackEffort };
};

export const route = (task: Task, env: Record<string, string | undefined> = process.env): Route => {
  const base = DEFAULTS[task];
  const key = `LLM_${task.toUpperCase()}`;
  const legacy = (LEGACY_ENV[task] ?? []).map((k) => env[k]).find((v) => v?.trim());
  const legacyEffort = task === "checkin" ? env.AGENT_CHECKIN_EFFORT : undefined;
  let chosen = parse(env[key], base.effort) ?? (legacy ? { model: legacy.trim(), effort: (EFFORTS.includes(legacyEffort as Effort) ? legacyEffort : base.effort) as Effort } : null) ?? base;
  const esc = env[`${key}_ESCALATE`];
  let escalate = esc?.trim() === "off" ? null : parse(esc, "medium") ?? base.escalate;
  if (escalate && NO_NONE.test(escalate.model) && escalate.effort === "none") escalate = { ...escalate, effort: "low" };
  // Sol and Astra refuse effort "none" (400, Oct 19 2026): never send it to them.
  if (NO_NONE.test(chosen.model) && chosen.effort === "none") chosen = { ...chosen, effort: "low" };
  // LLM_TIER sets every task at once (tests run on "flex": half price, slower, fine when nobody waits).
  const tierEnv = (env[`${key}_TIER`] ?? env.LLM_TIER)?.trim();
  const tier: Tier = tierEnv === "fast" || tierEnv === "default" || tierEnv === "flex" ? tierEnv : base.tier ?? "default";
  return { model: chosen.model, effort: chosen.effort, escalate: escalate && escalate.model !== chosen.model ? escalate : null, tier };
};

/** The whole table as it resolves now — printed at boot so the deployed choice is visible in the logs. */
export const policyTable = (env: Record<string, string | undefined> = process.env) =>
  (Object.keys(DEFAULTS) as Task[]).map((t) => {
    const r = route(t, env);
    return `${t}=${r.model}:${r.effort}${r.tier !== "default" ? `(${r.tier})` : ""}${r.escalate ? `→${r.escalate.model}:${r.escalate.effort}` : ""}`;
  });
