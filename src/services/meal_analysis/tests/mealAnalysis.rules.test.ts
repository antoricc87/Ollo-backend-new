import {
  composeIngredient,
  dedupeIngredients,
  detectConditions,
  glycemicLoad,
  normalizeIngredient,
  servingsFor,
  warningsFor,
} from "../mealAnalysis.rules";
import { Ingredient } from "../mealAnalysis.schema";
import { formatQuantity, isModelUnavailableError, isReasoningModel, modelRequestParams } from "../mealAnalysis.service";

const base = (over: Partial<Ingredient> = {}): Ingredient => ({
  name: "Test food",
  searchTerm: "test food",
  brand: null,
  quantity: 1,
  unit: "cup",
  grams: 100,
  gramsLow: 80,
  gramsHigh: 120,
  portionSource: "user",
  portionAssumption: null,
  confidence: 0.9,
  foodGroup: "other",
  isProcessedFood: false,
  glycemicIndex: 0,
  vegetableServings: 0,
  fruitServings: 0,
  calories: 100,
  nutrients: {
    carbohydrates: 0,
    proteins: 0,
    fats: 0,
    saturatedFats: 0,
    fiber: 0,
    sodium: 0,
    naturalSugar: 0,
    addedSugar: 0,
    calcium: 0,
    magnesium: 0,
    iron: 0,
    potassium: 0,
    omega_3: 0,
    cholesterol: 0,
    zinc: 0,
    vitaminD: 0,
    vitaminB12: 0,
    vitaminC: 0,
    vitaminE: 0,
  },
  ...over,
});

describe("detectConditions", () => {
  it("maps free-text condition names to flags", () => {
    const f = detectConditions(["Type 2 Diabetes Mellitus", "Essential hypertension"]);
    expect(f.diabetes).toBe(true);
    expect(f.hypertension).toBe(true);
    expect(f.kidney).toBe(false);
  });
  it("is all-false for no conditions", () => {
    expect(Object.values(detectConditions([])).every((v) => v === false)).toBe(true);
  });
});

describe("warningsFor", () => {
  it("emits a diabetes warning for high sugar", () => {
    const w = warningsFor(
      base({ nutrients: { ...base().nutrients, naturalSugar: 10, addedSugar: 10 } }),
      detectConditions(["diabetes"])
    );
    expect(w).toHaveLength(1);
    expect(w[0].condition).toBe("Diabetes");
    expect(w[0].severity).toBe(4);
  });
  it("falls back to general warnings when no condition matches", () => {
    const w = warningsFor(base({ nutrients: { ...base().nutrients, sodium: 900 } }));
    expect(w).toHaveLength(1);
    expect(w[0].condition).toBeNull();
  });
  it("does not add a general warning when a condition-specific one fired", () => {
    const w = warningsFor(
      base({ nutrients: { ...base().nutrients, sodium: 900 } }),
      detectConditions(["hypertension"])
    );
    expect(w).toHaveLength(1);
    expect(w[0].condition).toBe("Hypertension");
  });
  it("is silent for a plain food", () => {
    expect(warningsFor(base())).toHaveLength(0);
  });
});

describe("servingsFor", () => {
  it("derives vegetable servings from grams", () => {
    expect(servingsFor(base({ foodGroup: "vegetable", grams: 160 }))).toEqual({
      vegetableServings: 2,
      fruitServings: 0,
    });
  });
  it("derives fruit servings from grams", () => {
    expect(servingsFor(base({ foodGroup: "fruit", grams: 150 })).fruitServings).toBe(1);
  });
  it("keeps the model value for mixed dishes", () => {
    expect(servingsFor(base({ foodGroup: "mixed_dish", vegetableServings: 1.5 })).vegetableServings).toBe(1.5);
  });
});

describe("glycemicLoad", () => {
  it("sums GI x carbs / 100", () => {
    const gl = glycemicLoad([
      base({ glycemicIndex: 70, nutrients: { ...base().nutrients, carbohydrates: 30 } }),
      base({ glycemicIndex: 50, nutrients: { ...base().nutrients, carbohydrates: 20 } }),
    ]);
    expect(gl).toBe(31);
  });
});

