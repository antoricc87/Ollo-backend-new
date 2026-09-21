import { countText, planPortion, portionLine, snapFraction } from "../portionCheck";

/** The analyser sized it: 260 g inside a 180–360 g band, 400 kcal. */
const pasta = (over: any = {}): any => ({
  name: "Pasta",
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
/** Also assumed: one sausage, 200 kcal. */
const sausage = (over: any = {}): any => ({
  name: "Pork sausage",
  quantity: 1,
  unit: "piece",
  grams: 75,
  gramsLow: 60,
  gramsHigh: 100,
  portionSource: "standard_serving",
  calories: 200,
  nutrients: { proteins: 10, carbohydrates: 1, fats: 17 },
  ...over,
});
/** The user said it: a 400 g frozen pizza, 8 slices, 1000 kcal. */
const pizza = (over: any = {}): any => ({
  name: "Frozen pizza",
  quantity: 8,
  unit: "slice",
  grams: 400,
  gramsLow: 400,
  gramsHigh: 400,
  portionSource: "user",
  calories: 1000,
  nutrients: { proteins: 40, carbohydrates: 120, fats: 40 },
  ...over,
});

const range: [number, number] = [1500, 1700];

describe("snapFraction", () => {
  it.each([
    [0.48, 0.5, "About half"],
    [0.3, 1 / 3, "About a third"],
    [0.73, 0.75, "About three quarters"],
    [0.7, 2 / 3, "About two thirds"],
    [0.97, 1, "All of it"],
    [0.12, 0.1, "About 10%"],
  ])("%p → %p (%s)", (f, value, label) => {
    const s = snapFraction(f);
    expect(s.value).toBeCloseTo(value as number, 5);
    expect(s.label).toBe(label);
  });
});

describe("countText", () => {
  it("writes halves the way people say them", () => {
    expect(countText(2.4, "slice")).toBe("2½ slices");
    expect(countText(0.5, "cup")).toBe("½ cup");
    expect(countText(4, "slice")).toBe("4 slices");
    expect(countText(1, "piece")).toBe("1 piece");
  });
});

describe("planPortion — on hand (every amount stated)", () => {
  it("answers as a fraction of what they have, in their unit", () => {
    const p = planPortion([pizza()], 520);
    expect(p.mode).toBe("on_hand");
    expect(p.headline).toBe("About half");
    expect(p.totals.calories).toBe(500);
    expect(p.ingredients[0].grams).toBe(200);
    expect(p.ingredients[0].amount).toBe("4 slices (≈200 g)");
    expect(p.ingredients[0].onHand).toBe("8 slices (≈400 g)");
  });
  it("never recommends more than they have", () => {
    const p = planPortion([pizza()], 1400);
    expect(p.verdict).toBe("all_fits");
    expect(p.totals.calories).toBe(1000);
  });
  it("nothing left today → says so, recommends nothing", () => {
    const p = planPortion([pizza()], -50);
    expect(p.verdict).toBe("none_left");
    expect(p.totals.calories).toBe(0);
    expect(portionLine(p, { eatenKcal: 1650, kcalLeft: -50, aimKcal: -50, range, laterSlots: [] })).toMatch(/already at 1650 of 1500–1700.*A quarter of it would add about 250 kcal/);
  });
  it("does not mutate the analyser's ingredients", () => {
    const input = [pizza()];
    planPortion(input, 300);
    expect(input[0].grams).toBe(400);
    expect(input[0].calories).toBe(1000);
  });
});

describe("planPortion — assumed (the analyser sized the plate)", () => {
  it("keeps their dish and scales the whole plate to the aim", () => {
    const p = planPortion([pasta(), sausage()], 480); // normal = 600
    expect(p.mode).toBe("assumed");
    expect(p.verdict).toBe("fits");
    expect(p.factor).toBe(0.8);
    expect(p.ingredients.map((i) => i.name)).toEqual(["Pasta", "Pork sausage"]);
    expect(p.totals.calories).toBe(480);
    expect(p.headline).toBe("A smaller plate — about 80% of a normal one");
  });
  it("floors at the smallest sensible meal and says how far over it lands", () => {
    const p = planPortion([pasta(), sausage()], 150);
    expect(p.verdict).toBe("light_over");
    expect(p.totals.calories).toBe(300); // 300 kcal floor for a main, not a 150 kcal crumb
    const line = portionLine(p, { eatenKcal: 1450, kcalLeft: 150, aimKcal: 150, range, laterSlots: [] });
    expect(line).toMatch(/Even a small plate is about 300 kcal — 150 over what's left/);
  });
  it("goes well below the analyser's 'light' band when that's what fits (real-data case, Sep 21)", () => {
    // Normal plate 990 kcal; dinner's share 513 → about half a plate, not "light plate is 229 over".
    const big = [pasta({ calories: 660, grams: 280 }), sausage({ calories: 330, grams: 170 })];
    const p = planPortion(big, 513);
    expect(p.verdict).toBe("fits");
    expect(p.totals.calories).toBeGreaterThanOrEqual(480);
    expect(p.totals.calories).toBeLessThanOrEqual(545);
  });
  it("a snack floors at 100 kcal", () => {
    const p = planPortion([sausage()], 40, 100);
    expect(p.totals.calories).toBe(100);
  });
  it("caps at a hearty plate and reports the room instead of piling it on", () => {
    const p = planPortion([pasta(), sausage()], 1500);
    expect(p.verdict).toBe("room_left");
    expect(p.factor).toBeLessThanOrEqual(1.4);
    const line = portionLine(p, { eatenKcal: 100, kcalLeft: 1500, aimKcal: 1500, range, laterSlots: [] });
    expect(line).toMatch(/to spare/);
  });
  it("a stated amount in a mixed plate shrinks with it but never grows past what they have", () => {
    const down = planPortion([pizza(), sausage({ name: "Side salad", calories: 100 })], 550);
    expect(down.ingredients[0].grams).toBeLessThan(400);
    const up = planPortion([pizza(), sausage({ name: "Side salad", calories: 100 })], 1500);
    expect(up.ingredients[0].grams).toBe(400);
  });
  it("no target → a normal plate, said plainly", () => {
    const p = planPortion([pasta(), sausage()], null);
    expect(p.verdict).toBe("no_target");
    expect(p.totals.calories).toBe(600);
    expect(portionLine(p, { eatenKcal: 0, kcalLeft: null, aimKcal: null, range: null, laterSlots: [] })).toMatch(/no calorie target/);
  });
});

describe("portionLine", () => {
  it("names the meals still to come", () => {
    const p = planPortion([pasta(), sausage()], 480);
    expect(portionLine(p, { eatenKcal: 520, kcalLeft: 1080, aimKcal: 480, range, laterSlots: ["SNACK", "DINNER"] })).toBe("480 kcal — leaves about 600 for snack and dinner.");
  });
  it("last meal of the day → where the day lands", () => {
    const p = planPortion([pasta(), sausage()], 480);
    expect(portionLine(p, { eatenKcal: 1100, kcalLeft: 500, aimKcal: 500, range, laterSlots: [] })).toBe("480 kcal — the day lands at about 1580 of 1500–1700.");
  });
});

describe("portionLine — meals still to come", () => {
  it("light_over early in the day talks about this meal's share, not where the day lands", () => {
    const p = planPortion([pasta(), sausage()], 150);
    const line = portionLine(p, { eatenKcal: 0, kcalLeft: 1540, aimKcal: 150, range: [1390, 1690], laterSlots: ["BREAKFAST", "LUNCH", "SNACK"] });
    expect(line).toMatch(/Even a small plate .* over this meal's share, leaving about \d+ for breakfast, lunch and snack\./);
    expect(line).not.toMatch(/day would land/);
  });
});
