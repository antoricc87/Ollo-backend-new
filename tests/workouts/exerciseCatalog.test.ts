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
