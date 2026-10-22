import { copiedMeal } from "../mealFavorite";
import { ingredientsFromFoodEntries } from "../../nutrition/model/favMealIngredients";

/** "The same as lunch" (Oct 19 2026): the logged entry's numbers, copied — never re-estimated. */
const TODAY = "2026-10-19";
const row = (name: string, grams: number, kcal: number) => ({
  name, quantity: grams, unit: "g", grams, gramsLow: grams, gramsHigh: grams, portionSource: "user", foodGroup: "protein",
  isProcessedFood: false, glycemicIndex: 0, calories: kcal, nutrients: { proteins: 20, carbohydrates: 10, fats: 5, vegetableServings: 0, fruitServings: 0 }, nutrientSource: "usda",
});
const lunch = { id: "entry-lunch", description: "Chicken salad with rice", mealType: "LUNCH" };
const rows = [row("Grilled chicken", 150, 250), row("Rice", 120, 160), row("Mixed salad", 80, 20), row("Olive oil", 10, 90)];
const kcal = (m: { ingredients: { calories?: number }[] }) => Math.round(m.ingredients.reduce((a, i) => a + (i.calories ?? 0), 0));

describe("copiedMeal", () => {
  it("copies the logged numbers exactly, for the meal and day asked", () => {
    const { meal } = copiedMeal(lunch, rows, { entryId: lunch.id, mealType: "DINNER" }, TODAY);
    expect(kcal(meal)).toBe(520);
    expect(meal).toMatchObject({ mealName: "Chicken salad with rice", mealType: "DINNER", date: TODAY });
    expect(meal.ingredients.map((i) => i.grams)).toEqual([150, 120, 80, 10]);
  });

  it("is not tagged as a saved meal (the commit must not bump a favourite)", () => {
    expect(copiedMeal(lunch, rows, { entryId: lunch.id }, TODAY).meal.favorite).toBeNull();
  });

  it("keeps the original meal type unless another is asked, and handles 'without' and another day", () => {
    const { meal, unmatched } = copiedMeal(lunch, rows, { entryId: lunch.id, remove: ["rice", "croutons"], date: "2026-10-18" }, TODAY);
    expect(meal.mealType).toBe("LUNCH");
    expect(meal.date).toBe("2026-10-18");
    expect(meal.ingredients.map((i) => i.name)).not.toContain("Rice");
    expect(unmatched).toEqual(["croutons"]);
  });

  it("an entry logged before ingredients were stored is copied as one item with its totals", () => {
    const legacy = { id: "old", description: "Pasta al pomodoro", mealType: "DINNER", calories: 640, proteins: 20, carbs: 100, fats: 15, ingredients: [] };
    const fallback = ingredientsFromFoodEntries([legacy as any]);
    const { meal } = copiedMeal(legacy, fallback, { entryId: "old" }, TODAY);
    expect(meal.ingredients).toHaveLength(1);
    expect(kcal(meal)).toBe(640);
  });
});
