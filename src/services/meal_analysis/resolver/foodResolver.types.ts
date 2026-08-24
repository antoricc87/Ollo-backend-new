import { Nutrients } from "../mealAnalysis.schema";

/** Nutrients per 100 g in Ollo field names/units, plus energy. */
export type Per100g = Nutrients & { calories: number };

export interface ReferencePortion {
  label: string; // "1 cup", "1 banana", "1 slice"
  gramWeight: number;
}

export interface FoodCandidate {
  source: "usda";
  sourceId: string;
  dataType: string;
  description: string;
  brand: string | null;
  per100g: Per100g;
  /** Provider's own relevance score (not comparable across providers). */
  providerScore: number | null;
  /** Branded foods: label serving size in grams, if known. */
  servingGrams: number | null;
  householdServing: string | null;
}

export interface ResolvedReference {
  source: "usda";
  sourceId: string;
  dataType: string | null;
  description: string;
  brand: string | null;
  per100g: Per100g;
  portions: ReferencePortion[];
}

export interface SearchOptions {
  /** Restrict to these provider data types. */
  dataTypes?: string[];
  brand?: string | null;
  pageSize?: number;
}

/** Adapter interface — implement for another provider (e.g. Open Food Facts). */
export interface FoodResolver {
  readonly source: "usda";
  search(term: string, opts?: SearchOptions): Promise<FoodCandidate[]>;
  /** Household portions for a food (may be empty). */
  portions(sourceId: string): Promise<ReferencePortion[]>;
  /** True when the provider is temporarily unavailable (rate-limited, down). */
  isCoolingDown(): boolean;
}

export type NutrientSource = "usda" | "llm";
export type ResolutionMethod = "cache" | "heuristic" | "rerank" | "fallback";

export interface IngredientResolution {
  nutrientSource: NutrientSource;
  method: ResolutionMethod;
  /** Why the LLM estimate was kept (only when nutrientSource = llm). */
  reason: string | null;
  matchScore: number | null;
  reference: {
    source: string;
    sourceId: string;
    dataType: string | null;
    description: string;
  } | null;
  per100g: Per100g | null;
  /** Set when a reference portion replaced the model's gram estimate. */
  portionNote: string | null;
}
