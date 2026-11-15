/**
 * What each catalog exercise IS, beyond its name and kit — the facts code needs
 * to judge a designed session instead of trusting the model's choice:
 *
 * - pattern: the kind of movement, whatever the equipment (a push-up and a bench
 *   press are both a horizontal push). Balance checks read it.
 * - level: skill and practice it takes. Someone new never gets an advanced lift.
 * - primary / secondary: the muscles it mainly works, and the ones it works too.
 *   Finer than `muscleGroup` ("legs" is quads AND hamstrings; "arms" is biceps
 *   AND triceps), so "biceps" is no longer satisfied by a triceps pushdown.
 * - easier / harder: the next step down / up on the same job. Stepping down is
 *   how a session gets simpler in code, without a redesign.
 *
 * Every key in EXERCISES has a row (tests/workouts/exerciseCatalog.test.ts).
 * Only defensible links for easier/harder — leave them out rather than guess.
 */

export const PATTERNS = [
  "squat",
  "hinge",
  "lunge",
  "push_horizontal",
  "push_vertical",
  "pull_horizontal",
  "pull_vertical",
  "isolation", // one joint: curls, raises, extensions, calf raises
  "core",
  "carry",
  "olympic", // clean, snatch, jerk
  "conditioning",
  "cardio",
] as const;
export type Pattern = (typeof PATTERNS)[number];

export const LEVELS = ["beginner", "intermediate", "advanced"] as const;
export type Level = (typeof LEVELS)[number];

export const MUSCLES = [
  "quads", "hamstrings", "glutes", "calves", "adductors", "hip_flexors",
  "chest", "lats", "upper_back", "lower_back", "traps",
  "front_delts", "side_delts", "rear_delts",
  "biceps", "triceps", "forearms",
  "abs", "obliques",
] as const;
export type Muscle = (typeof MUSCLES)[number];

export type ExerciseDetails = { pattern: Pattern; level: Level; primary: Muscle[]; secondary: Muscle[]; easier?: string; harder?: string };

const D = (pattern: Pattern, level: Level, primary: Muscle[], secondary: Muscle[] = [], links: { easier?: string; harder?: string } = {}): ExerciseDetails => ({ pattern, level, primary, secondary, ...links });

