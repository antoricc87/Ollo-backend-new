import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { Ingredient } from "../mealAnalysis.schema";
import {
  FoodCandidate,
  FoodResolver,
  IngredientResolution,
  ResolvedReference,
} from "./foodResolver.types";
import {
  findAlias,
  normalizeTerm,
  saveMatch,
  saveNoMatch,
  savePortions,
} from "./foodReference.repository";
import { isPlausible, rankCandidates } from "./matchScoring";
import { gramsFromReference } from "./portionMatching";
import { UsdaFdcResolver, ResolverUnavailableError } from "./usdaFdc.resolver";
import { modelRequestParams } from "../modelParams";
import { ReasoningEffort } from "../mealAnalysis.types";
import { scalePer100g } from "./usdaNutrients";

/**
 * Stage B — replace the model's nutrient guess with reference data.
 *
 *   cache → provider search → deterministic ranking → (LLM rerank when ambiguous)
 *   → plausibility check against the model's own kcal → portion-weight correction
 *
 * Whatever fails leaves the model estimate in place, flagged nutrientSource = "llm".
 */

export interface ResolveOptions {
  resolver?: FoodResolver;
  rerankModel?: string;
  /** Skip household-portion lookups (saves one provider call per new food). */
  skipPortions?: boolean;
}

const RERANK_EFFORT = (process.env.NUTRITION_RERANK_EFFORT || "none") as ReasoningEffort;
const ACCEPT_SCORE = 0.95; // heuristic accept only for (near) exact coverage with no extra qualifiers
const CLEAR_MARGIN = 0.1;
const PORTION_TOLERANCE = 0.25;
/** A reference portion may only move the model's grams within this factor; beyond it the label is suspect. */
const PORTION_MAX_FACTOR = 2;
const HOUSEHOLD_UNITS = new Set(["cup", "tbsp", "tsp", "slice", "whole", "piece", "serving", "oz", "fl_oz", "lb"]);

let defaultResolver: FoodResolver | null = null;
export function getDefaultResolver(): FoodResolver {
  if (!defaultResolver) defaultResolver = new UsdaFdcResolver();
  return defaultResolver;
}

let openaiClient: OpenAI | null = null;
const getOpenAI = () => {
  if (!openaiClient) openaiClient = new OpenAI({
      apiKey: process.env.REACT_APP_OPENAI_API_KEY || "",
      timeout: Number(process.env.NUTRITION_OPENAI_TIMEOUT_MS || 20_000), // typical call 3-6 s; hung requests seen at ~45 s
      maxRetries: 1,
    });
  return openaiClient;
};

const RerankSchema = z.object({
  bestIndex: z.number().describe("Index of the best candidate, or -1 if none is acceptable"),
  reason: z.string(),
});

async function rerank(ing: Ingredient, candidates: FoodCandidate[], model: string): Promise<number> {
  const list = candidates
    .map((c, i) => `${i}: ${c.description} [${c.dataType}${c.brand ? `, ${c.brand}` : ""}; ${Math.round(c.per100g.calories)} kcal/100 g]`)
    .join("\n");
  const prompt = `A user logged "${ing.name}" (search term: "${ing.searchTerm}"${ing.brand ? `, brand: ${ing.brand}` : ""}), about ${Math.round(ing.grams)} g, which the logging model estimated at ${Math.round(ing.calories)} kcal.
Pick the food-database entry that best represents this food AS EATEN (cooked/prepared form, same kind of product). Prefer generic entries over narrowly qualified ones unless the qualifier matches, and assume the standard preparation unless the user said otherwise (a caesar salad has dressing, chicken breast is skinless, a restaurant steak is lean and fat, a plain croissant is not chocolate-filled).
Reject (-1) when every candidate is a DIFFERENT product rather than a variant of the same one — e.g. "chocolate milk" for milk, "buttermilk" for whole milk, "stuffing" for bread, a yogurt drink for a coffee latte, a frozen bowl meal for a restaurant burger — or when the kcal per 100 g is far from what this food should have.

Candidates:
${list}`;
  const response = await getOpenAI().responses.parse({
    model,
    ...(modelRequestParams(model, RERANK_EFFORT) as any), // temperature 0, or reasoning.effort (NUTRITION_RERANK_EFFORT)
    input: [{ role: "user", content: prompt }],
    text: { format: zodTextFormat(RerankSchema, "rerank") },
  } as any);
  const parsed = response.output_parsed as z.infer<typeof RerankSchema> | null;
  const idx = parsed?.bestIndex ?? -1;
  return Number.isInteger(idx) && idx >= 0 && idx < candidates.length ? idx : -1;
}

