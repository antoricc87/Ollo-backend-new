import {
  normalizeIngredientInput,
  parseQuantityString,
  rescaleIngredient,
  totalsFromIngredients,
} from "../model/mealIngredients";

const analysisItem = {
  description: "Scrambled eggs",
  calories: 182,
  quantity: "2 whole",
  measurementUnit: "whole",
  grams: 136,
  portionSource: "user",
  glycemicIndex: 0,
  isProcessedFood: false,
  vegetableServings: 0,
  fruitServings: 0,
  nutrients: { carbohydrates: 2, proteins: 12, fats: 14, sodium: 300 },
  nutrientSource: "usda",
  reference: { source: "usda", sourceId: "172187", description: "Egg, whole, cooked, scrambled" },
};

describe("parseQuantityString", () => {
  it("parses legacy quantity strings", () => {
    expect(parseQuantityString("2 slices")).toEqual({ quantity: 2, unit: "slice" });
    expect(parseQuantityString("150 g")).toEqual({ quantity: 150, unit: "g" });
    expect(parseQuantityString("1 whole")).toEqual({ quantity: 1, unit: "whole" });
    expect(parseQuantityString("0.5 cup")).toEqual({ quantity: 0.5, unit: "cup" });
    expect(parseQuantityString("a bowl")).toBeNull();
  });
});

describe("normalizeIngredientInput", () => {
  it("accepts an analysis item", () => {
    const n = normalizeIngredientInput(analysisItem)!;
    expect(n.name).toBe("Scrambled eggs");
    expect(n.quantity).toBe(2);
    expect(n.unit).toBe("whole");
    expect(n.grams).toBe(136);
    expect(n.nutrients.proteins).toBe(12);
    expect(n.nutrients.vitaminD).toBe(0);
    expect(n.referenceId).toBe("172187");
  });
  it("accepts a MealIngredient row shape", () => {
    const n = normalizeIngredientInput({ name: "Rice", quantity: 1, unit: "cup", grams: 158, calories: 205, nutrients: { carbohydrates: 45 } })!;
    expect(n.unit).toBe("cup");
    expect(n.nutrients.carbohydrates).toBe(45);
  });
  it("rejects nameless items", () => {
    expect(normalizeIngredientInput({ calories: 10 })).toBeNull();
  });
});

describe("totalsFromIngredients", () => {
  it("sums calories, nutrients, servings and glycemic load", () => {
    const a = normalizeIngredientInput({ ...analysisItem, glycemicIndex: 50, nutrients: { carbohydrates: 30 } })!;
    const b = normalizeIngredientInput({ name: "Banana", quantity: 1, unit: "whole", grams: 118, calories: 105, foodGroup: "fruit", fruitServings: 0.8, glycemicIndex: 51, nutrients: { carbohydrates: 27 } })!;
    const t = totalsFromIngredients([a, b]);
    expect(t.calories).toBe(287);
    expect(t.nutrients.carbohydrates).toBe(57);
    expect(t.fruitServings).toBe(0.8);
    expect(t.glycemicLoad).toBe(28.8);
    expect(t.isProcessedFood).toBe(false);
  });
});

describe("rescaleIngredient", () => {
  it("scales linearly and marks the portion as user-set", () => {
    const n = normalizeIngredientInput({ ...analysisItem, portionSource: "personalized_default", portionAssumption: "Assumed 2 eggs" })!;
    const r = rescaleIngredient(n, 3);
    expect(r.quantity).toBe(3);
    expect(r.grams).toBe(204);
    expect(r.calories).toBe(273);
    expect(r.nutrients.proteins).toBe(18);
    expect(r.portionSource).toBe("user");
    expect(r.portionAssumption).toBeNull();
  });
});
