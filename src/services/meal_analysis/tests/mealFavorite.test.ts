import { favoriteLine, favoriteMeal, matchIngredient, type StoredFavorite } from "../mealFavorite";
import { applyMealEdits, buildMealPreview, planFills } from "../mealBatch";

const TODAY = "2026-09-18";

// Stored like FavMealIngredient: servings live inside `nutrients`.
const row = (name: string, grams: number, kcal: number, portionSource = "standard_serving") => ({
  name,
  quantity: 1,
  unit: "serving",
  grams,
  gramsLow: grams * 0.7,
  gramsHigh: grams * 1.3,
  portionSource,
  foodGroup: "grain",
  isProcessedFood: false,
  glycemicIndex: 50,
  calories: kcal,
  nutrients: { proteins: 10, carbohydrates: 30, fats: 5, fiber: 2, vegetableServings: 0, fruitServings: name === "Orange juice" ? 1 : 0 },
  per100g: null,
  nutrientSource: "usda",
});

const breakfast: StoredFavorite = {
  id: "fav-1",
  userId: "u1",
  description: "Usual breakfast",
  mealType: "BREAKFAST",
  slot: "BREAKFAST",
  // Oats stated when first logged ("60 g"), the bar is a branded size.
  ingredients: [row("Oats", 60, 230, "user"), row("Semi-skimmed milk", 200, 100), row("Orange juice", 200, 90), row("Protein bar", 45, 200, "brand")],
};

const kcal = (m: { ingredients: { calories?: number }[] }) => Math.round(m.ingredients.reduce((a, i) => a + (i.calories ?? 0), 0));

describe("favoriteMeal", () => {
  test("copies the stored rows verbatim: same numbers every time, today, its own slot", () => {
    const a = favoriteMeal(breakfast, { favoriteId: "fav-1" }, TODAY).meal;
    const b = favoriteMeal(breakfast, { favoriteId: "fav-1" }, TODAY).meal;
    expect(kcal(a)).toBe(620);
    expect(a.ingredients.map((i) => i.grams)).toEqual(b.ingredients.map((i) => i.grams));
    expect(a).toMatchObject({ date: TODAY, mealType: "BREAKFAST", mealName: "Usual breakfast", portion: "normal", included: true });
    expect(a.favorite).toEqual({ id: "fav-1", name: "Usual breakfast", changes: null });
  });

  test("servings stored inside nutrients come back out, so the day counts the fruit", () => {
    const { meal } = favoriteMeal(breakfast, { favoriteId: "fav-1" }, TODAY);
    expect(meal.ingredients.find((i) => i.name === "Orange juice")!.fruitServings).toBe(1);
  });

  test("never mutates the stored favourite", () => {
    const before = JSON.stringify(breakfast);
    favoriteMeal(breakfast, { favoriteId: "fav-1", portion: "lots", remove: ["Oats"] }, TODAY);
    expect(JSON.stringify(breakfast)).toBe(before);
  });

  test("remove drops the named item; an unknown name is reported, not guessed", () => {
    const { meal, unmatched } = favoriteMeal(breakfast, { favoriteId: "fav-1", remove: ["orange juice", "bacon"] }, TODAY);
    expect(meal.ingredients.map((i) => i.name)).toEqual(["Oats", "Semi-skimmed milk", "Protein bar"]);
    expect(unmatched).toEqual(["bacon"]);
    expect(meal.favorite!.changes).toBe("no orange juice");
  });

  test("add appends the analysed extras after the saved items", () => {
    const banana = { ...row("Banana", 120, 105), nutrients: { proteins: 1, carbohydrates: 27, fats: 0 } } as any;
    const { meal } = favoriteMeal(breakfast, { favoriteId: "fav-1", remove: ["Orange juice"], add: "a banana" }, TODAY, [banana]);
    expect(meal.ingredients.map((i) => i.name)).toEqual(["Oats", "Semi-skimmed milk", "Protein bar", "Banana"]);
    expect(kcal(meal)).toBe(635);
    expect(meal.favorite!.changes).toBe("no orange juice, + banana");
  });

  test("a bigger one grows the saved amounts, including ones first stated, but not a branded size", () => {
    const { meal } = favoriteMeal(breakfast, { favoriteId: "fav-1", portion: "hearty" }, TODAY);
    const g = Object.fromEntries(meal.ingredients.map((i) => [i.name, i.grams]));
    expect(g.Oats).toBe(78);
    expect(g["Semi-skimmed milk"]).toBe(260);
    expect(g["Protein bar"]).toBe(45);
    expect(meal.portion).toBe("hearty");
    expect(meal.ingredients[0].portionSource).toBe("personalized_default");
  });

  test("the card's dial afterwards is idempotent and returns to the saved amounts", () => {
    const { meal } = favoriteMeal(breakfast, { favoriteId: "fav-1", portion: "hearty" }, TODAY);
    const preview = buildMealPreview([meal], { today: TODAY, timeZone: "America/New_York", subject: "you", subjectId: "u1", model: "saved-meal", heldBack: [] });
    const back = applyMealEdits(preview, { meals: [{ index: 0, portion: "normal" }] });
    expect(back.analysis.meals[0].ingredients.map((i) => i.grams)).toEqual([60, 200, 200, 45]);
    expect(back.days[0].meals[0].favorite).toEqual({ id: "fav-1", name: "Usual breakfast", changes: null });
  });

  test("date and meal type can be overridden", () => {
    const { meal } = favoriteMeal(breakfast, { favoriteId: "fav-1", date: "2026-09-17", mealType: "SNACK" }, TODAY);
    expect(meal).toMatchObject({ date: "2026-09-17", mealType: "SNACK", datePhrase: "2026-09-17" });
  });

  test("a saved meal takes its slot in a catch-up, so the usual day doesn't fill over it", () => {
    const { meal } = favoriteMeal(breakfast, { favoriteId: "fav-1", date: "2026-09-16" }, TODAY);
    const usual = { on: "all" as const, portion: "normal" as const, meals: [{ mealName: "Toast", mealType: "BREAKFAST", mealDate: "today", glycemicLoad: 0, ingredients: [row("Toast", 50, 130)] } as any] };
    expect(planFills([usual], ["2026-09-15", "2026-09-16"], {}, [meal]).map((f) => f.date)).toEqual(["2026-09-15"]);
  });
});

describe("matchIngredient", () => {
  const names = ["Oats", "Semi-skimmed milk", "Oat milk", "Orange juice"];
  test("exact name, any case", () => expect(matchIngredient(names, "oat milk", new Set())).toBe(2));
  test("a unique partial name", () => expect(matchIngredient(names, "juice", new Set())).toBe(3));
  test("an ambiguous partial name matches nothing", () => expect(matchIngredient(names, "milk", new Set())).toBeNull());
  test("an item already removed is not matched twice", () => expect(matchIngredient(names, "Oats", new Set([0]))).toBeNull());
});

describe("favoriteLine", () => {
  test("names the usual slot and the ingredients the agent may remove", () => {
    expect(favoriteLine({ id: "fav-1", description: "Usual breakfast", mealType: "BREAKFAST", slot: "BREAKFAST", calories: 620, ingredients: [{ name: "Oats" }, { name: "Protein bar" }] })).toBe(
      '"Usual breakfast" [fav-1] usual breakfast · 620 kcal — Oats, Protein bar'
    );
  });
});
