import dotenv from "dotenv";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { calculateAgeFromDob } from "../../utils/calculateAgefromDob";
import { getPatientById } from "../patient/model/patient.model";
import { buildSystemPrompt, buildUserMessage } from "./mealAnalysis.prompt";
import {
  composeIngredient,
  dedupeIngredients,
  detectConditions,
  glycemicLoad,
  normalizeIngredient,
} from "./mealAnalysis.rules";
import { IngredientResolution } from "./resolver/foodResolver.types";
import { resolveIngredients } from "./resolver/nutrientResolution";
import {
  AnalyzedIngredient,
  AnalyzedMeal,
  Ingredient,
  MealAnalysisOutput,
  MealAnalysisResult,
  MealAnalysisSchema,
  Unit,
} from "./mealAnalysis.schema";
import {
  AnalyzeOptions,
  EMPTY_PATIENT_CONTEXT,
  MealAnalysisInput,
  PatientContext,
} from "./mealAnalysis.types";
import { modelRequestParams } from "./modelParams";

dotenv.config();

// Phase 4 bake-off (2026-08-24): gpt-5.6-luna at effort "none" beat gpt-4o-mini on portion
// labelling (97 % vs 86 %), grounded share and within-tolerance at equal latency, ~1.7× cost.
export const DEFAULT_MEAL_MODEL = process.env.NUTRITION_MODEL || "gpt-5.6-luna";
export const FALLBACK_MEAL_MODEL = process.env.NUTRITION_FALLBACK_MODEL || "gpt-4o-mini";

/** 404 / "model not found" / "does not have access to model" style errors — not rate limits or bad requests. */
export function isModelUnavailableError(err: any): boolean {
  const status = err?.status ?? err?.response?.status;
  const msg = String(err?.message || "").toLowerCase();
  if (status === 404) return true;
  return (status === 400 || status === 403) && /model/.test(msg) && /(not found|does not exist|no access|not have access|unsupported model|invalid model|unknown model)/.test(msg);
}
export const DEFAULT_RESOLVER = (process.env.NUTRITION_RESOLVER || "usda") as "usda" | "llm";

let client: OpenAI | null = null;
const getClient = () => {
  if (!client) {
    client = new OpenAI({
      apiKey: process.env.REACT_APP_OPENAI_API_KEY || "",
      timeout: Number(process.env.NUTRITION_OPENAI_TIMEOUT_MS || 20_000), // typical call 3-6 s; hung requests seen at ~45 s
      maxRetries: 1,
    });
  }
  return client;
};

// ---------------------------------------------------------------------------
// Patient context
// ---------------------------------------------------------------------------

const toKg = (value: number | null | undefined, unit?: string | null) => {
  if (value == null || !isFinite(value) || value <= 0) return null;
  const u = (unit || "").toLowerCase();
  if (/lb/.test(u)) return value * 0.45359237;
  if (/kg/.test(u)) return value;
  return value > 150 ? value * 0.45359237 : value; // no unit stored: heuristic
};

const toCm = (value: number | null | undefined, unit?: string | null) => {
  if (value == null || !isFinite(value) || value <= 0) return null;
  const u = (unit || "").toLowerCase();
  if (/^in/.test(u)) return value * 2.54;
  if (/^ft/.test(u)) return value * 30.48;
  if (/^m$/.test(u)) return value * 100;
  if (/cm/.test(u)) return value;
  if (value <= 3) return value * 100; // metres
  if (value <= 100) return value * 2.54; // inches
  return value;
};

export async function loadPatientContext(
  patientId: string
): Promise<PatientContext> {
  const patient: any = await getPatientById(patientId);
  if (!patient) return EMPTY_PATIENT_CONTEXT;
  const summary = patient.patientSummary;
  const vitals = summary?.vitals;
  return {
    age: patient.dob ? calculateAgeFromDob(patient.dob) : null,
    gender: patient.gender || null,
    weightKg: toKg(vitals?.weight, vitals?.weight_unit),
    heightCm: toCm(vitals?.height, vitals?.height_unit),
    conditions:
      summary?.conditions
        ?.map((c: any) => c?.condition?.name)
        .filter(Boolean) ?? [],
  };
}

// ---------------------------------------------------------------------------
// Model request parameters
// ---------------------------------------------------------------------------

export { isReasoningModel, modelRequestParams } from "./modelParams";

// ---------------------------------------------------------------------------
// analyzeMeal
// ---------------------------------------------------------------------------

