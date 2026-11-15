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

import { firstNamedDay } from "../../src/services/workouts/design/weekEdit";

describe("day 1 when no start date was passed", () => {
  const sunday = "2026-11-15";
  it("the Nov 15 request, said on a Sunday, starts Monday", () => {
    expect(firstNamedDay(["Can you create a workout plan for the week? Monday I do a GTX class… Wednesday and Thursday early morning strength, and Sunday conditioning."], sunday)).toBe("2026-11-16");
  });
  it("the first weekday named, not the earliest in the calendar", () => {
    expect(firstNamedDay(["Thursday and Saturday, and maybe Monday"], sunday)).toBe("2026-11-19");
  });
  it("today counts when it is the first day named; plurals too", () => {
    expect(firstNamedDay(["Sundays I run, Tuesdays I lift"], sunday)).toBe(sunday);
  });
  it("no weekday → null (the caller uses today); 'sat' as a verb is not Saturday", () => {
    expect(firstNamedDay(["I sat down and want three sessions this week"], sunday)).toBeNull();
  });
});
