import { ReasoningEffort } from "./mealAnalysis.types";

const DEFAULT_REASONING_EFFORT = (process.env.NUTRITION_REASONING_EFFORT || "none") as ReasoningEffort;

/** o-series and gpt-5* models reject `temperature`; they take `reasoning.effort` instead. */
export function isReasoningModel(model: string): boolean {
  return /^(o\d|gpt-5)/i.test(model) && !/chat/i.test(model);
}

/** gpt-5.x point releases accept "none"/"low"/…; older gpt-5 and o-series accept "minimal"/"low"/… */
export function normalizeEffort(model: string, effort: ReasoningEffort): string {
  const pointRelease = /^gpt-5\.\d/i.test(model);
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
