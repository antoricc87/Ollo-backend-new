import { applyMealEdits, buildMealPreview, dedupeMeals, markDuplicates, missingSlots, needsSegmentation, normalizePreview, validateSegments, type BatchMeal } from "../mealBatch";
import { dedupeIngredients } from "../mealAnalysis.rules";

const TODAY = "2026-08-26";
const TZ = "Europe/Rome";

const ing = (name: string, grams: number, kcal: number, protein = 10) =>
  ({ name, quantity: 1, unit: "g", grams, calories: kcal, nutrients: { proteins: protein, carbohydrates: 20, fats: 5 }, portionSource: "user", warnings: [] } as any);

/** An item the analyser sized itself, with a band the dial can walk. */
const assumedIng = (name: string, grams: number, kcal: number, low: number, high: number) =>
  ({ name, quantity: 1, unit: "cup", grams, gramsLow: low, gramsHigh: high, calories: kcal, nutrients: { proteins: 10, carbohydrates: 20, fats: 5 }, portionSource: "personalized_default", warnings: [] } as any);

const meal = (over: Partial<BatchMeal>): BatchMeal =>
  ({
    mealName: "Meal",
    mealType: "LUNCH",
    mealDate: "today",
    date: TODAY,
    datePhrase: "today",
    included: true,
    duplicateOf: null,
    glycemicLoad: 0,
    ingredients: [ing("rice", 200, 260), ing("chicken", 150, 250)],
    ...over,
  } as BatchMeal);

const ctx = { today: TODAY, timeZone: TZ, subject: "you", subjectId: "p1", model: "test", heldBack: [] };

describe("needsSegmentation", () => {
  test("short single-day text is analysed whole", () => {
    expect(needsSegmentation("2 eggs and toast for breakfast")).toBe(false);
    expect(needsSegmentation("yesterday I had a burger")).toBe(false);
  });
  test("two day cues or long text segment", () => {
    expect(needsSegmentation("yesterday I had a burger, and on Monday pasta")).toBe(true);
    expect(needsSegmentation("x".repeat(500))).toBe(true);
  });
});

describe("buildMealPreview", () => {
  test("groups by day in order with labels and included totals", () => {
    const p = buildMealPreview(
      [meal({ mealName: "Pasta", mealType: "DINNER", date: "2026-08-25" }), meal({ mealName: "Eggs", mealType: "BREAKFAST" }), meal({ mealName: "Snack", mealType: "SNACK", included: false })],
      ctx
    );
    expect(p.days.map((d) => d.label)).toEqual(["Yesterday", "Today"]);
    expect(p.days[0].meals[0].index).toBe(0);
    expect(p.days[1].meals.map((m) => m.index)).toEqual([1, 2]);
    expect(p.days[1].calories).toBe(510); // unticked snack excluded
    expect(p.totals).toEqual({ meals: 3, included: 2, calories: 1020 });
  });
});

