import { checkSession, type DesignAsk, type DesignBrief } from "../../src/services/workouts/design/workoutDesign.service";
import { canonicalExercise } from "../../src/services/workouts/domain/exercise.catalog";

const ex = (key: string, targetKg: number | null = null) => {
  const c = canonicalExercise(key, key);
  return { exerciseKey: c.key, name: c.name, muscleGroup: c.def?.muscleGroup ?? null, equipment: c.def?.equipment ?? null, sets: [{ targetReps: 10, targetKg, restSec: 60 }] };
};
const brief = (experience: string | null = "some") =>
  ({ training: { place: "gym", equipment: [], experience }, recent: [], lastLoads: {}, person: {}, plan: null, remembered: [], recovery: null }) as unknown as DesignBrief;
const run = (keys: string[], ask: Partial<DesignAsk> = {}, experience: string | null = "some", focus = "strength") => {
  const session: any = { title: "t", focus, place: "gym", exercises: keys.map((k) => ex(k)) };
  const out = checkSession(session, { durationMin: 10, date: "2026-11-11", ...ask }, brief(experience));
  return { session, issues: out.issues.filter((i) => !/^estimated/.test(i)), assumptions: out.assumptions };
};

describe("level: no advanced lift for someone new", () => {
  it("steps an advanced lift down its easier chain, says so, and drops the other lift's kg", () => {
    const session: any = { title: "t", focus: "strength", place: "gym", exercises: [ex("toes_to_bar"), ex("snatch", 40)] };
    const out = checkSession(session, { durationMin: 10, date: "2026-11-11" }, brief("new"));
    expect(session.exercises.map((e: any) => e.exerciseKey)).toEqual(["hanging_leg_raise", "kettlebell_swing"]);
    expect(session.exercises[1].sets[0].targetKg).toBeNull();
    expect(session.exercises[1].loadNote).toMatch(/a weight you could do 10/);
    expect(out.assumptions).toContain("Toes to bar → hanging leg raise: the simpler version while you're new to it");
  });

  it("walks past an advanced step (clean and jerk → clean → kettlebell swing)", () => {
    const { session } = run(["clean_and_jerk"], {}, "new");
    expect(session.exercises[0].exerciseKey).toBe("kettlebell_swing");
  });

  it("leaves advanced lifts alone for someone with experience", () => {
    const { session, assumptions } = run(["toes_to_bar"], {}, "experienced");
    expect(session.exercises[0].exerciseKey).toBe("toes_to_bar");
    expect(assumptions.some((a) => a.includes("simpler version"))).toBe(false);
  });
});

describe("a single muscle asked for needs an exercise that mainly works it", () => {
  it("biceps is not satisfied by triceps work", () => {
    expect(run(["tricep_pushdown", "skull_crusher"], { muscleGroups: ["biceps"] }).issues).toContain("asked for biceps, no exercise mainly works them");
    expect(run(["tricep_pushdown", "hammer_curl"], { muscleGroups: ["biceps"] }).issues).toEqual([]);
  });
});

describe("balance, where the ask names the shape", () => {
  it("full body needs a lower-body, a push and a pull exercise", () => {
    expect(run(["bench_press", "overhead_press", "lateral_raise", "plank"], { muscleGroups: ["full body"] }).issues).toContain(
      "a full-body session with no lower-body (squat, lunge or hinge), no pull exercise — add one",
    );
    expect(run(["back_squat", "bench_press", "barbell_row", "plank"], { muscleGroups: ["full body"] }).issues).toEqual([]);
  });

  it("upper body needs pushing and pulling", () => {
    expect(run(["bench_press", "overhead_press", "tricep_pushdown"], { muscleGroups: ["upper body"] }).issues).toContain("an upper-body session with pushing but no pulling — balance it");
    expect(run(["bench_press", "lat_pulldown", "overhead_press", "bicep_curl"], { muscleGroups: ["upper body"] }).issues).toEqual([]);
  });

  it("a leg day needs both the front and the back of the leg", () => {
    expect(run(["back_squat", "leg_press", "leg_extension"], { muscleGroups: ["legs"] }).issues).toEqual([
      "a lower-body session with nothing for the back of the leg (a hinge such as a deadlift or bridge, or a leg curl)",
    ]);
    expect(run(["back_squat", "romanian_deadlift", "leg_extension"], { muscleGroups: ["legs"] }).issues).toEqual([]);
    expect(run(["leg_press", "leg_curl", "calf_raise"], { muscleGroups: ["legs"] }).issues).toEqual([]);
  });

  it("circuits and mobility are not judged for balance", () => {
    expect(run(["burpee", "kettlebell_swing", "jump_rope", "plank"], { muscleGroups: ["full body"] }, "some", "conditioning").issues).toEqual([]);
  });
});
