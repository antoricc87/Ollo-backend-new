import { canonicalExercise, EXERCISES, exerciseByKey, musclesFor } from "../../src/services/workouts/domain/exercise.catalog";
import { DETAILS, LEVELS } from "../../src/services/workouts/domain/exercise.details";

const key = (name: string) => canonicalExercise(name).key;

describe("exercise catalog", () => {
  it("has unique keys and no alias shared by two exercises", () => {
    const keys = EXERCISES.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
    const seen = new Map<string, string>();
    for (const e of EXERCISES) {
      for (const a of [e.name, ...e.aliases].map((x) => x.toLowerCase())) {
        const other = seen.get(a);
        if (other && other !== e.key) throw new Error(`"${a}" is on both ${other} and ${e.key}`);
        seen.set(a, e.key);
      }
    }
  });

  // Variants that used to be folded into one entry — with different equipment or difficulty — now keep their own history.
  it.each([
    ["glute bridge", "glute_bridge"],
    ["single leg glute bridge", "glute_bridge"],
    ["barbell hip thrust", "hip_thrust"],
    ["cable fly", "cable_fly"],
    ["cable crossover", "cable_fly"],
    ["pec deck", "machine_fly"],
    ["reverse pec deck", "rear_delt_fly"],
    ["dumbbell fly", "chest_fly"],
    ["barbell curl", "barbell_curl"],
    ["ez bar curl", "barbell_curl"],
    ["dumbbell curl", "bicep_curl"],
    ["chin ups", "chin_up"],
    ["pull ups", "pull_up"],
    ["side plank", "side_plank"],
    ["plank", "plank"],
    ["sit ups", "sit_up"],
    ["cable crunch", "cable_crunch"],
    ["crunches", "crunch"],
    ["split squat", "split_squat"],
    ["bulgarian split squat", "bulgarian_split_squat"],
    ["seated calf raise", "seated_calf_raise"],
    ["calf raises", "calf_raise"],
    ["toes to bar", "toes_to_bar"],
    ["hanging knee raise", "hanging_knee_raise"],
    ["hanging leg raise", "hanging_leg_raise"],
    ["clean and jerk", "clean_and_jerk"],
    ["power clean", "clean"],
    ["tricep dips", "bench_dip"],
    ["dips", "dip"],
  ])("%s → %s", (name, expected) => expect(key(name)).toBe(expected));

  it("no longer sends ambiguous words to one machine or lift", () => {
    expect(key("row machine")).not.toBe("seated_row");
    expect(key("press")).not.toBe("overhead_press");
  });

  it("still resolves the everyday names", () => {
    expect(key("bench")).toBe("bench_press");
    expect(key("shoulder press")).toBe("overhead_press");
    expect(key("seated cable row")).toBe("seated_row");
    expect(key("squats")).toBe("back_squat");
    expect(key("curls")).toBe("bicep_curl");
  });

  describe("details: pattern, level, muscles, easier/harder", () => {
    it("every exercise has a details row, and every row an exercise", () => {
      for (const e of EXERCISES) expect(DETAILS[e.key]).toBeDefined();
      for (const k of Object.keys(DETAILS)) expect(exerciseByKey(k)).not.toBeNull();
    });

    it("every exercise mainly works at least one muscle, never the same one as primary and secondary", () => {
      for (const e of EXERCISES) {
        expect(e.primary.length).toBeGreaterThan(0);
        for (const m of e.secondary) expect(e.primary).not.toContain(m);
      }
    });

    it("easier links point down (or level), harder links up, and no easier chain loops", () => {
      const rank = (k: string) => LEVELS.indexOf(exerciseByKey(k)!.level);
      for (const e of EXERCISES) {
        if (e.easier) {
          expect(exerciseByKey(e.easier)).not.toBeNull();
          expect(rank(e.easier)).toBeLessThanOrEqual(rank(e.key));
        }
        if (e.harder) {
          expect(exerciseByKey(e.harder)).not.toBeNull();
          expect(rank(e.harder)).toBeGreaterThanOrEqual(rank(e.key));
        }
        const seen = new Set([e.key]);
        for (let k = e.easier; k; k = exerciseByKey(k)!.easier) {
          if (seen.has(k)) throw new Error(`easier chain loops at ${k}`);
          seen.add(k);
        }
      }
    });

    it("single-muscle words are finer than groups", () => {
      expect(musclesFor("biceps")).toEqual(["biceps"]);
      expect(musclesFor("Hamstrings")).toEqual(["hamstrings"]);
      expect(musclesFor("arms")).toEqual([]);
      expect(exerciseByKey("tricep_pushdown")!.primary).not.toContain("biceps");
    });
  });
});

describe("categories: strength, core, cardio, mobility", () => {
  const cat = (k: string) => exerciseByKey(k)!.category;
  it("every exercise has one of the four", () => {
    for (const e of EXERCISES) expect(["strength", "core", "cardio", "mobility"]).toContain(e.category);
  });
  it("power and carries are strength; intervals and jumps are cardio", () => {
    expect([cat("clean"), cat("kettlebell_swing"), cat("farmers_walk"), cat("thruster")]).toEqual(["strength", "strength", "strength", "strength"]);
    expect([cat("burpee"), cat("battle_rope"), cat("box_jump"), cat("rowing_machine")]).toEqual(["cardio", "cardio", "cardio", "cardio"]);
    expect([cat("dead_bug"), cat("side_plank"), cat("cable_crunch")]).toEqual(["core", "core", "core"]);
  });
  it("mobility: moving drills for a warm-up, held stretches for a cool-down", () => {
    const mob = EXERCISES.filter((e) => e.category === "mobility");
    expect(mob.length).toBeGreaterThanOrEqual(20);
    for (const e of mob) expect(["mobility", "stretch"]).toContain(e.pattern);
    expect(exerciseByKey("leg_swing")!.pattern).toBe("mobility");
    expect(exerciseByKey("hamstring_stretch")!.pattern).toBe("stretch");
  });
  it.each([
    ["leg swings", "leg_swing"],
    ["couch stretch", "hip_flexor_stretch"],
    ["seated butterfly stretch", "butterfly_stretch"],
    ["open book", "thoracic_rotation"],
    ["cat cow", "cat_cow"],
    ["pigeon pose", "pigeon_stretch"],
    ["doorway chest stretch", "chest_stretch"],
    ["band pull aparts", "band_pull_apart"],
    // the old names still land where they did
    ["kettlebell swings", "kettlebell_swing"],
    ["butterfly", "machine_fly"],
    ["calf raises", "calf_raise"],
    ["hamstring curl", "leg_curl"],
  ])("%s → %s", (name, expected) => expect(key(name)).toBe(expected));
});

describe("exercise facts on the way out", () => {
  it("adds category and main muscles to every catalog exercise, deep, and leaves the rest alone", () => {
    const { withExerciseFacts } = require("../../src/services/workouts/domain/exercise.catalog");
    const at = new Date("2026-11-18T06:30:00Z");
    const out = withExerciseFacts({ daysOut: [{ planned: { startedAt: at, warmupItems: [{ exerciseKey: "leg_swing" }], exercises: [{ exerciseKey: "back_squat", sets: [] }, { exerciseKey: "custom:gtx" }] } }] });
    const s = out.daysOut[0].planned;
    expect(s.startedAt).toBe(at);
    expect(s.warmupItems[0]).toMatchObject({ category: "mobility", primary: ["hamstrings", "hip_flexors"] });
    expect(s.exercises[0]).toMatchObject({ category: "strength", primary: ["quads", "glutes"] });
    expect(s.exercises[1].category).toBeUndefined();
  });
});