describe("applyMealEdits", () => {
  const preview = buildMealPreview([meal({ mealName: "Eggs", mealType: "BREAKFAST" }), meal({ mealName: "Pasta", mealType: "DINNER", date: "2026-08-25" })], ctx);
  test("untick, move day, change type, scale portions", () => {
    const out = applyMealEdits(preview, {
      meals: [
        { index: 0, included: false },
        { index: 1, date: "2026-08-24", mealType: "LUNCH", ingredients: [{ index: 0, grams: 100 }, { index: 1, grams: null }] },
      ],
    });
    expect(out.edited).toBe(true);
    expect(out.analysis.meals[0].included).toBe(false);
    const pasta = out.analysis.meals[1];
    expect(pasta.date).toBe("2026-08-24");
    expect(pasta.mealType).toBe("LUNCH");
    expect(pasta.ingredients).toHaveLength(1);
    expect(pasta.ingredients[0].calories).toBe(130);
    expect(pasta.ingredients[0].nutrients.proteins).toBe(5);
    expect(out.days.map((d) => d.date)).toEqual(["2026-08-24", TODAY]);
    expect(out.totals).toEqual({ meals: 2, included: 1, calories: 130 });
  });
  test("rejects future days and empty meals", () => {
    expect(() => applyMealEdits(preview, { meals: [{ index: 0, date: "2026-09-01" }] })).toThrow(/future/);
    expect(() => applyMealEdits(preview, { meals: [{ index: 0, ingredients: [{ index: 0, grams: null }, { index: 1, grams: null }] }] })).toThrow(/untick/);
  });
  test("legacy single-day previews still apply portion edits", () => {
    const legacy = { date: TODAY, subject: "you", subjectId: "p1", analysis: { model: "m", meals: [{ mealName: "Eggs", mealType: "BREAKFAST", ingredients: [ing("egg", 100, 150)] }] } };
    const out = applyMealEdits(legacy, { meals: [{ index: 0, ingredients: [{ index: 0, grams: 50 }] }] });
    expect(out.analysis.meals[0].date).toBe(TODAY);
    expect(out.analysis.meals[0].ingredients[0].calories).toBe(75);
    expect(normalizePreview(legacy).days[0].date).toBe(TODAY);
  });
});

describe("the portion dial", () => {
  const dialMeal = () => meal({ mealName: "Pasta", ingredients: [ing("egg", 100, 150), assumedIng("pasta", 260, 400, 180, 360)] });

  test("the card gets every stop precomputed, and knows when the dial is pointless", () => {
    const p = buildMealPreview([dialMeal(), meal({ mealName: "Weighed" })], ctx);
    const [egg, pasta] = p.days[0].meals[0].ingredients;
    expect(egg.gramsAt).toEqual({ light: 100, normal: 100, hearty: 100, lots: 100 });
    expect(pasta.gramsAt).toEqual({ light: 180, normal: 260, hearty: 360, lots: 450 });
    expect(p.days[0].meals[0]).toMatchObject({ portion: "normal", portionScalable: true });
    // Every amount came from the user — nothing for the dial to move.
    expect(p.days[0].meals[1].portionScalable).toBe(false);
  });

  test("a stop scales only the assumed item and is recorded on the meal", () => {
    const out = applyMealEdits(buildMealPreview([dialMeal()], ctx), { meals: [{ index: 0, portion: "hearty" }] });
    const m = out.analysis.meals[0];
    expect(m.portion).toBe("hearty");
    expect(m.ingredients[0]).toMatchObject({ grams: 100, calories: 150, portionSource: "user" });
    expect(m.ingredients[1].grams).toBe(360);
    expect(m.ingredients[1].calories).toBeCloseTo(553.8, 1);
    // The dial is not the user stating a portion — the item stays dial-able.
    expect(m.ingredients[1].portionSource).toBe("personalized_default");
    expect(out.days[0].meals[0].calories).toBe(704);
  });

  test("an explicit gram edit beats the dial and freezes that item", () => {
    const out = applyMealEdits(buildMealPreview([dialMeal()], ctx), {
      meals: [{ index: 0, portion: "lots", ingredients: [{ index: 1, grams: 200 }] }],
    });
    const m = out.analysis.meals[0];
    expect(m.portion).toBe("lots");
    expect(m.ingredients[1]).toMatchObject({ grams: 200, portionSource: "user" });
    expect(m.ingredients[1].calories).toBeCloseTo(307.7, 1); // 400 × 200/260, not via 450
  });

  test("moving the dial back restores the analyser's own numbers", () => {
    const preview = buildMealPreview([dialMeal()], ctx);
    const heavy = applyMealEdits(preview, { meals: [{ index: 0, portion: "lots" }] });
    const back = applyMealEdits(heavy, { meals: [{ index: 0, portion: "normal" }] });
    expect(back.analysis.meals[0].ingredients[1]).toMatchObject({ grams: 260, calories: 400 });
    expect(back.analysis.meals[0].portion).toBe("normal");
  });

  test("legacy previews with no portion default to normal", () => {
    const legacy = { date: TODAY, subject: "you", subjectId: "p1", analysis: { model: "m", meals: [{ mealName: "Eggs", mealType: "BREAKFAST", ingredients: [ing("egg", 100, 150)] }] } };
    expect(normalizePreview(legacy).analysis.meals[0].portion).toBe("normal");
  });
});

