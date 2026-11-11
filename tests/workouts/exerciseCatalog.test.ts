import { canonicalExercise, EXERCISES } from "../../src/services/workouts/domain/exercise.catalog";

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
});