function llmFallback(reason: string, method: IngredientResolution["method"] = "fallback"): IngredientResolution {
  return { nutrientSource: "llm", method, reason, matchScore: null, reference: null, per100g: null, portionNote: null };
}

/** Grams after an optional reference-portion correction (pure part of applyReference). */
function correctedGrams(ing: Ingredient, ref: ResolvedReference): { grams: number; hit: { grams: number; label: string } | null } {
  if (!(HOUSEHOLD_UNITS.has(ing.unit) && ing.quantity > 0 && ing.grams > 0)) return { grams: ing.grams, hit: null };
  const hit = gramsFromReference(ing.quantity, ing.unit, ing.name, ref.portions);
  if (!hit) return { grams: ing.grams, hit: null };
  const factor = hit.grams / ing.grams;
  const withinGuard = factor >= 1 / PORTION_MAX_FACTOR && factor <= PORTION_MAX_FACTOR;
  if (!withinGuard || Math.abs(hit.grams - ing.grams) / ing.grams <= PORTION_TOLERANCE) return { grams: ing.grams, hit: null };
  return { grams: Math.round(hit.grams), hit };
}

function applyReference(
  ing: Ingredient,
  ref: ResolvedReference,
  base: Omit<IngredientResolution, "nutrientSource" | "reference" | "per100g" | "portionNote">
): { ingredient: Ingredient; resolution: IngredientResolution } {
  let grams = ing.grams;
  let portionNote: string | null = null;
  let portionAssumption = ing.portionAssumption;

  {
    const c = correctedGrams(ing, ref);
    if (c.hit) {
      portionNote = `Reference portion ${c.hit.label}; adjusted ${Math.round(grams)} g → ${c.grams} g`;
      const k = c.grams / grams;
      grams = c.grams;
      ing = { ...ing, gramsLow: Math.round(ing.gramsLow * k), gramsHigh: Math.round(ing.gramsHigh * k) };
      portionAssumption = portionAssumption ? `${portionAssumption} (${c.hit.label})` : `Reference portion: ${c.hit.label}`;
    }
  }

  const scaled = scalePer100g(ref.per100g, grams);
  const { calories, ...nutrients } = scaled;
  return {
    ingredient: { ...ing, grams, calories, nutrients, portionAssumption },
    resolution: {
      ...base,
      nutrientSource: "usda",
      reference: { source: ref.source, sourceId: ref.sourceId, dataType: ref.dataType, description: ref.description },
      per100g: ref.per100g,
      portionNote,
    },
  };
}

