import { checkSession, type DesignAsk, type DesignBrief } from "../../src/services/workouts/design/workoutDesign.service";
import { canonicalExercise, EXERCISES } from "../../src/services/workouts/domain/exercise.catalog";
import { EQUIPMENT } from "../../src/services/workouts/domain/workout.schema";

const ex = (key: string) => {
  const c = canonicalExercise(key, key);
  return { exerciseKey: c.key, name: c.name, muscleGroup: c.def?.muscleGroup ?? null, equipment: c.def?.equipment ?? null, sets: [{ targetReps: 10, restSec: 60 }] };
};
const ask = (over: Partial<DesignAsk> = {}): DesignAsk => ({ durationMin: 10, date: "2026-11-11", ...over });
const brief = (place: string | null, equipment: string[]) =>
  ({ training: place ? { place, equipment } : null, recent: [], lastLoads: {}, person: {}, plan: null, remembered: [], recovery: null }) as unknown as DesignBrief;
const equipmentIssues = (keys: string[], place: string | null, equipment: string[], a: Partial<DesignAsk> = {}) =>
  checkSession({ title: "t", focus: "mobility", place: place as any, exercises: keys.map(ex) } as any, ask(a), brief(place, equipment)).issues.filter((i) => i.includes("not available"));

describe("equipment: every piece an exercise needs", () => {
  it("every catalog entry needs only kit the profile can store", () => {
    for (const e of EXERCISES) for (const k of e.needs) expect(EQUIPMENT).toContain(k);
  });

  it("a dumbbell bench press at home with dumbbells and no bench misses — and names only the bench", () => {
    expect(equipmentIssues(["dumbbell_bench_press"], "home", ["dumbbell"])).toEqual(["Dumbbell bench press needs bench, not available (home: bodyweight, dumbbell)"]);
    expect(equipmentIssues(["dumbbell_bench_press"], "home", ["dumbbell", "bench"])).toEqual([]);
  });

  it("a pull-up needs a bar; a push-up needs nothing", () => {
    expect(equipmentIssues(["pull_up", "push_up"], "home", ["dumbbell"])).toEqual(["Pull-up needs pull_up_bar, not available (home: bodyweight, dumbbell)"]);
    expect(equipmentIssues(["pull_up"], "home", ["pull_up_bar"])).toEqual([]);
  });

  it("box, ab wheel and ropes are no longer waved through as \"other\"", () => {
    expect(equipmentIssues(["box_jump", "ab_wheel", "jump_rope"], "home", ["dumbbell"])).toHaveLength(3);
  });

  it("a barbell bench press missing both pieces names both", () => {
    expect(equipmentIssues(["bench_press"], "home", ["dumbbell"])).toEqual(["Bench press needs barbell and bench, not available (home: bodyweight, dumbbell)"]);
  });

  it("a gym has everything; an empty kit list is not checked; the ask's kit counts", () => {
    expect(equipmentIssues(["bench_press", "pull_up"], "gym", [])).toEqual([]);
    expect(equipmentIssues(["bench_press"], "home", [])).toEqual([]);
    expect(equipmentIssues(["dumbbell_bench_press"], "home", ["dumbbell"], { equipment: ["bench"] })).toEqual([]);
  });

  it("a custom exercise falls back to its stored equipment", () => {
    const issues = checkSession({ title: "t", focus: "mobility", place: "home", exercises: [{ exerciseKey: "custom:sled_drag", name: "Sled drag", equipment: "machine", sets: [{ targetReps: 10 }] }] } as any, ask(), brief("home", ["dumbbell"])).issues;
    expect(issues).toContain("Sled drag needs machine, not available (home: bodyweight, dumbbell)");
  });
});