export const DETAILS: Record<string, ExerciseDetails> = {
  // chest
  bench_press: D("push_horizontal", "intermediate", ["chest"], ["triceps", "front_delts"], { easier: "dumbbell_bench_press" }),
  incline_bench_press: D("push_horizontal", "intermediate", ["chest", "front_delts"], ["triceps"], { easier: "incline_dumbbell_press" }),
  dumbbell_bench_press: D("push_horizontal", "beginner", ["chest"], ["triceps", "front_delts"], { easier: "chest_press_machine", harder: "bench_press" }),
  incline_dumbbell_press: D("push_horizontal", "beginner", ["chest", "front_delts"], ["triceps"], { harder: "incline_bench_press" }),
  chest_fly: D("push_horizontal", "beginner", ["chest"], ["front_delts"]),
  cable_fly: D("push_horizontal", "beginner", ["chest"], ["front_delts"]),
  machine_fly: D("push_horizontal", "beginner", ["chest"], ["front_delts"]),
  push_up: D("push_horizontal", "beginner", ["chest"], ["triceps", "front_delts", "abs"]),
  dip: D("push_vertical", "intermediate", ["chest", "triceps"], ["front_delts"], { easier: "bench_dip" }),
  bench_dip: D("isolation", "beginner", ["triceps"], ["chest", "front_delts"], { harder: "dip" }),
  chest_press_machine: D("push_horizontal", "beginner", ["chest"], ["triceps", "front_delts"], { harder: "dumbbell_bench_press" }),
  // back
  deadlift: D("hinge", "intermediate", ["hamstrings", "glutes", "lower_back"], ["upper_back", "traps", "forearms", "quads"]),
  romanian_deadlift: D("hinge", "intermediate", ["hamstrings", "glutes"], ["lower_back", "forearms"], { easier: "back_extension" }),
  pull_up: D("pull_vertical", "intermediate", ["lats"], ["biceps", "upper_back", "rear_delts"], { easier: "chin_up" }),
  chin_up: D("pull_vertical", "intermediate", ["lats", "biceps"], ["upper_back"], { easier: "lat_pulldown", harder: "pull_up" }),
  lat_pulldown: D("pull_vertical", "beginner", ["lats"], ["biceps", "upper_back"], { harder: "chin_up" }),
  barbell_row: D("pull_horizontal", "intermediate", ["upper_back", "lats"], ["biceps", "rear_delts", "lower_back"], { easier: "dumbbell_row" }),
  dumbbell_row: D("pull_horizontal", "beginner", ["lats", "upper_back"], ["biceps", "rear_delts"], { easier: "seated_row", harder: "barbell_row" }),
  seated_row: D("pull_horizontal", "beginner", ["upper_back", "lats"], ["biceps", "rear_delts"], { harder: "dumbbell_row" }),
  t_bar_row: D("pull_horizontal", "intermediate", ["upper_back", "lats"], ["biceps", "lower_back"], { easier: "seated_row" }),
  face_pull: D("pull_horizontal", "beginner", ["rear_delts", "upper_back"], ["traps"]),
  back_extension: D("hinge", "beginner", ["lower_back", "glutes"], ["hamstrings"], { harder: "romanian_deadlift" }),
  // shoulders
  overhead_press: D("push_vertical", "intermediate", ["front_delts", "side_delts"], ["triceps", "upper_back"], { easier: "dumbbell_shoulder_press" }),
  dumbbell_shoulder_press: D("push_vertical", "beginner", ["front_delts", "side_delts"], ["triceps"], { harder: "overhead_press" }),
  lateral_raise: D("isolation", "beginner", ["side_delts"], ["traps"]),
  front_raise: D("isolation", "beginner", ["front_delts"]),
  rear_delt_fly: D("pull_horizontal", "beginner", ["rear_delts"], ["upper_back"]),
  upright_row: D("isolation", "intermediate", ["side_delts", "traps"], ["biceps"]),
  shrug: D("isolation", "beginner", ["traps"], ["forearms"]),
  // arms
  bicep_curl: D("isolation", "beginner", ["biceps"], ["forearms"]),
  barbell_curl: D("isolation", "beginner", ["biceps"], ["forearms"]),
  hammer_curl: D("isolation", "beginner", ["biceps", "forearms"]),
  preacher_curl: D("isolation", "beginner", ["biceps"]),
  tricep_pushdown: D("isolation", "beginner", ["triceps"]),
  skull_crusher: D("isolation", "intermediate", ["triceps"]),
  overhead_tricep_extension: D("isolation", "beginner", ["triceps"]),
  close_grip_bench_press: D("push_horizontal", "intermediate", ["triceps", "chest"], ["front_delts"]),
  // legs / glutes
  back_squat: D("squat", "intermediate", ["quads", "glutes"], ["adductors", "hamstrings", "lower_back"], { easier: "goblet_squat", harder: "front_squat" }),
  front_squat: D("squat", "intermediate", ["quads", "glutes"], ["upper_back", "abs"], { easier: "goblet_squat" }),
  goblet_squat: D("squat", "beginner", ["quads", "glutes"], ["adductors", "abs"], { harder: "back_squat" }),
  leg_press: D("squat", "beginner", ["quads", "glutes"], ["adductors", "hamstrings"]),
  hack_squat: D("squat", "beginner", ["quads"], ["glutes"]),
  lunge: D("lunge", "beginner", ["quads", "glutes"], ["adductors", "hamstrings"], { easier: "split_squat" }),
  bulgarian_split_squat: D("lunge", "intermediate", ["quads", "glutes"], ["adductors"], { easier: "split_squat" }),
  split_squat: D("lunge", "beginner", ["quads", "glutes"], ["adductors"], { harder: "bulgarian_split_squat" }),
  leg_extension: D("isolation", "beginner", ["quads"]),
  leg_curl: D("isolation", "beginner", ["hamstrings"], ["calves"]),
  hip_thrust: D("hinge", "intermediate", ["glutes"], ["hamstrings"], { easier: "glute_bridge" }),
  glute_bridge: D("hinge", "beginner", ["glutes"], ["hamstrings"], { harder: "hip_thrust" }),
  calf_raise: D("isolation", "beginner", ["calves"]),
  seated_calf_raise: D("isolation", "beginner", ["calves"]),
  hip_abduction: D("isolation", "beginner", ["glutes"]),
  hip_adduction: D("isolation", "beginner", ["adductors"]),
  step_up: D("lunge", "beginner", ["quads", "glutes"], ["hamstrings", "calves"]),
  // core
  plank: D("core", "beginner", ["abs"], ["obliques", "front_delts"]),
  side_plank: D("core", "beginner", ["obliques"], ["abs", "glutes"]),
  crunch: D("core", "beginner", ["abs"]),
  sit_up: D("core", "beginner", ["abs"], ["hip_flexors"]),
  cable_crunch: D("core", "beginner", ["abs"], ["obliques"]),
  hanging_leg_raise: D("core", "intermediate", ["abs", "hip_flexors"], ["forearms", "lats"], { easier: "hanging_knee_raise", harder: "toes_to_bar" }),
  hanging_knee_raise: D("core", "beginner", ["abs", "hip_flexors"], ["forearms"], { harder: "hanging_leg_raise" }),
  toes_to_bar: D("core", "advanced", ["abs", "hip_flexors"], ["lats", "forearms"], { easier: "hanging_leg_raise" }),
  ab_wheel: D("core", "intermediate", ["abs"], ["lats", "obliques"], { easier: "plank" }),
  russian_twist: D("core", "beginner", ["obliques"], ["abs", "hip_flexors"]),
  dead_bug: D("core", "beginner", ["abs"], ["hip_flexors"]),
  // full body / conditioning
  kettlebell_swing: D("hinge", "intermediate", ["glutes", "hamstrings"], ["lower_back", "front_delts", "forearms"]),
  clean: D("olympic", "advanced", ["glutes", "hamstrings", "quads", "traps"], ["upper_back", "front_delts", "forearms"], { easier: "kettlebell_swing" }),
  clean_and_jerk: D("olympic", "advanced", ["glutes", "quads", "front_delts", "traps"], ["hamstrings", "triceps", "upper_back"], { easier: "clean" }),
  snatch: D("olympic", "advanced", ["glutes", "hamstrings", "quads", "traps"], ["side_delts", "upper_back"], { easier: "kettlebell_swing" }),
  thruster: D("squat", "intermediate", ["quads", "glutes", "front_delts"], ["triceps", "abs"]),
  burpee: D("conditioning", "beginner", ["quads", "chest"], ["triceps", "abs", "hip_flexors"]),
  box_jump: D("conditioning", "intermediate", ["quads", "glutes", "calves"], ["hamstrings"], { easier: "step_up" }),
  farmers_walk: D("carry", "beginner", ["forearms", "traps"], ["abs", "obliques", "glutes"]),
  battle_rope: D("conditioning", "beginner", ["front_delts", "side_delts"], ["abs", "forearms"]),
  jump_rope: D("cardio", "beginner", ["calves"], ["quads"]),
  rowing_machine: D("cardio", "beginner", ["lats", "quads"], ["upper_back", "glutes", "hamstrings", "biceps"]),
  assault_bike: D("cardio", "beginner", ["quads"], ["glutes", "hamstrings", "front_delts"]),
  treadmill_run: D("cardio", "beginner", ["quads", "calves"], ["hamstrings", "glutes"]),
  stair_climber: D("cardio", "beginner", ["quads", "glutes"], ["calves"]),
};

/**
 * Exercises that are only ever SUPPORTING work, whatever the day's focus: one-joint moves (pattern
 * "isolation") plus these, whose pattern is a push or pull but which nobody trains heavy for low reps
 * (a face pull at 5 reps was designed on Nov 15 2026). A check holds them to 8+ reps.
 */
export const SUPPORTING_ONLY = new Set(["chest_fly", "cable_fly", "machine_fly", "face_pull", "rear_delt_fly"]);
