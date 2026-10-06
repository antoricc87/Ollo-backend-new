import { pendingProposal, spoken } from "../../src/services/agent/voice";

/** What Siri reads out: short, plain, and never without the question the intent needs. */
describe("spoken", () => {
  it("leaves a short plain reply alone", () => {
    expect(spoken("About 420 kcal and 32 g protein. Save it?")).toBe("About 420 kcal and 32 g protein. Save it?");
  });

  it("strips markdown and reads list items as sentences", () => {
    const text = "**Lunch so far:**\n- 2 eggs\n- toast with butter\n\nThat's about *420 kcal*. See [the plan](ollo://plan).";
    expect(spoken(text)).toBe("Lunch so far: 2 eggs. toast with butter. That's about 420 kcal. See the plan.");
  });

  it("cuts at a sentence boundary once it is too long", () => {
    const text = "First sentence here. Second sentence here. Third sentence here. Fourth sentence here.";
    expect(spoken(text, 45)).toBe("First sentence here. Second sentence here.");
  });

  it("never drops a closing question", () => {
    const text = "I prepared breakfast: two eggs and a slice of sourdough toast, about 310 kcal with 18 g of protein. That fits your morning target well. Save it?";
    expect(spoken(text, 60)).toBe("I prepared breakfast: two eggs and a slice of sourdough toast, about 310 kcal with 18 g of protein. Save it?");
  });

  it("keeps at least one sentence even when the first is over the limit", () => {
    const text = "This one sentence alone is already longer than the limit allows. Next.";
    expect(spoken(text, 20)).toBe("This one sentence alone is already longer than the limit allows.");
  });
});

describe("pendingProposal", () => {
  it("finds the proposal behind a preview card", () => {
    const cards = [
      { type: "meal_log", title: "Breakfast", data: { meals: [], proposalId: "p1", summary: "2 eggs, toast — 310 kcal" } },
      { type: "proposal", title: "Log breakfast", data: { proposalId: "p1", summary: "2 eggs, toast — 310 kcal" } },
    ];
    expect(pendingProposal(cards)).toEqual({ id: "p1", title: "Breakfast", summary: "2 eggs, toast — 310 kcal" });
  });

  it("is null when nothing waits for a confirmation", () => {
    expect(pendingProposal([{ type: "text", data: {} }])).toBeNull();
  });
});
