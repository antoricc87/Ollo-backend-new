import { openSlots, slotShareOf } from "../../src/services/agent/tools/budget";

const none = new Set<string>();

describe("meal budget — which other meals are still open", () => {
  it("dinner asked at 7 am keeps breakfast, lunch and the snack open (the bug: it used to give dinner the whole day)", () => {
    expect(openSlots("DINNER", "BREAKFAST", none)).toEqual(["BREAKFAST", "LUNCH", "SNACK"]);
    expect(slotShareOf("DINNER", openSlots("DINNER", "BREAKFAST", none))).toBeCloseTo(0.35 / 1.05, 5);
  });
  it("dinner asked at dinner time has nothing else open", () => {
    expect(openSlots("DINNER", "DINNER", none)).toEqual([]);
    expect(slotShareOf("DINNER", [])).toBe(1);
  });
  it("lunch at lunch time: unchanged from before — snack and dinner share the rest", () => {
    expect(openSlots("LUNCH", "LUNCH", none)).toEqual(["SNACK", "DINNER"]);
  });
  it("a logged meal is not open; a meal the clock has passed is treated as skipped", () => {
    expect(openSlots("DINNER", "BREAKFAST", new Set(["LUNCH"]))).toEqual(["BREAKFAST", "SNACK"]);
    expect(openSlots("DINNER", "SNACK", none)).toEqual(["SNACK"]);
  });
});
