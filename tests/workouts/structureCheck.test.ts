import { checkSession, type DesignAsk, type DesignBrief } from "../../src/services/workouts/design/workoutDesign.service";
import { canonicalExercise } from "../../src/services/workouts/domain/exercise.catalog";

// The few things no trainer would do (Nov 15 2026) — everything else about structure is the designer's call.
const brief = { training: { place: "gym", equipment: [], experience: "some" }, recent: [], lastLoads: {}, person: {}, plan: null, remembered: [], recovery: null } as unknown as DesignBrief;
const ask: DesignAsk = { durationMin: 10, date: "2026-11-18" };
const ex = (key: string, opts: { sets?: number; reps?: number | null; sec?: number | null; role?: string } = {}) => {
  const c = canonicalExercise(key, key);
  return {
    exerciseKey: c.key,
    name: c.name,
    muscleGroup: c.def?.muscleGroup ?? null,
    role: opts.role ?? null,
    sets: Array.from({ length: opts.sets ?? 3 }, () => ({ targetReps: opts.sec ? null : (opts.reps ?? 10), durationSec: opts.sec ?? null, restSec: 60 })),
  };
};
const issues = (exercises: any[], extra: any = {}) =>
  checkSession({ title: "t", focus: "strength", place: "gym", warmup: ["easy bike"], cooldown: ["stretch"], exercises, ...extra } as any, ask, brief).issues.filter((i) => !/^estimated/.test(i));

describe("structure safety nets", () => {
  it("a well-built session passes", () => {
    expect(issues([ex("bench_press", { reps: 5, role: "main" }), ex("face_pull", { reps: 15, role: "accessory" }), ex("plank", { sec: 30, role: "core" })])).toEqual([]);
  });

  it("asks for a warm-up and a cool-down", () => {
    expect(issues([ex("back_squat", { reps: 5 })], { warmup: [], cooldown: [" "] })).toEqual(["no warm-up — add one for today's work", "no cool-down — add easy movement and stretches for what was trained"]);
  });

  it("never one working set — except one long steady effort", () => {
    expect(issues([ex("tricep_pushdown", { sets: 1 })])).toEqual(["Tricep pushdown has a single working set — give it at least 2, or drop it"]);
    expect(issues([ex("treadmill_run", { sets: 1, sec: 1200 })])).toEqual([]);
  });

  it("supporting exercises are not dosed like a main lift (the Nov 15 test week)", () => {
    expect(issues([ex("face_pull", { reps: 5 })])).toEqual(["Face pull at 5 reps — a supporting exercise works at 8–15 reps"]);
    expect(issues([ex("leg_curl", { reps: 4 })])).toEqual(["Leg curl at 4 reps — a supporting exercise works at 8–15 reps"]);
    expect(issues([ex("hip_thrust", { reps: 6, role: "accessory" })])).toEqual(["Hip thrust at 6 reps — a supporting exercise works at 8–15 reps"]);
  });

  it("a curl may be the main lift of an arm day; a face pull never trains heavy", () => {
    expect(issues([ex("barbell_curl", { reps: 6, role: "main" })])).toEqual([]);
    expect(issues([ex("face_pull", { reps: 5, role: "main" })])).toEqual(["Face pull at 5 reps — a supporting exercise works at 8–15 reps"]);
  });

  it("main compound lifts keep strength reps", () => {
    expect(issues([ex("back_squat", { reps: 4, role: "main" }), ex("romanian_deadlift", { reps: 6 })])).toEqual([]);
  });
});

describe("time: what the sets really take", () => {
  // The Nov 15 2026 Wednesday: 6 exercises × 3 sets, labelled 30 min after an edit, every set kept.
  const wednesday = [
    ex("back_squat", { reps: 4, role: "main" }),
    ex("romanian_deadlift", { reps: 5, role: "main" }),
    ex("hip_thrust", { reps: 8, role: "accessory" }),
    ex("leg_curl", { reps: 10, role: "accessory" }),
    ex("hip_abduction", { reps: 12, role: "accessory" }),
    ex("calf_raise", { reps: 10, role: "accessory" }),
  ].map((e, i) => ({ ...e, sets: e.sets.map((s) => ({ ...s, restSec: [150, 120, 75, 60, 60, 60][i] })) }));
  const est = (minutes: number) => checkSession({ title: "t", focus: "strength", place: "gym", warmup: ["w"], cooldown: ["c"], exercises: wednesday.map((e) => ({ ...e, sets: e.sets.map((s) => ({ ...s })) })) } as any, { durationMin: minutes, date: "2026-11-18" }, brief).issues.filter((i) => /^estimated/.test(i));

  it("fits a 45-minute slot", () => expect(est(45)).toEqual([]));
  it("is not a 30-minute session", () => expect(est(30)[0]).toMatch(/^estimated 4\d min of work vs 30 min asked — cut/));
});