export async function resolveIngredient(
  ing: Ingredient,
  opts: ResolveOptions = {}
): Promise<{ ingredient: Ingredient; resolution: IngredientResolution }> {
  const resolver = opts.resolver ?? getDefaultResolver();
  const rerankModel = opts.rerankModel || process.env.NUTRITION_RERANK_MODEL || "gpt-5.6-luna";
  const term = normalizeTerm(ing.searchTerm || ing.name);
  const brand = normalizeTerm(ing.brand || "");
  if (!term) return { ingredient: ing, resolution: llmFallback("empty_term") };

  // 1. cache (works even while the provider is cooling down)
  try {
    const cached = await findAlias(term, brand);
    if (cached.kind === "negative") return { ingredient: ing, resolution: llmFallback("no_match_cached") };
    if (cached.kind === "hit") {
      const ref = await ensurePortions(resolver, cached.reference, ing, opts);
      const exact = (cached.score ?? 0) >= ACCEPT_SCORE;
      const dbKcal = (ref.per100g.calories * correctedGrams(ing, ref).grams) / 100;
      if (!exact && !isPlausible(dbKcal, ing.calories)) {
        return { ingredient: ing, resolution: llmFallback(`implausible_match:${ref.description}`, "cache") };
      }
      return applyReference(ing, ref, {
        method: "cache",
        reason: exact && !isPlausible(dbKcal, ing.calories) ? "kcal_differs_from_model_estimate" : null,
        matchScore: cached.score,
      });
    }
  } catch (err: any) {
    console.warn("[resolver] cache lookup failed:", err?.message);
  }

  // 2. provider search
  if (resolver.isCoolingDown()) return { ingredient: ing, resolution: llmFallback("resolver_unavailable") };
  // Branded data covers packaged retail products only. Search it when the user named a brand;
  // restaurant/menu items without a brand keep the model's published-value estimate.
  const isBrand = !!brand;
  if (ing.portionSource === "brand" && !isBrand) {
    return { ingredient: ing, resolution: llmFallback("brand_item_no_reference") };
  }
  const dataTypes = isBrand
    ? ["Branded"]
    : ing.foodGroup === "mixed_dish"
    ? ["Survey (FNDDS)", "SR Legacy", "Foundation"]
    : ["Foundation", "SR Legacy", "Survey (FNDDS)"];
  const query = isBrand && brand ? `${brand} ${term}` : term;

  let candidates: FoodCandidate[];
  try {
    candidates = await resolver.search(query, { dataTypes, pageSize: 10 });
  } catch (err: any) {
    console.warn(`[resolver] search failed for "${query}":`, err?.message);
    return { ingredient: ing, resolution: llmFallback("resolver_unavailable") };
  }
  if (!candidates.length) {
    await saveNoMatch(term, brand, "heuristic").catch(() => {});
    return { ingredient: ing, resolution: llmFallback(isBrand ? "brand_not_in_db" : "no_match") };
  }

  // 3. rank; 4. rerank when ambiguous or implausible
  const ranked = rankCandidates(term, candidates);
  let pick: { candidate: FoodCandidate; score: number; extra: string[] } | null = null;
  let method: IngredientResolution["method"] = "heuristic";
  const top = ranked[0];
  const second = ranked[1];
  const clear =
    !isBrand &&
    top.score >= ACCEPT_SCORE &&
    top.extra.length === 0 &&
    (!second || top.score - second.score >= CLEAR_MARGIN);
  const plausibleTop = isPlausible((top.candidate.per100g.calories * ing.grams) / 100, ing.calories);
  if (clear && plausibleTop) {
    pick = top;
  } else {
    try {
      const idx = await rerank(ing, ranked.slice(0, 6).map((r) => r.candidate), rerankModel);
      method = "rerank";
      if (idx >= 0) pick = ranked.slice(0, 6)[idx];
    } catch (err: any) {
      console.warn("[resolver] rerank failed:", err?.message);
      if (plausibleTop && top.score >= ACCEPT_SCORE) pick = top;
    }
  }
  if (!pick) {
    await saveNoMatch(term, brand, method).catch(() => {});
    return { ingredient: ing, resolution: llmFallback(isBrand ? "brand_not_in_db" : "no_acceptable_candidate", method) };
  }
  let ref: ResolvedReference & { id?: string };
  try {
    ref = await saveMatch(term, brand, pick.candidate, pick.score, method);
  } catch (err: any) {
    console.warn("[resolver] cache save failed:", err?.message);
    ref = { ...pick.candidate, portions: [] };
  }
  ref = await ensurePortions(resolver, ref, ing, opts);

  // Plausibility is judged AFTER the reference-portion correction, so a wrong gram
  // estimate by the model does not get blamed on the database. Exact-name matches
  // (score ≥ ACCEPT_SCORE, no extra qualifiers) are trusted over the model's kcal.
  const exact = pick.score >= ACCEPT_SCORE && pick.extra.length === 0;
  const dbKcal = (ref.per100g.calories * correctedGrams(ing, ref).grams) / 100;
  const plausible = isPlausible(dbKcal, ing.calories);
  if (!exact && !plausible) {
    return { ingredient: ing, resolution: llmFallback(`implausible_match:${pick.candidate.description}`, method) };
  }
  return applyReference(ing, ref, {
    method,
    reason: exact && !plausible ? "kcal_differs_from_model_estimate" : null,
    matchScore: pick.score,
  });
}

async function ensurePortions<T extends ResolvedReference & { id?: string }>(
  resolver: FoodResolver,
  ref: T,
  ing: Ingredient,
  opts: ResolveOptions
): Promise<T> {
  if (opts.skipPortions || !HOUSEHOLD_UNITS.has(ing.unit) || ing.unit === "oz" || ing.unit === "fl_oz" || ing.unit === "lb") return ref;
  if (ref.portions && ref.portions.length) return ref;
  if (resolver.isCoolingDown()) return ref;
  try {
    const portions = await resolver.portions(ref.sourceId);
    if (ref.id) await savePortions(ref.id, portions).catch(() => {});
    return { ...ref, portions };
  } catch (err: any) {
    console.warn(`[resolver] portions lookup failed for ${ref.sourceId}:`, err?.message);
    return ref;
  }
}

/** Resolve many ingredients with bounded concurrency, preserving order. */
export async function resolveIngredients(
  ings: Ingredient[],
  opts: ResolveOptions = {},
  concurrency = 4
) {
  const out: { ingredient: Ingredient; resolution: IngredientResolution }[] = new Array(ings.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, ings.length) }, async () => {
      while (next < ings.length) {
        const i = next++;
        out[i] = await resolveIngredient(ings[i], opts);
      }
    })
  );
  return out;
}
