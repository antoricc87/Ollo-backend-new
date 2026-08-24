import { FoodCandidate } from "../resolver/foodResolver.types";
import { isPlausible, rankCandidates, scoreCandidate, tokenize } from "../resolver/matchScoring";
import { gramsFromReference, matchPortion } from "../resolver/portionMatching";
import { convertUnit, mapFdcNutrients, scalePer100g } from "../resolver/usdaNutrients";

const cand = (description: string, dataType = "Survey (FNDDS)", calories = 100): FoodCandidate => ({
  source: "usda",
  sourceId: description,
  dataType,
  description,
  brand: null,
  per100g: mapFdcNutrients([{ nutrientId: 1008, value: calories, unitName: "KCAL" }]),
  providerScore: null,
  servingGrams: null,
  householdServing: null,
});

describe("mapFdcNutrients", () => {
  it("maps search-result shape with unit conversion", () => {
    const p = mapFdcNutrients([
      { nutrientId: 1008, value: 96, unitName: "KCAL" },
      { nutrientId: 1003, value: 2.01, unitName: "G" },
      { nutrientId: 1005, value: 20.97, unitName: "G" },
      { nutrientId: 1093, value: 227, unitName: "MG" },
      { nutrientId: 1114, value: 1.5, unitName: "UG" },
      { nutrientId: 1178, value: 0.002, unitName: "MG" }, // mg → µg
      { nutrientId: 2000, value: 10, unitName: "G" },
      { nutrientId: 1235, value: 4, unitName: "G" },
      { nutrientId: 1404, value: 0.1, unitName: "G" },
      { nutrientId: 1272, value: 0.2, unitName: "G" },
    ]);
    expect(p.calories).toBe(96);
    expect(p.proteins).toBe(2.01);
    expect(p.sodium).toBe(227);
    expect(p.vitaminD).toBe(1.5);
    expect(p.vitaminB12).toBe(2);
    expect(p.naturalSugar).toBe(6);
    expect(p.addedSugar).toBe(4);
    expect(p.omega_3).toBeCloseTo(0.3, 3);
  });
  it("maps detail shape and derives kcal when missing", () => {
    const p = mapFdcNutrients([
      { nutrient: { id: 1003, unitName: "g" }, amount: 10 },
      { nutrient: { id: 1005, unitName: "g" }, amount: 20 },
      { nutrient: { id: 1004, unitName: "g" }, amount: 5 },
      { nutrient: { id: 1110, unitName: "IU" }, amount: 40 },
    ]);
    expect(p.calories).toBe(165);
    expect(p.vitaminD).toBe(1);
  });
  it("converts units", () => {
    expect(convertUnit(1, "G", "mg")).toBe(1000);
    expect(convertUnit(500, "UG", "mg")).toBe(0.5);
    expect(convertUnit(418.4, "KJ", "kcal")).toBeCloseTo(100, 3);
  });
  it("scales per-100g to grams", () => {
    const p = mapFdcNutrients([{ nutrientId: 1008, value: 100, unitName: "KCAL" }, { nutrientId: 1003, value: 10, unitName: "G" }]);
    const s = scalePer100g(p, 250);
    expect(s.calories).toBe(250);
    expect(s.proteins).toBe(25);
  });
});

describe("match scoring", () => {
  it("tokenizes with synonyms and plural stripping", () => {
    expect(tokenize("Bananas, raw")).toEqual(["banana", "raw"]);
    expect(tokenize("scrambled eggs")).toEqual(["scramble", "egg"]);
  });
  it("prefers the generic cooked rice entry over narrow variants", () => {
    const ranked = rankCandidates("rice, white, cooked", [
      cand("Rice, white, cooked, glutinous"),
      cand("Rice, white, cooked, as ingredient"),
      cand("Rice, white, cooked, made with oil"),
      cand("Rice, white, cooked, no added fat"),
      cand("Rice, white, cooked, NS as to fat"),
    ]);
    expect(["Rice, white, cooked, no added fat", "Rice, white, cooked, NS as to fat"]).toContain(ranked[0].candidate.description);
    expect(ranked[ranked.length - 1].candidate.description).toMatch(/glutinous|as ingredient|made with oil/);
  });
  it("penalises baby food and gives foundation a small edge", () => {
    const a = scoreCandidate("banana, raw", cand("Bananas, raw", "Foundation"));
    const b = scoreCandidate("banana, raw", cand("Banana, raw", "Survey (FNDDS)"));
    const c = scoreCandidate("banana, raw", cand("Babyfood, fruit, bananas with tapioca, strained", "SR Legacy"));
    expect(a).toBeGreaterThan(c);
    expect(b).toBeGreaterThan(c);
    expect(a).toBeGreaterThanOrEqual(b);
  });
  it("plausibility bounds", () => {
    expect(isPlausible(100, 100)).toBe(true);
    expect(isPlausible(55, 100)).toBe(true);
    expect(isPlausible(45, 100)).toBe(false);
    expect(isPlausible(230, 100)).toBe(false);
    expect(isPlausible(2, 0)).toBe(true);
  });
});

describe("portion matching", () => {
  const portions = [
    { label: "1 cup, mashed", gramWeight: 225 },
    { label: "1 banana", gramWeight: 126 },
    { label: "1 cup", gramWeight: 150 },
    { label: "1 slice", gramWeight: 6 },
  ];
  it("matches whole items by food name", () => {
    expect(matchPortion("whole", "Banana", portions)?.gramWeight).toBe(126);
  });
  it("prefers the exact '1 cup' entry", () => {
    expect(matchPortion("cup", "Banana", portions)?.gramWeight).toBe(150);
  });
  it("uses fixed conversions for oz/lb", () => {
    expect(gramsFromReference(6, "oz", "steak", [])?.grams).toBeCloseTo(170.1, 1);
  });
  it("returns null when nothing fits", () => {
    expect(matchPortion("tbsp", "Banana", portions)).toBeNull();
  });
  it("does not use bare '1 medium' labels for unrelated foods", () => {
    expect(matchPortion("piece", "Potato chips", [{ label: "1 medium single serving bag", gramWeight: 57 }])).toBeNull();
    expect(matchPortion("whole", "Apple", [{ label: "1 medium apple", gramWeight: 182 }])?.gramWeight).toBe(182);
  });
  it("rejects a different product even with full token coverage", () => {
    // Full token coverage but a different product: must fall below the heuristic-accept bar (0.95) so the reranker decides.
    const ranked = rankCandidates("milk, whole, fluid", [cand("Milk, buttermilk, fluid, whole", "SR Legacy")]);
    expect(ranked[0].score).toBeLessThan(0.95);
    expect(ranked[0].extra).toContain("buttermilk");
    expect(rankCandidates("milk, semi-skimmed", [cand("Chocolate milk, reduced sugar, fat free (skim)")])[0].score).toBeLessThan(0.95);
  });
});
