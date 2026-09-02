import {
  applyPortionStop,
  caloriesAtStop,
  DEFAULT_PORTION_STOP,
  ensurePortionBase,
  gramsAtEveryStop,
  isMealPortionScalable,
  isPortionScalable,
  isPortionStop,
  PORTION_STOPS,
  scaledGrams,
} from "../mealPortion";

/** An item the analyser sized itself: 260 g best guess inside a 180–360 g band. */
const assumed = (over: any = {}) => ({
  name: "pasta",
  quantity: 1,
  unit: "cup",
  grams: 260,
  gramsLow: 180,
  gramsHigh: 360,
  portionSource: "personalized_default",
  calories: 400,
  nutrients: { proteins: 14, carbohydrates: 80, fats: 4 },
  ...over,
});

/** An item the user quantified: two eggs. */
const stated = (over: any = {}) => ({
  name: "eggs",
  quantity: 2,
  unit: "whole",
  grams: 100,
  gramsLow: 96,
  gramsHigh: 104,
  portionSource: "user",
  calories: 143,
  nutrients: { proteins: 12, carbohydrates: 1, fats: 10 },
  ...over,
});

describe("scaledGrams", () => {
  test("walks the analyser's own band", () => {
    const i = assumed();
    expect(scaledGrams(i, "light")).toBe(180);
    expect(scaledGrams(i, "normal")).toBe(260);
    expect(scaledGrams(i, "hearty")).toBe(360);
    expect(scaledGrams(i, "lots")).toBe(450); // gramsHigh × 1.25
  });

  test("a portion the user stated never moves, at any stop", () => {
    for (const stop of PORTION_STOPS) expect(scaledGrams(stated(), stop)).toBe(100);
  });

  test("a branded item's own size never moves either", () => {
    const coke = assumed({ name: "coke", grams: 355, gramsLow: 355, gramsHigh: 355, portionSource: "brand" });
    for (const stop of PORTION_STOPS) expect(scaledGrams(coke, stop)).toBe(355);
  });

  test("falls back to the size-word scale per side when the band is degenerate", () => {
    const flat = assumed({ grams: 100, gramsLow: 100, gramsHigh: 100 });
    expect(scaledGrams(flat, "light")).toBe(70);
    expect(scaledGrams(flat, "hearty")).toBe(140);
    expect(scaledGrams(flat, "lots")).toBe(180);
    // Only one side missing: the band is used where it exists.
    const halfBand = assumed({ grams: 100, gramsLow: 100, gramsHigh: 150 });
    expect(scaledGrams(halfBand, "light")).toBe(70);
    expect(scaledGrams(halfBand, "hearty")).toBe(150);
  });

  test("small amounts keep a decimal, and grams stay inside the edit bounds", () => {
    expect(scaledGrams(assumed({ grams: 5, gramsLow: 5, gramsHigh: 5 }), "light")).toBe(3.5);
    expect(scaledGrams(assumed({ grams: 1, gramsLow: 1, gramsHigh: 1 }), "light")).toBe(1); // clamped at MIN_GRAMS
    expect(scaledGrams(assumed({ grams: 4000, gramsLow: 4000, gramsHigh: 4000 }), "lots")).toBe(5000); // MAX_GRAMS
  });

  test("a zero-gram row can never scale, whatever its portionSource", () => {
    // Favourites backfilled from a bare legacy FoodEntry look like this.
    const legacy = { name: "Burrito bowl", quantity: 1, unit: "serving", grams: 0, portionSource: null, calories: 860, nutrients: { proteins: 40 } } as any;
    expect(isPortionScalable(legacy)).toBe(false);
    expect(isMealPortionScalable([legacy])).toBe(false);
    for (const stop of PORTION_STOPS) expect(scaledGrams(legacy, stop)).toBe(0);
    // ...and its calories stay put rather than vanishing.
    expect(caloriesAtStop([legacy], "lots")).toBe(860);
  });

  test("scalability follows portionSource", () => {
    expect(isPortionScalable(assumed())).toBe(true);
    expect(isPortionScalable(assumed({ portionSource: "standard_serving" }))).toBe(true);
    expect(isPortionScalable(stated())).toBe(false);
    expect(isMealPortionScalable([stated(), assumed()])).toBe(true);
    expect(isMealPortionScalable([stated(), stated()])).toBe(false);
  });
});

describe("applyPortionStop", () => {
  test("scales calories and nutrients with grams, leaving stated items alone", () => {
    const ings = [stated(), assumed()];
    applyPortionStop(ings, "hearty");
    expect(ings[0]).toMatchObject({ grams: 100, calories: 143 });
    expect(ings[1].grams).toBe(360);
    expect(ings[1].calories).toBeCloseTo(553.8, 1); // 400 × 360/260
    expect(ings[1].nutrients.proteins).toBeCloseTo(19.385, 2);
    expect(ings[1].quantity).toBeCloseTo(1.38, 2);
  });

  test("is idempotent — the same stop twice changes nothing", () => {
    const once = [assumed()];
    const twice = [assumed()];
    applyPortionStop(once, "lots");
    applyPortionStop(twice, "lots");
    applyPortionStop(twice, "lots");
    expect(twice[0]).toEqual(once[0]);
  });

  test("is reversible — every stop is derived from the untouched base", () => {
    const ings = [assumed()];
    const pristine = { ...assumed() };
    applyPortionStop(ings, "lots");
    applyPortionStop(ings, "light");
    expect(ings[0].grams).toBe(180);
    applyPortionStop(ings, "normal");
    expect(ings[0].grams).toBe(pristine.grams);
    expect(ings[0].calories).toBeCloseTo(pristine.calories, 4);
    expect(ings[0].nutrients.proteins).toBeCloseTo(pristine.nutrients.proteins, 3);
  });

  test("the band itself is never rescaled", () => {
    const ings = [assumed()];
    applyPortionStop(ings, "hearty");
    expect(ings[0]).toMatchObject({ gramsBase: 260, gramsLow: 180, gramsHigh: 360 });
  });
});

describe("gramsAtEveryStop and caloriesAtStop", () => {
  test("every stop precomputed for the card", () => {
    expect(gramsAtEveryStop(assumed())).toEqual({ light: 180, normal: 260, hearty: 360, lots: 450 });
    expect(gramsAtEveryStop(stated())).toEqual({ light: 100, normal: 100, hearty: 100, lots: 100 });
  });

  test("meal kcal at a stop counts only what moves", () => {
    const meal = [stated(), assumed()];
    expect(caloriesAtStop(meal, "normal")).toBeCloseTo(543, 0);
    expect(caloriesAtStop(meal, "light")).toBeCloseTo(143 + 400 * (180 / 260), 0);
    expect(caloriesAtStop(meal, "hearty")).toBeCloseTo(143 + 400 * (360 / 260), 0);
  });
});

describe("helpers", () => {
  test("isPortionStop guards the stored value", () => {
    expect(isPortionStop("hearty")).toBe(true);
    expect(isPortionStop("HEARTY")).toBe(false);
    expect(isPortionStop(undefined)).toBe(false);
    expect(DEFAULT_PORTION_STOP).toBe("normal");
  });

  test("ensurePortionBase stamps once and never overwrites", () => {
    const ings = [{ grams: 200 }, { grams: 50, gramsBase: 80 }] as any[];
    ensurePortionBase(ings);
    ensurePortionBase(ings);
    expect(ings[0].gramsBase).toBe(200);
    expect(ings[1].gramsBase).toBe(80);
  });
});