describe("duplicates and gaps", () => {
  const meals = [meal({ mealName: "Eggs", mealType: "BREAKFAST", date: "2026-08-25" }), meal({ mealName: "Bar", mealType: "SNACK", date: "2026-08-25" }), meal({ mealName: "Steak", mealType: "DINNER" })];
  const existing = { "2026-08-25": [{ mealType: "BREAKFAST", description: "Oats", calories: 300 }, { mealType: "SNACK", description: "Apple", calories: 80 }] };
  test("main-slot collisions untick, snack collisions only annotate", () => {
    const out = markDuplicates(meals, existing);
    expect(out[0]).toMatchObject({ included: false, duplicateOf: "Oats (300 kcal)" });
    expect(out[1]).toMatchObject({ included: true, duplicateOf: "Apple (80 kcal)" });
    expect(out[2].duplicateOf).toBeNull();
  });
  test("missing slots only for multi-day batches", () => {
    expect(missingSlots(meals, existing)).toEqual({ "2026-08-25": ["lunch", "dinner"], [TODAY]: ["breakfast", "lunch"] });
    expect(missingSlots([meals[2]], {})).toEqual({});
  });
});

describe("segment validation", () => {
  const text = "The other day I had a burrito for lunch, and yesterday a greek yogurt with honey for breakfast.";
  test("accepts contiguous non-overlapping slices", () => {
    expect(validateSegments(text, [{ dayPhrase: "the other day", text: "The other day I had a burrito for lunch, and" }, { dayPhrase: "yesterday", text: "yesterday a greek yogurt with honey for breakfast." }])).toBe(true);
  });
  test("rejects overlapping or invented segments", () => {
    expect(validateSegments(text, [{ dayPhrase: "the other day", text: "I had a burrito for lunch, and yesterday a greek yogurt with honey for breakfast." }, { dayPhrase: "yesterday", text: "a greek yogurt with honey for breakfast." }])).toBe(false);
    expect(validateSegments(text, [{ dayPhrase: null, text: "a burrito and a yogurt" }])).toBe(false);
    expect(validateSegments(text, [])).toBe(false);
  });
  test("dedupeMeals collapses the same meal analysed twice", () => {
    const a = meal({ mealName: "Yogurt", mealType: "BREAKFAST", ingredients: [ing("greek yogurt", 170, 160), ing("honey", 21, 64)] });
    const b = meal({ mealName: "Greek yogurt with honey", mealType: "BREAKFAST", ingredients: [ing("Honey", 21, 64), ing("Greek yogurt", 170, 160)] });
    expect(dedupeMeals([a, b])).toHaveLength(1);
    expect(dedupeMeals([a, { ...b, date: "2026-08-25" }])).toHaveLength(2);
  });
});

describe("dedupeIngredients composite rule", () => {
  test("drops a row that restates two components", () => {
    const rows = [ing("Greek yogurt", 170, 160), ing("Honey", 21, 64), ing("Meal-specific Greek yogurt with honey", 191, 180)];
    expect(dedupeIngredients(rows).map((r) => r.name)).toEqual(["Greek yogurt", "Honey"]);
  });
  test("keeps rows that only share one component name", () => {
    const rows = [ing("Peanut butter", 32, 190), ing("Butter", 5, 36), ing("Bread", 30, 80)];
    expect(dedupeIngredients(rows)).toHaveLength(3);
  });
});
