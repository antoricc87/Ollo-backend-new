export interface PatientContext {
  age: number | null;
  gender: string | null;
  weightKg: number | null;
  heightCm: number | null;
  conditions: string[];
}

export const EMPTY_PATIENT_CONTEXT: PatientContext = {
  age: null,
  gender: null,
  weightKg: null,
  heightCm: null,
  conditions: [],
};

export interface MealAnalysisInput {
  /** Typed description or voice transcript. */
  text?: string;
  /** data:image/...;base64,... URL of a meal photo. */
  imageDataUrl?: string;
  /** Optional user caption accompanying the photo. */
  caption?: string;
  /** BREAKFAST | LUNCH | DINNER | SNACK when the UI already knows it. */
  mealTypeHint?: string;
}

export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high";

export interface AnalyzeOptions {
  patientId?: string;
  /** Skip the DB lookup and use this profile (eval harness, tests). */
  patientContext?: PatientContext;
  /** Override NUTRITION_MODEL. */
  model?: string;
  /** Only used for reasoning models (o-series, gpt-5*). */
  reasoningEffort?: ReasoningEffort;
  /** "usda" (default, env NUTRITION_RESOLVER) grounds nutrients in reference data; "llm" keeps the model estimate. */
  resolver?: "usda" | "llm";
}
