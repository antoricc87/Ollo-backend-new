import {
  favMealTotals,
  ingredientsFromFoodEntries,
  toPrismaFavIngredient,
} from "../model/favMealIngredients";

/** A modern FoodEntry: the detail lives in its MealIngredient rows. */
const modernEntry = () => ({
  id: "e1",
  description: "Scrambled eggs with toast",
  quantity: "1",
  calories: 999, // deliberately wrong — the ingredient rows are the truth
  ingredients: [
    {
      sortOrder: 0,
      name: "Scrambled eggs",
      searchTerm: "egg, whole, cooked, scrambled",
      quantity: 2,
      unit: "whole",
      grams: 100,
      gramsLow: 96,
      gramsHigh: 104,
      portionSource: "user",
      calories: 143,
      glycemicIndex: 0,
      nutrients: { proteins: 12, carbohydrates: 1, fats: 10, vegetableServings: 0, fruitServings: 0 },
      nutrientSource: "usda",
      per100g: { calories: 143 },
      referenceSource: "usda",
      referenceId: "173424",
    },
    {
      sortOrder: 1,
      name: "Toast",
      quantity: 1,
      unit: "slice",
      grams: 30,
      portionSource: "personalized_default",
      calories: 80,
      glycemicIndex: 70,
      nutrients: { proteins: 3, carbohydrates: 14, fats: 1, vegetableServings: 0, fruitServings: 0 },
    },
  ],
});

/** A legacy FoodEntry: no breakdown at all, only the entry's own columns. */
const legacyEntry = () => ({
  id: "e2",
  description: "Greek yogurt",
  quantity: "1 cup",
  calories: 150,
  proteins: 20,
  carbohydrates: 8,
  fats: 4,
  fiber: 0,
  sodium: 60,
  ingredients: [],
});

describe("ingredientsFromFoodEntries", () => {
  test("a modern entry contributes its own ingredient rows, in order", () => {
    const out = ingredientsFromFoodEntries([modernEntry()]);
    expect(out.map((i) => i.name)).toEqual(["Scrambled eggs", "Toast"]);
    expect(out[0]).toMatchObject({
      quantity: 2,
      unit: "whole",
      grams: 100,
      gramsLow: 96,
      gramsHigh: 104,
      portionSource: "user",
      calories: 143,
      nutrientSource: "usda",
      referenceId: "173424",
    });
    // The band and the USDA reference survive — that is what makes a copy deterministic.
    expect(out[0].per100g).toEqual({ calories: 143 });
  });

  test("a legacy entry with no breakdown becomes one ingredient from its own columns", () => {
    const out = ingredientsFromFoodEntries([legacyEntry()]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ name: "Greek yogurt", quantity: 1, unit: "cup", calories: 150 });
    expect(out[0].nutrients.proteins).toBe(20);
    expect(out[0].nutrients.carbohydrates).toBe(8);
    // No grams and nothing assumed behind it, so the portion dial must leave it alone.
    expect(out[0].portionSource).toBe("user");
    expect(out[0].grams).toBe(0);
  });

  test("entries are concatenated and junk is dropped", () => {
    const out = ingredientsFromFoodEntries([modernEntry(), legacyEntry(), null as any, { id: "x" } as any]);
    expect(out.map((i) => i.name)).toEqual(["Scrambled eggs", "Toast", "Greek yogurt"]);
  });

  test("servings stored inside the nutrients JSON survive the round trip", () => {
    const entry = {
      id: "e3",
      ingredients: [
        { name: "Broccoli", quantity: 1, unit: "cup", grams: 150, calories: 50, glycemicIndex: 0, nutrients: { proteins: 4, carbohydrates: 10, fats: 0, vegetableServings: 1.9, fruitServings: 0 } },
      ],
    };
    const [i] = ingredientsFromFoodEntries([entry]);
    expect(i.vegetableServings).toBe(1.9);
    // ...and go back into the JSON column on the way to Prisma.
    expect((toPrismaFavIngredient(i, 0).nutrients as any).vegetableServings).toBe(1.9);
  });
});

describe("favMealTotals", () => {
  test("the scalar columns are a cache recomputed from the ingredients", () => {
    const ings = ingredientsFromFoodEntries([modernEntry()]);
    const t = favMealTotals(ings);
    expect(t.calories).toBe(223); // 143 + 80, not the entry's wrong 999
    expect(t.proteins).toBe(15);
    expect(t.carbohydrates).toBe(15);
    expect(t.fats).toBe(11);
    expect(t.glycemicLoad).toBe(9.8); // 0×1/100 + 70×14/100
    expect(t.isProcessedFood).toBe(false);
  });

  test("an empty favourite totals to zero rather than NaN", () => {
    const t = favMealTotals([]);
    expect(t.calories).toBe(0);
    expect(t.proteins).toBe(0);
    expect(t.glycemicLoad).toBe(0);
  });
});

describe("toPrismaFavIngredient", () => {
  test("writes the same columns as MealIngredient, with sortOrder", () => {
    const [egg] = ingredientsFromFoodEntries([modernEntry()]);
    const row = toPrismaFavIngredient(egg, 3);
    expect(row.sortOrder).toBe(3);
    expect(row).toMatchObject({ name: "Scrambled eggs", grams: 100, gramsLow: 96, gramsHigh: 104, portionSource: "user" });
    expect(Object.keys(row)).toEqual(
      expect.arrayContaining(["name", "searchTerm", "brand", "quantity", "unit", "grams", "gramsLow", "gramsHigh", "portionSource", "calories", "nutrients", "per100g", "nutrientSource"])
    );
  });
});
