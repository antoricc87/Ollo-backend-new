import { neighbourClashes } from "../../src/services/workouts/design/weekEdit";

// The Nov 15 2026 test week: Mon GTX (mixed), Wed upper body, Thu lower body, Sun conditioning.
const week = (wedGroups: string[]) => [
  { day: 1, session: { focus: "mixed" as const, muscleGroups: ["full_body"] } },
  { day: 3, session: { focus: "strength" as const, muscleGroups: wedGroups } },
  { day: 4, session: { focus: "strength" as const, muscleGroups: ["legs", "glutes", "core"] } },
  { day: 7, session: { focus: "conditioning" as const, muscleGroups: ["core", "cardio"] } },
];

describe("what an edit disturbed next door", () => {
  it("glutes added to Wednesday → Thursday (untouched) is the day to adjust", () => {
    expect(neighbourClashes(week(["chest", "back", "shoulders", "arms", "core", "glutes"]), [3])).toEqual([{ fix: 4, because: 3, groups: ["glutes"] }]);
  });

  it("no clash, nothing to adjust — core never counts", () => {
    expect(neighbourClashes(week(["chest", "back", "shoulders", "arms", "core"]), [3])).toEqual([]);
  });

  it("both days edited → neither is adjusted behind their back", () => {
    expect(neighbourClashes(week(["chest", "glutes"]), [3, 4])).toEqual([]);
  });

  it("a light neighbour (class, conditioning) is not a clash", () => {
    expect(neighbourClashes(week(["legs"]), [3]).map((c) => c.fix)).toEqual([4]);
    expect(neighbourClashes([{ day: 1, session: { focus: "mixed", muscleGroups: ["legs"] } }, { day: 2, session: { focus: "strength", muscleGroups: ["legs"] } }], [2])).toEqual([]);
  });
});
