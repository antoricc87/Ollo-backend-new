/**
 * Canonical strength exercises. The parser must resolve what the user said to
 * one of these keys (or "custom:<slug>") so per-exercise history is stable —
 * "bench", "flat bench" and "barbell bench press" all land on `bench_press`.
 * Extend the alias lists when the parser invents new spellings.
 */
export type ExerciseDef = {
  key: string;
  name: string;
  muscleGroup: "chest" | "back" | "shoulders" | "arms" | "legs" | "glutes" | "core" | "full_body" | "cardio";
  equipment: "barbell" | "dumbbell" | "machine" | "cable" | "bodyweight" | "kettlebell" | "band" | "other";
  aliases: string[];
};

const E = (key: string, name: string, muscleGroup: ExerciseDef["muscleGroup"], equipment: ExerciseDef["equipment"], aliases: string[] = []): ExerciseDef => ({ key, name, muscleGroup, equipment, aliases });

export const EXERCISES: ExerciseDef[] = [
  // chest
  E("bench_press", "Bench press", "chest", "barbell", ["bench", "flat bench", "barbell bench", "bb bench", "panca", "panca piana"]),
  E("incline_bench_press", "Incline bench press", "chest", "barbell", ["incline bench", "incline barbell", "panca inclinata"]),
  E("dumbbell_bench_press", "Dumbbell bench press", "chest", "dumbbell", ["db bench", "dumbbell press", "flat dumbbell press"]),
  E("incline_dumbbell_press", "Incline dumbbell press", "chest", "dumbbell", ["incline db", "incline dumbbell", "incline db press"]),
  E("chest_fly", "Chest fly", "chest", "dumbbell", ["flyes", "flys", "fly", "pec fly", "pec deck", "cable fly", "croci"]),
  E("push_up", "Push-up", "chest", "bodyweight", ["pushups", "push ups", "press ups", "piegamenti"]),
  E("dip", "Dips", "chest", "bodyweight", ["dips", "chest dips", "tricep dips", "parallel bars"]),
  E("chest_press_machine", "Chest press (machine)", "chest", "machine", ["chest press", "machine press"]),
  // back
  E("deadlift", "Deadlift", "back", "barbell", ["deadlifts", "conventional deadlift", "stacco", "stacco da terra"]),
  E("romanian_deadlift", "Romanian deadlift", "legs", "barbell", ["rdl", "rdls", "stiff leg deadlift", "romanian", "stacco rumeno"]),
  E("pull_up", "Pull-up", "back", "bodyweight", ["pullups", "pull ups", "chin up", "chin ups", "chinups", "trazioni"]),
  E("lat_pulldown", "Lat pulldown", "back", "cable", ["pulldown", "pulldowns", "lat pull", "lat machine"]),
  E("barbell_row", "Barbell row", "back", "barbell", ["bent over row", "bent-over row", "bb row", "pendlay row", "rematore"]),
  E("dumbbell_row", "Dumbbell row", "back", "dumbbell", ["db row", "one arm row", "single arm row", "rematore manubrio"]),
  E("seated_row", "Seated cable row", "back", "cable", ["cable row", "seated row", "low row", "row machine"]),
  E("t_bar_row", "T-bar row", "back", "barbell", ["t bar", "tbar row"]),
  E("face_pull", "Face pull", "shoulders", "cable", ["face pulls"]),
  E("back_extension", "Back extension", "back", "bodyweight", ["hyperextension", "hyperextensions", "45 degree back extension"]),
  // shoulders
  E("overhead_press", "Overhead press", "shoulders", "barbell", ["ohp", "military press", "shoulder press", "press", "strict press", "barbell press", "lento avanti"]),
  E("dumbbell_shoulder_press", "Dumbbell shoulder press", "shoulders", "dumbbell", ["db shoulder press", "db press", "seated dumbbell press", "arnold press"]),
  E("lateral_raise", "Lateral raise", "shoulders", "dumbbell", ["lateral raises", "side raises", "side laterals", "laterals", "alzate laterali"]),
  E("front_raise", "Front raise", "shoulders", "dumbbell", ["front raises"]),
  E("rear_delt_fly", "Rear delt fly", "shoulders", "dumbbell", ["reverse fly", "rear delts", "reverse pec deck", "rear delt raise"]),
  E("upright_row", "Upright row", "shoulders", "barbell", ["upright rows"]),
  E("shrug", "Shrug", "shoulders", "dumbbell", ["shrugs", "barbell shrug", "trap shrugs"]),
  // arms
  E("bicep_curl", "Bicep curl", "arms", "dumbbell", ["curls", "curl", "dumbbell curl", "db curl", "barbell curl", "ez bar curl", "bicep curls", "biceps"]),
  E("hammer_curl", "Hammer curl", "arms", "dumbbell", ["hammer curls", "hammers"]),
  E("preacher_curl", "Preacher curl", "arms", "barbell", ["preacher curls", "scott curl"]),
  E("tricep_pushdown", "Tricep pushdown", "arms", "cable", ["pushdown", "pushdowns", "rope pushdown", "tricep extension cable", "cable pushdown"]),
  E("skull_crusher", "Skull crusher", "arms", "barbell", ["skull crushers", "skullcrushers", "lying tricep extension", "french press"]),
  E("overhead_tricep_extension", "Overhead tricep extension", "arms", "dumbbell", ["overhead extension", "overhead tricep", "tricep extension"]),
  E("close_grip_bench_press", "Close-grip bench press", "arms", "barbell", ["close grip bench", "cgbp"]),
  // legs / glutes
  E("back_squat", "Back squat", "legs", "barbell", ["squat", "squats", "barbell squat", "high bar squat", "low bar squat"]),
  E("front_squat", "Front squat", "legs", "barbell", ["front squats"]),
  E("goblet_squat", "Goblet squat", "legs", "dumbbell", ["goblet squats", "goblet"]),
  E("leg_press", "Leg press", "legs", "machine", ["leg presses", "pressa"]),
  E("hack_squat", "Hack squat", "legs", "machine", ["hack squats", "hack"]),
  E("lunge", "Lunge", "legs", "dumbbell", ["lunges", "walking lunges", "reverse lunges", "affondi"]),
  E("bulgarian_split_squat", "Bulgarian split squat", "legs", "dumbbell", ["split squat", "split squats", "bulgarians", "bulgarian"]),
  E("leg_extension", "Leg extension", "legs", "machine", ["leg extensions", "quad extension"]),
  E("leg_curl", "Leg curl", "legs", "machine", ["leg curls", "hamstring curl", "hamstring curls", "lying leg curl", "seated leg curl"]),
  E("hip_thrust", "Hip thrust", "glutes", "barbell", ["hip thrusts", "glute bridge", "glute bridges", "barbell hip thrust"]),
  E("calf_raise", "Calf raise", "legs", "machine", ["calf raises", "calves", "standing calf raise", "seated calf raise", "polpacci"]),
  E("hip_abduction", "Hip abduction", "glutes", "machine", ["abduction", "abductor", "abductors"]),
  E("hip_adduction", "Hip adduction", "legs", "machine", ["adduction", "adductor", "adductors"]),
  E("step_up", "Step-up", "legs", "dumbbell", ["step ups", "stepups"]),
  // core
  E("plank", "Plank", "core", "bodyweight", ["planks", "front plank", "side plank"]),
  E("crunch", "Crunch", "core", "bodyweight", ["crunches", "sit up", "sit ups", "situps", "cable crunch"]),
  E("hanging_leg_raise", "Hanging leg raise", "core", "bodyweight", ["leg raises", "leg raise", "hanging knee raise", "knee raises", "toes to bar"]),
  E("ab_wheel", "Ab wheel rollout", "core", "other", ["ab rollout", "ab wheel", "rollouts"]),
  E("russian_twist", "Russian twist", "core", "bodyweight", ["russian twists", "twists"]),
  E("dead_bug", "Dead bug", "core", "bodyweight", ["dead bugs"]),
  // full body / conditioning
  E("kettlebell_swing", "Kettlebell swing", "full_body", "kettlebell", ["kb swing", "kb swings", "swings", "kettlebell swings"]),
  E("clean", "Clean", "full_body", "barbell", ["power clean", "hang clean", "cleans", "clean and jerk"]),
  E("snatch", "Snatch", "full_body", "barbell", ["power snatch", "hang snatch", "snatches"]),
  E("thruster", "Thruster", "full_body", "barbell", ["thrusters"]),
  E("burpee", "Burpee", "full_body", "bodyweight", ["burpees"]),
  E("box_jump", "Box jump", "legs", "other", ["box jumps"]),
  E("farmers_walk", "Farmer's walk", "full_body", "dumbbell", ["farmers carry", "farmer carry", "farmers walk", "loaded carry"]),
  E("battle_rope", "Battle ropes", "cardio", "other", ["battle ropes", "ropes"]),
  E("jump_rope", "Jump rope", "cardio", "other", ["skipping", "skip rope", "jumping rope", "double unders"]),
  E("rowing_machine", "Rowing machine", "cardio", "machine", ["erg", "rower", "row erg", "concept2"]),
  E("assault_bike", "Assault bike", "cardio", "machine", ["air bike", "echo bike", "airdyne"]),
  E("treadmill_run", "Treadmill", "cardio", "machine", ["treadmill", "tapis roulant"]),
  E("stair_climber", "Stair climber", "cardio", "machine", ["stairmaster", "stairs machine"]),
];

