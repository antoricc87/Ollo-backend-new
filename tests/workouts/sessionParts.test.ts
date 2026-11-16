import { checkSession, estimateMinutes, partLine, type DesignAsk, type DesignBrief } from "../../src/services/workouts/design/workoutDesign.service";
import { keepUntouched } from "../../src/services/workouts/design/sessionEdit";

// Three parts (Nov 16 2026 ruling): warm-up → main workout → cool-down; warm-up and cool-down are catalog exercises.
const brief = { training: { place: "home", equipment: ["dumbbell"], experience: "some" }, recent: [], lastLoads: {}, person: {}, plan: null, remembered: [], recovery: null } as unknown as DesignBrief;
const ask: DesignAsk = { durationMin: 30, date: "2026-11-18" };
const squat = { exerciseKey: "goblet_squat", name: "Goblet squat", muscleGroup: "legs", sets: [1, 2, 3].map(() => ({ targetReps: 10, restSec: 60 })) };
const swings = { exerciseKey: "leg_swing", name: "Leg swings", reps: 10, perSide: true };
const ham = { exerciseKey: "hamstring_stretch", name: "Hamstring stretch", durationSec: 30, perSide: true };
const session = (extra: any = {}) => ({ title: "t", focus: "strength", place: "home", warmup: [], cooldown: [], warmupItems: [swings], cooldownItems: [ham], exercises: [squat], ...extra });

describe("warm-up and cool-down as exercises", () => {
  it("writes the line the app shows", () => {
    expect(partLine(swings)).toBe("Leg swings, 10 each side");
    expect(partLine(ham)).toBe("Hamstring stretch, 30 s each side");
    expect(partLine({ exerciseKey: "assault_bike", name: "Assault bike", durationSec: 300, note: "easy" })).toBe("Assault bike, 5 min easy");
    expect(partLine({ exerciseKey: "cat_cow", name: "Cat-cow", reps: 8 })).toBe("Cat-cow, 8 reps");
  });

  it("warm-up and cool-down exercises count as having them", () => {
    const out = checkSession(session() as any, ask, brief).issues;
    expect(out.filter((i) => /no warm-up|no cool-down/.test(i))).toEqual([]);
  });

  it("their kit is checked like the main workout's", () => {
    const out = checkSession(session({ warmupItems: [{ exerciseKey: "band_pull_apart", name: "Band pull-apart", reps: 15 }] }) as any, ask, brief).issues;
    expect(out.some((i) => i.startsWith("Band pull-apart needs band"))).toBe(true);
  });

  it("a long warm-up counts in the minutes; a short one keeps the old allowance", () => {
    const base = estimateMinutes(session({ warmupItems: [], cooldownItems: [] }) as any);
    expect(estimateMinutes(session() as any)).toBe(base); // 70 s of drills < the 5-min allowance
    expect(estimateMinutes(session({ warmupItems: [{ exerciseKey: "rowing_machine", name: "Rowing machine", durationSec: 600 }] }) as any)).toBe(base + 5);
  });

  it("an edit that does not mention them keeps them", () => {
    const before = session({ warmup: ["Leg swings, 10 each side"], cooldown: ["Hamstring stretch, 30 s each side"] });
    const next = session({ warmupItems: [{ exerciseKey: "arm_circle", name: "Arm circles", reps: 10 }], cooldownItems: [] });
    const kept = keepUntouched(before as any, next as any, "swap the squat for lunges");
    expect(kept.warmupItems).toEqual([swings]);
    expect(kept.cooldownItems).toEqual([ham]);
    expect(keepUntouched(before as any, next as any, "change the warm-up").warmupItems[0].exerciseKey).toBe("arm_circle");
  });
});