export async function analyzeMeal(
  input: MealAnalysisInput,
  opts: AnalyzeOptions = {}
): Promise<MealAnalysisResult> {
  if (!input.text?.trim() && !input.imageDataUrl) {
    throw new Error("analyzeMeal: provide `text` or `imageDataUrl`");
  }
  const ctx =
    opts.patientContext ??
    (opts.patientId
      ? await loadPatientContext(opts.patientId)
      : EMPTY_PATIENT_CONTEXT);
  const model = opts.model || DEFAULT_MEAL_MODEL;

  const content: any[] = [
    { type: "input_text", text: buildUserMessage(ctx, input) },
  ];
  if (input.imageDataUrl) {
    content.push({
      type: "input_image",
      image_url: input.imageDataUrl,
      detail: "high",
    });
  }

  const started = Date.now();
  const request = (m: string) =>
    getClient().responses.parse({
      model: m,
      ...(modelRequestParams(m, opts.reasoningEffort) as any),
      input: [
        { role: "system", content: buildSystemPrompt() },
        { role: "user", content },
      ],
      text: { format: zodTextFormat(MealAnalysisSchema, "meal_analysis") },
    });
  let response;
  let usedModel = model;
  try {
    response = await request(model);
  } catch (err: any) {
    // Safety net: if the configured model is not available to this API key
    // (e.g. a newer model on an older account), fall back rather than fail the log.
    if (!isModelUnavailableError(err) || model === FALLBACK_MEAL_MODEL) throw err;
    console.warn(`[meal-analysis] model "${model}" unavailable (${err?.status}); falling back to ${FALLBACK_MEAL_MODEL}`);
    usedModel = FALLBACK_MEAL_MODEL;
    response = await request(FALLBACK_MEAL_MODEL);
  }
  const parsed = response.output_parsed as MealAnalysisOutput | null;
  if (!parsed) throw new Error("analyzeMeal: no structured output returned");
  parsed.meals = (parsed.meals || []).map((m) => ({
    ...m,
    ingredients: dedupeIngredients(m.ingredients || []),
  }));

  const usage = response.usage
    ? {
        inputTokens: response.usage.input_tokens ?? 0,
        outputTokens: response.usage.output_tokens ?? 0,
      }
    : null;

  // Stage B — ground nutrients in reference data (USDA) where possible.
  const resolverMode = opts.resolver || DEFAULT_RESOLVER;
  const resolved = await resolveMeals(parsed, resolverMode);

  return compose(parsed, ctx, { model: usedModel, latencyMs: Date.now() - started, usage }, resolved);
}

export type ResolvedIngredient = { ingredient: Ingredient; resolution: IngredientResolution };

/** Resolve every ingredient of every meal; returns a per-meal array aligned with `parsed.meals`. */
export async function resolveMeals(
  parsed: MealAnalysisOutput,
  mode: "usda" | "llm"
): Promise<ResolvedIngredient[][] | null> {
  if (mode !== "usda") return null;
  const flat: { mealIdx: number; ingredient: Ingredient }[] = [];
  parsed.meals.forEach((m, mealIdx) =>
    (m.ingredients || []).forEach((i) => flat.push({ mealIdx, ingredient: normalizeIngredient(i) }))
  );
  const results = await resolveIngredients(flat.map((f) => f.ingredient));
  const perMeal: ResolvedIngredient[][] = parsed.meals.map(() => []);
  results.forEach((r, i) => perMeal[flat[i].mealIdx].push(r));
  return perMeal;
}

export function compose(
  parsed: MealAnalysisOutput,
  ctx: PatientContext,
  meta: Pick<MealAnalysisResult, "model" | "latencyMs" | "usage">,
  resolved: ResolvedIngredient[][] | null = null
): MealAnalysisResult {
  const flags = detectConditions(ctx.conditions || []);
  const hasProfile =
    ctx.age != null || ctx.weightKg != null || ctx.heightCm != null || !!ctx.gender;
  const meals: AnalyzedMeal[] = (parsed.meals || [])
    .map((m, mealIdx) => ({ m, mealIdx }))
    .filter(({ m }) => m && Array.isArray(m.ingredients) && m.ingredients.length)
    .map(({ m, mealIdx }) => {
      const ingredients = m.ingredients.map((i, ingIdx) => {
        const r = resolved?.[mealIdx]?.[ingIdx];
        return r
          ? composeIngredient(r.ingredient, flags, hasProfile, r.resolution)
          : composeIngredient(i, flags, hasProfile);
      });
      return {
        mealName: m.mealName || "Meal",
        mealType: m.mealType,
        mealDate: m.mealDate || "today",
        ingredients,
        glycemicLoad: glycemicLoad(ingredients),
      };
    });
  return {
    meals,
    dateReference: parsed.dateReference ?? null,
    dateConfidence: parsed.dateConfidence ?? 0,
    ...meta,
  };
}

