import { ReasoningEffort } from "./mealAnalysis.types";

/**
 * Request parameters for the Responses-API callers (meals, labs, insurance). WHICH model and effort is
 * not decided here: callers take both from agent/llm/policy.ts by task (R1, Oct 19 2026).
 */
const DEFAULT_REASONING_EFFORT: ReasoningEffort = "none";

/** o-series and gpt-5 / gpt-6… models reject `temperature`; they take `reasoning.effort` instead. */
export function isReasoningModel(model: string): boolean {
  return /^(o\d|gpt-([5-9]|\d{2}))/i.test(model) && !/chat/i.test(model);
}

/** gpt-5.x point releases and gpt-6+ accept "none"/"low"/…; older gpt-5 and o-series accept "minimal"/"low"/… */
export function normalizeEffort(model: string, effort: ReasoningEffort): string {
  const pointRelease = /^gpt-(5\.\d|[6-9]|\d{2})/i.test(model);
  if (effort === "minimal" && pointRelease) return "none";
  if (effort === "none" && !pointRelease) return "minimal";
  return effort;
}

export function modelRequestParams(
  model: string,
  effort: ReasoningEffort = DEFAULT_REASONING_EFFORT
): Record<string, unknown> {
  return isReasoningModel(model)
    ? { reasoning: { effort: normalizeEffort(model, effort) } }
    : { temperature: 0 };
}
