jest.mock("../resolver/nutrientResolution", () => ({
  resolveIngredients: jest.fn(async (ings: any[]) =>
    ings.map((i) => ({
      ingredient: { ...i, calories: (i.grams * 2) | 0, nutrients: { ...i.nutrients, proteins: 10 } },
      resolution: { nutrientSource: i.searchTerm.includes("unknown") ? "llm" : "usda", method: "heuristic", reason: null, matchScore: 0.9, reference: null, per100g: null, portionNote: null },
    }))
  ),
}));
jest.mock("../timing", () => ({ timed: (_k: string, fn: any) => fn(), withMealTiming: (_l: string, fn: any) => fn() }));

import * as svc from "../mealAnalysis.service";

const item = (searchTerm: string) => ({ item: searchTerm, grams: 100, searchTerm, kcal: 150, foodGroup: "protein" as const, glycemicIndex: 0, isProcessedFood: false });

describe("analyzeDesignedMeal — a designed meal straight to USDA", () => {
  // model "usda-direct" = the full analysis (a model call) did not run.
  it("uses the USDA values directly when every item matches (no second analysis)", async () => {
    const r = await svc.analyzeDesignedMeal({ name: "Chicken and quinoa", mealType: "DINNER", items: [item("chicken breast, cooked"), item("quinoa, cooked")] });
    expect(r.model).toBe("usda-direct");
    expect(r.meals[0].ingredients).toHaveLength(2);
    expect(r.meals[0].ingredients.every((i: any) => i.calories === 200)).toBe(true);
  });
});
