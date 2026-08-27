import { z, ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { ToolSpec } from "../llm/types";
import type { ClientContext } from "../context/snapshot";

/**
 * Typed tool registry. A tool is a zod-validated function over the existing
 * service layer. Tools never contain an LLM (analyzeMeal is the one service
 * that does, and it is called as a service). `risk` decides how the loop
 * treats the call:
 *   read     — runs immediately
 *   memory   — runs immediately, audited as a memory write
 *   write    — returns a proposal card; committed only after the user confirms
 *              (write tools land in slice 3)
 */

export type Card = { type: string; title?: string; data: unknown };

export type ToolContext = {
  patientId: string; // the authenticated patient — never from the model
  threadId: string | null;
  timeZone: string;
  today: string; // local YYYY-MM-DD
  /** Resolve a model-supplied subjectId (self or one of the patient's sub-accounts). */
  resolveSubject: (subjectId?: string | null) => Promise<{ id: string; name: string; isSelf: boolean }>;
  /** Phone-side data sent with this turn (HealthKit); null when not a user turn. */
  client?: ClientContext | null;
};

export type ToolOutcome = {
  /** What the model sees. Keep it compact and factual. */
  result: unknown;
  /** Typed UI cards to render alongside the answer. */
  cards?: Card[];
};

/** What a write tool prepares for the user to confirm. */
export type Proposal = {
  title: string; // "Log dinner"
  summary: string; // one line, shown to the model and the user
  preview: unknown; // tool-specific payload the card renders (and may edit)
};

export type ToolDef<S extends ZodTypeAny = ZodTypeAny> = {
  name: string;
  description: string;
  schema: S;
  /**
   * read      runs immediately
   * memory    runs immediately, audited as a memory write
   * generate  runs immediately; produces content (may call the LLM as a service)
   * write     `run` only PREPARES a proposal; `commit` performs it after the
   *           user confirms in the app (proposals.store.ts)
   */
  risk: "read" | "memory" | "generate" | "write";
  run: (ctx: ToolContext, input: z.infer<S>) => Promise<ToolOutcome & { proposal?: Proposal }>;
  commit?: (ctx: ToolContext, input: z.infer<S>, preview: unknown) => Promise<ToolOutcome>;
  /** Apply user edits to a stored preview before commit (e.g. portion sizes). Must validate. */
  applyPreviewEdits?: (preview: unknown, edits: unknown) => unknown;
};

export const defineTool = <S extends ZodTypeAny>(def: ToolDef<S>): ToolDef<S> => {
  if (def.risk === "write" && !def.commit) throw new Error(`write tool ${def.name} needs commit()`);
  return def;
};

export class ToolRegistry {
  private tools = new Map<string, ToolDef>();

  register(...defs: ToolDef[]) {
    for (const d of defs) {
      if (this.tools.has(d.name)) throw new Error(`duplicate tool ${d.name}`);
      this.tools.set(d.name, d);
    }
    return this;
  }

  get(name: string) {
    return this.tools.get(name) ?? null;
  }

  names() {
    return Array.from(this.tools.keys());
  }

  specs(): ToolSpec[] {
    return Array.from(this.tools.values()).map((t) => ({
      name: t.name,
      description: t.description,
      parameters: jsonSchemaFor(t.schema),
    }));
  }

  /** Validate + run. Errors are returned as data so the model can recover. */
  async execute(name: string, rawInput: unknown, ctx: ToolContext): Promise<ToolOutcome & { ok: boolean; error?: string; proposal?: Proposal; input?: unknown }> {
    const tool = this.get(name);
    if (!tool) return { ok: false, error: `unknown tool ${name}`, result: { error: `unknown tool ${name}` } };
    const parsed = tool.schema.safeParse(rawInput ?? {});
    if (!parsed.success) {
      const error = parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
      return { ok: false, error, result: { error: `invalid input — ${error}` } };
    }
    try {
      const out = await tool.run(ctx, parsed.data);
      return { ok: true, input: parsed.data, ...out };
    } catch (e: any) {
      const error = e?.message ?? String(e);
      console.error(`agent tool ${name} failed`, e);
      return { ok: false, error, result: { error: `tool failed — ${error}` } };
    }
  }
}

const jsonSchemaFor = (schema: ZodTypeAny) => {
  // `as any`: zod-to-json-schema 3.25's generic recursion trips TS2589 on our nested schemas.
  const js = zodToJsonSchema(schema as any, { $refStrategy: "none", target: "openApi3" }) as Record<string, unknown>;
  delete js.$schema;
  return js;
};

/* ----------------------------- shared schemas ---------------------------- */

export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export const dayString = z
  .string()
  .regex(DAY_RE, "use YYYY-MM-DD")
  .describe("Local calendar day, YYYY-MM-DD");

export const dateRange = z.object({
  from: dayString.optional().describe("Start day (inclusive). Defaults to `to`."),
  to: dayString.optional().describe("End day (inclusive). Defaults to today."),
});

export const subjectField = z
  .string()
  .optional()
  .describe("Sub-account id to act for someone else in the family. Omit for the user themself.");

/** Clamp a requested range to at most `maxDays`, ending today by default. */
export const clampRange = (r: { from?: string; to?: string }, today: string, maxDays = 31) => {
  const to = r.to && r.to <= today ? r.to : today;
  const minFrom = shiftDay(to, -(maxDays - 1));
  const from = r.from ? (r.from < minFrom ? minFrom : r.from > to ? to : r.from) : to;
  return { from, to, next: shiftDay(to, 1), clamped: !!r.from && r.from < minFrom };
};

/** Validate an (edited) input for a tool without running it. */
export const validateInput = (tool: ToolDef, rawInput: unknown) => tool.schema.safeParse(rawInput ?? {});

export const shiftDay = (day: string, delta: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
};
