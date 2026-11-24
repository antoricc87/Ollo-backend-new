import { lengthWishMet, plainIssues } from "../../src/services/workouts/design/fitWords";

/* Nov 22 2026, his week card: "Still off: not yet in the week: Keep each session to 60 minutes.; day 7: asked for legs, no exercise targets it". */
describe("plainIssues", () => {
  it("turns the designer's checks into sentences, one per line", () => {
    expect(plainIssues(["not yet in the week: Keep each session to 60 minutes.", "day 7: asked for legs, no exercise targets it"], "2026-11-23")).toEqual([
      'Not in the week yet: "Keep each session to 60 minutes"',
      "Sun 29: you asked for legs, but no exercise works them",
    ]);
  });
  it("drops the designer's instruction and names days", () => {
    expect(plainIssues(["day 2: estimated 38 min of work vs 45 min asked — add a set or an exercise", "day 1 and day 2 both load chest on consecutive days"], "2026-11-23")).toEqual([
      "Tue 24: about 38 minutes of work for a 45-minute session",
      "Mon 23 and Tue 24 both work chest, back to back",
    ]);
  });
  it("caps at three lines", () => expect(plainIssues(["a", "b", "c", "d"])).toHaveLength(3));
});

describe("lengthWishMet", () => {
  it("met when every session is at the length", () => expect(lengthWishMet("Keep each session to 60 minutes.", [60, 60, 60, 60])).toBe(true));
  it("not met when one runs long", () => expect(lengthWishMet("Keep each session to 60 minutes.", [60, 90])).toBe(false));
  it("not a length wish", () => expect(lengthWishMet("Include a leg exercise", [60])).toBeNull());
});