describe("normalizeIngredient", () => {
  it("clamps ranges, confidence and negative nutrients", () => {
    const n = normalizeIngredient(
      base({ grams: 100, gramsLow: 150, gramsHigh: 50, confidence: 3, nutrients: { ...base().nutrients, sodium: -5 } })
    );
    expect(n.gramsLow).toBe(100);
    expect(n.gramsHigh).toBe(100);
    expect(n.confidence).toBe(1);
    expect(n.nutrients.sodium).toBe(0);
  });
  it("keeps portionAssumption even for user-stated counts (unit size is still estimated)", () => {
    expect(normalizeIngredient(base({ portionAssumption: "x" })).portionAssumption).toBe("x");
  });
});

describe("composeIngredient", () => {
  it("relabels standard_serving as personalized_default when a profile exists", () => {
    const c = composeIngredient(base({ portionSource: "standard_serving" }), detectConditions([]), true);
    expect(c.portionSource).toBe("personalized_default");
    const d = composeIngredient(base({ portionSource: "standard_serving" }), detectConditions([]), false);
    expect(d.portionSource).toBe("standard_serving");
  });
  it("attaches warnings and servings", () => {
    const c = composeIngredient(base({ foodGroup: "fruit", grams: 300 }), detectConditions([]));
    expect(c.fruitServings).toBe(2);
    expect(c.warnings).toEqual([]);
  });
});

describe("formatQuantity", () => {
  it("formats the legacy quantity string", () => {
    expect(formatQuantity(150, "g")).toBe("150 g");
    expect(formatQuantity(1, "whole")).toBe("1 whole");
    expect(formatQuantity(2, "slice")).toBe("2 slices");
    expect(formatQuantity(0.5, "cup")).toBe("0.5 cup");
  });
});

describe("model params", () => {
  it("uses temperature for non-reasoning models and effort for reasoning models", () => {
    expect(isReasoningModel("gpt-4o-mini")).toBe(false);
    expect(isReasoningModel("gpt-4.1-mini")).toBe(false);
    expect(isReasoningModel("gpt-5-mini")).toBe(true);
    expect(isReasoningModel("o4-mini")).toBe(true);
    expect(modelRequestParams("gpt-4o-mini")).toEqual({ temperature: 0 });
    expect(modelRequestParams("gpt-5-mini", "minimal")).toEqual({ reasoning: { effort: "minimal" } });
    expect(modelRequestParams("gpt-5.6-luna", "minimal")).toEqual({ reasoning: { effort: "none" } });
    expect(modelRequestParams("gpt-5.6-luna", "none")).toEqual({ reasoning: { effort: "none" } });
    expect(modelRequestParams("o4-mini", "none")).toEqual({ reasoning: { effort: "minimal" } });
    expect(modelRequestParams("gpt-5.6-terra", "low")).toEqual({ reasoning: { effort: "low" } });
  });
});

describe("dedupeIngredients", () => {
  it("drops exact duplicates but keeps different portions of the same food", () => {
    const a = base({ name: "Black coffee", quantity: 1, unit: "cup", grams: 240 });
    const b = base({ name: "black coffee ", quantity: 1, unit: "cup", grams: 240 });
    const c = base({ name: "Black coffee", quantity: 2, unit: "cup", grams: 480 });
    expect(dedupeIngredients([a, b, c])).toHaveLength(2);
  });
});

describe("isModelUnavailableError", () => {
  it("recognises model-access failures but not other errors", () => {
    expect(isModelUnavailableError({ status: 404, message: "The model `gpt-5.6-luna` does not exist" })).toBe(true);
    expect(isModelUnavailableError({ status: 403, message: "Project does not have access to model gpt-5.6-luna" })).toBe(true);
    expect(isModelUnavailableError({ status: 429, message: "Rate limit" })).toBe(false);
    expect(isModelUnavailableError({ status: 400, message: "Unsupported parameter: temperature" })).toBe(false);
  });
});
