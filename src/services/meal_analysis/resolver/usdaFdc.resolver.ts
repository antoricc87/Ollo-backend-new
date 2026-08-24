import axios, { AxiosInstance } from "axios";
import {
  FoodCandidate,
  FoodResolver,
  ReferencePortion,
  SearchOptions,
} from "./foodResolver.types";
import { mapFdcNutrients } from "./usdaNutrients";

/**
 * USDA FoodData Central adapter.
 * Docs: https://fdc.nal.usda.gov/api-guide/  (free key, 1 000 req/h; DEMO_KEY = 30/h)
 */
export class ResolverUnavailableError extends Error {}

export class UsdaFdcResolver implements FoodResolver {
  readonly source = "usda" as const;
  private cooldownUntil = 0;
  private readonly http: AxiosInstance;
  private readonly apiKey: string;

  constructor(apiKey?: string, http?: AxiosInstance) {
    this.apiKey = apiKey || process.env.USDA_FDC_API_KEY || "DEMO_KEY";
    if (this.apiKey === "DEMO_KEY") {
      console.warn(
        "[usda] USDA_FDC_API_KEY not set — using DEMO_KEY (30 requests/hour). Get a free key at https://fdc.nal.usda.gov/api-key-signup"
      );
    }
    this.http =
      http ||
      axios.create({
        baseURL: "https://api.nal.usda.gov/fdc/v1",
        timeout: 8000,
        headers: { "User-Agent": "ollo-backend/meal-analysis", Accept: "application/json" },
      });
  }

  isCoolingDown(): boolean {
    return Date.now() < this.cooldownUntil;
  }

  private handleError(err: any): never {
    const status = err?.response?.status;
    if (status === 429) {
      this.cooldownUntil = Date.now() + 60_000;
      throw new ResolverUnavailableError("USDA rate limit hit (429); cooling down 60 s");
    }
    if (!status || status >= 500) {
      this.cooldownUntil = Date.now() + 10_000;
      throw new ResolverUnavailableError(`USDA unavailable (${status ?? err?.code ?? "network"}); cooling down 10 s`);
    }
    throw new ResolverUnavailableError(`USDA request failed (${status}): ${err?.message}`);
  }

  /** One quick retry on transient failures (5xx, network) before giving up on the request. */
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 429 || (status && status < 500)) throw err;
      await new Promise((r) => setTimeout(r, 800));
      return fn();
    }
  }

  async search(term: string, opts: SearchOptions = {}): Promise<FoodCandidate[]> {
    if (this.isCoolingDown()) throw new ResolverUnavailableError("USDA resolver cooling down");
    try {
      const body: any = {
        query: term,
        pageSize: opts.pageSize ?? 10,
        dataType: opts.dataTypes ?? ["Foundation", "SR Legacy", "Survey (FNDDS)"],
      };
      const { data } = await this.withRetry(() => this.http.post(`/foods/search?api_key=${this.apiKey}`, body));
      return (data?.foods || []).map((f: any): FoodCandidate => ({
        source: "usda",
        sourceId: String(f.fdcId),
        dataType: f.dataType,
        description: f.description,
        brand: f.brandName || f.brandOwner || null,
        per100g: mapFdcNutrients(f.foodNutrients),
        providerScore: typeof f.score === "number" ? f.score : null,
        servingGrams:
          typeof f.servingSize === "number" && /^(g|grm|gram)/i.test(f.servingSizeUnit || "")
            ? f.servingSize
            : null,
        householdServing: f.householdServingFullText || null,
      }));
    } catch (err) {
      if (err instanceof ResolverUnavailableError) throw err;
      this.handleError(err);
    }
  }

  async portions(sourceId: string): Promise<ReferencePortion[]> {
    if (this.isCoolingDown()) throw new ResolverUnavailableError("USDA resolver cooling down");
    try {
      const { data } = await this.withRetry(() => this.http.get(`/food/${sourceId}?api_key=${this.apiKey}&format=full`));
      const out: ReferencePortion[] = [];
      for (const p of data?.foodPortions || []) {
        const gramWeight = Number(p.gramWeight);
        if (!gramWeight || gramWeight <= 0) continue;
        const unit = p.measureUnit?.name && p.measureUnit.name !== "undetermined" ? p.measureUnit.name : "";
        const label =
          p.portionDescription && p.portionDescription !== "Quantity not specified"
            ? p.portionDescription
            : [p.amount, unit, p.modifier].filter(Boolean).join(" ").trim();
        if (label) out.push({ label: String(label).toLowerCase(), gramWeight });
      }
      if (!out.length && typeof data?.servingSize === "number" && /^(g|grm|gram)/i.test(data?.servingSizeUnit || "")) {
        out.push({ label: (data.householdServingFullText || "1 serving").toLowerCase(), gramWeight: data.servingSize });
      }
      return out;
    } catch (err) {
      if (err instanceof ResolverUnavailableError) throw err;
      this.handleError(err);
    }
  }
}
