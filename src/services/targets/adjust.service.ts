import { getLLM } from "../agent/llm/openai.client";
import { ADJUST_SCHEMA, adjustPrompt, bmiOf, checkAdjusted, flagsFrom, prepareBase, type Checked, type Proposed } from "./domain/adjust";
import { TARGET_KEYS, type TargetKey, type Targets } from "./domain/targets";

/**
 * Ollie's adjustment of the starting targets (the hybrid, Nov 22 2026): one
 * model call, then the code checks (domain/adjust.ts). Any failure → the
 * starting numbers stand. Used at the end of onboarding, when the person asks
 * Ollie to redo them, and by the persona eval (scripts/targets-eval.ts).
 */
export type AdjustInput = { base: Targets; baseWhy: Record<TargetKey, string>; facts: string; healthId: string | null; weightKg: number | null; heightCm: number | null };

export async function adjustTargets(input: AdjustInput, opts: { model?: string } = {}): Promise<Checked & { base: Targets; proposed: Partial<Proposed> | null; error?: string }> {
  const flags = flagsFrom(`${input.facts}\n${input.healthId ?? ""}`);
  const body = { weightKg: input.weightKg, heightCm: input.heightCm };
  // Code's own changes first (pregnancy energy); Ollie starts from those.
  const { base, baseWhy } = prepareBase(input.base, input.baseWhy, flags);
  let proposed: Partial<Proposed> | null = null;
  try {
    const { system, user } = adjustPrompt({ ...input, base, baseWhy, bmi: bmiOf(body) });
    proposed = await getLLM().json<Proposed>({
      system,
      user,
      schema: ADJUST_SCHEMA as unknown as Record<string, unknown>,
      schemaName: "profile_targets",
      task: "plan",
      ...(opts.model ? { model: opts.model } : {}),
      accept: (v) => (TARGET_KEYS.every((k) => v && typeof (v as any)[k]?.value === "number") ? true : "every target needs a number"),
    });
  } catch (e) {
    return { ...checkAdjusted(base, {}, baseWhy, body, flags), base, proposed: null, error: (e as Error).message };
  }
  return { ...checkAdjusted(base, proposed ?? {}, baseWhy, body, flags), base, proposed };
}
