import { markDuplicates, needsConfirmation, sameFood, type BatchMeal, type ExistingEntry } from "../../src/services/meal_analysis/mealBatch";

const snack = (name: string, calories: number): BatchMeal =>
  ({ mealName: name, mealType: "SNACK", mealDate: "2026-10-07", date: "2026-10-07", datePhrase: "today", included: true, portion: "normal", duplicateOf: null, ingredients: [{ name: "x", grams: 100, quantity: 1, calories, nutrients: { protein: 10 } }] } as any);
const logged = (description: string, calories: number, minutesAgo: number, now: Date): ExistingEntry => ({ mealType: "SNACK", description, calories, createdAt: new Date(now.getTime() - minutesAgo * 60000).toISOString() });
const now = new Date("2026-10-07T15:00:00Z");
const kcal = (m: BatchMeal) => m.ingredients.reduce((a: number, i: any) => a + i.calories, 0);

describe("a repeated log", () => {
  it("reads the same food in other words as the same", () => {
    expect(sameFood("Banana + cappuccino", "Cappuccino and a banana")).toBe(true);
    expect(sameFood("Banana + cappuccino", "Banana and almonds")).toBe(false);
  });

  it("reuses the first calories and asks before saving when logged moments ago", () => {
    const [m] = markDuplicates([snack("Banana and cappuccino", 215)], { "2026-10-07": [logged("Banana + cappuccino", 170, 30, now)] }, now);
    expect(Math.round(kcal(m))).toBe(170);
    expect(m.repeatOf).toEqual({ description: "Banana + cappuccino", calories: 170 });
    expect(m.included).toBe(true);
    expect(needsConfirmation({ analysis: { meals: [m] } })).toBe(true);
  });

  it("leaves a different snack, and the same one hours later, alone", () => {
    const other = markDuplicates([snack("Apple", 95)], { "2026-10-07": [logged("Banana + cappuccino", 170, 30, now)] }, now)[0];
    expect(other.repeatOf ?? null).toBeNull();
    expect(kcal(other)).toBe(95);
    const later = markDuplicates([snack("Banana and cappuccino", 215)], { "2026-10-07": [logged("Banana + cappuccino", 170, 180, now)] }, now)[0];
    expect(later.repeatOf ?? null).toBeNull();
    expect(kcal(later)).toBe(215);
    expect(needsConfirmation({ analysis: { meals: [later] } })).toBe(false);
  });

  it("does not treat an entry with no time as recent", () => {
    const [m] = markDuplicates([snack("Banana and cappuccino", 215)], { "2026-10-07": [{ mealType: "SNACK", description: "Banana + cappuccino", calories: 170, createdAt: null }] }, now);
    expect(m.repeatOf ?? null).toBeNull();
  });
});