// ---------------------------------------------------------------------------
// Legacy response adapters — keep the app and the agent working unchanged.
// ---------------------------------------------------------------------------

const UNIT_LABEL: Record<Unit, string> = {
  g: "g",
  ml: "ml",
  whole: "whole",
  piece: "pcs",
  slice: "slice",
  cup: "cup",
  tbsp: "tbsp",
  tsp: "tsp",
  oz: "oz",
  fl_oz: "fl oz",
  lb: "lb",
  serving: "serving",
};

const fmtNumber = (n: number) =>
  Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);

export function formatQuantity(quantity: number, unit: Unit): string {
  const label = UNIT_LABEL[unit] || unit;
  if (unit === "g" || unit === "ml") return `${fmtNumber(quantity)} ${label}`;
  if (quantity === 1 && (unit === "whole" || unit === "piece")) return "1 whole";
  if (quantity > 1 && (unit === "slice" || unit === "cup" || unit === "serving")) {
    return `${fmtNumber(quantity)} ${label}s`;
  }
  return `${fmtNumber(quantity)} ${label}`;
}

/** Ingredient in the shape the app / agent already consume, plus the new Phase-1 fields. */
export function toLegacyIngredient(ing: AnalyzedIngredient) {
  return {
    description: ing.name,
    calories: Math.round(ing.calories),
    quantity: formatQuantity(ing.quantity, ing.unit),
    measurementUnit: ing.unit,
    warnings: ing.warnings.map((w) => ({
      warning: w.warning,
      severity: w.severity,
      condition: w.condition,
    })),
    isProcessedFood: ing.isProcessedFood,
    glycemicIndex: ing.glycemicIndex,
    vegetableServings: ing.vegetableServings,
    fruitServings: ing.fruitServings,
    nutrients: ing.nutrients,
    // Phase 1 additions
    grams: ing.grams,
    gramsLow: ing.gramsLow,
    gramsHigh: ing.gramsHigh,
    portionSource: ing.portionSource,
    portionAssumption: ing.portionAssumption,
    confidence: ing.confidence,
    foodGroup: ing.foodGroup,
    searchTerm: ing.searchTerm,
    brand: ing.brand,
    // Phase 2 additions
    nutrientSource: ing.nutrientSource,
    reference: ing.reference,
    per100g: ing.per100g,
    resolution: ing.resolution,
  };
}

/** Shape of `calculateMultipleMealsCaloriesAndNutrients` (chat agent). */
export function toLegacyMultiMeal(result: MealAnalysisResult) {
  return {
    meals: result.meals.map((m) => ({
      mealName: m.mealName,
      mealType: m.mealType,
      mealDate: m.mealDate,
      glycemicLoad: m.glycemicLoad,
      ingredients: m.ingredients.map(toLegacyIngredient),
    })),
    dateReference: result.dateReference,
    dateConfidence: result.dateConfidence,
    analysis: { model: result.model, latencyMs: result.latencyMs },
  };
}

/**
 * Shape of the single-meal endpoints used by the app (text / photo / voice):
 * `{ meals: Ingredient[], mealName, mealType }` — here `meals` is the ingredient list.
 * Several meals in one description are merged, since that UI edits one meal at a time.
 */
export function toLegacySingleMeal(
  result: MealAnalysisResult,
  mealTypeHint?: string
) {
  const meals = result.meals;
  const ingredients = meals.flatMap((m) => m.ingredients.map(toLegacyIngredient));
  const mealName =
    meals.length === 1
      ? meals[0].mealName
      : meals.map((m) => m.mealName).join(" + ") || "Meal";
  const mealType =
    (mealTypeHint && mealTypeHint.toUpperCase()) ||
    meals[0]?.mealType ||
    "SNACK";
  return {
    meals: ingredients,
    mealName,
    mealType,
    glycemicLoad: glycemicLoad(meals.flatMap((m) => m.ingredients)),
    dateReference: result.dateReference,
    portionAssumptions: ingredients
      .filter((i) => i.portionAssumption)
      .map((i) => ({ item: i.description, assumption: i.portionAssumption })),
    analysis: { model: result.model, latencyMs: result.latencyMs },
  };
}