export const EXERCISE_KEYS = EXERCISES.map((e) => e.key);
const byKey = new Map(EXERCISES.map((e) => [e.key, e]));

const norm = (s: string) => s.toLowerCase().replace(/[-_]/g, " ").replace(/[^a-z0-9à-ú ]+/g, " ").replace(/\s+/g, " ").trim();
const aliasIndex = new Map<string, string>();
for (const e of EXERCISES) {
  aliasIndex.set(norm(e.name), e.key);
  aliasIndex.set(norm(e.key), e.key);
  for (const a of e.aliases) aliasIndex.set(norm(a), e.key);
}

export const exerciseByKey = (key: string | null | undefined) => (key ? byKey.get(key) ?? null : null);

export const slug = (s: string) => norm(s).replace(/ /g, "_").slice(0, 48) || "exercise";

/**
 * Resolve a name (from the user or the parser) to a catalog key. Exact alias
 * hit first, then "every word of the alias appears in the name", else custom.
 */
export const canonicalExercise = (name: string, hintKey?: string | null): { key: string; name: string; def: ExerciseDef | null } => {
  if (hintKey && byKey.has(hintKey)) return { key: hintKey, name: byKey.get(hintKey)!.name, def: byKey.get(hintKey)! };
  const n = norm(name);
  const exact = aliasIndex.get(n);
  if (exact) return { key: exact, name: byKey.get(exact)!.name, def: byKey.get(exact)! };
  let best: { key: string; score: number } | null = null;
  for (const [alias, key] of aliasIndex) {
    const words = alias.split(" ");
    if (words.length && words.every((w) => n.includes(w))) {
      const score = alias.length;
      if (!best || score > best.score) best = { key, score };
    }
  }
  if (best) return { key: best.key, name: byKey.get(best.key)!.name, def: byKey.get(best.key)! };
  const display = name.trim().charAt(0).toUpperCase() + name.trim().slice(1);
  return { key: `custom:${slug(name)}`, name: display, def: null };
};

/** Compact catalog listing for the parser prompt: "key — name (aliases…)". */
export const catalogForPrompt = () => EXERCISES.map((e) => `${e.key}: ${e.name}${e.aliases.length ? ` (${e.aliases.slice(0, 4).join(", ")})` : ""}`).join("\n");
