import { buildBuckets, splitSession, type BucketInput, type BucketSession } from "../domain/weekBuckets";

const days = (n: number, kcal = 2300, prot = 140) =>
  Array.from({ length: 7 }, (_, i) => ({ date: `2026-11-${16 + i}`, mealTypes: i < n ? ["breakfast", "dinner"] : [], calories: i < n ? kcal : 0, proteinG: i < n ? prot : 0 }));
const nights = (mins: (number | null)[], hrv = 60) => mins.map((m, i) => ({ date: `2026-11-${16 + i}`, asleepMinutes: m, hrvMs: m ? hrv : null, restingHr: m ? 54 : null }));
const session = (o: Partial<BucketSession>): BucketSession => ({ date: "2026-11-16", title: "Upper-body strength", activityKey: "strength", minutes: 50, calories: 400, done: true, planned: true, parts: [], ...o });
const usual = (mean: number, std: number) => ({ n: 30, mean, std });
const base = (o: Partial<BucketInput> = {}): BucketInput => ({
  week: { days: days(7), nights: nights([440, 430, 450, 420, 460, 400, 445]), sessions: [] },
  previous: { days: days(7), nights: nights([430, 420, 430, 420, 430, 400, 430]), sessions: [] },
  targets: { calories: { min: 2300, max: 2300 }, proteinG: { min: 140, max: null }, sleepMinutes: 420, sessionsPerWeek: 4 },
  baselines: { asleepMinutes: usual(430, 20), hrvMs: usual(58, 6), restingHr: usual(55, 2) },
  hasNights: true,
  ...o,
});

describe("weekly summary buckets (Nov 22 2026)", () => {
  it("splits a mixed class by its exercises, scaled to the real length", () => {
    const gtx = session({ title: "GTX class", minutes: 45, parts: [
      { exerciseKey: "treadmill_run", workSets: 1, durationSec: 600 },
      { exerciseKey: "assault_bike", workSets: 1, durationSec: 600 },
      { exerciseKey: "goblet_squat", workSets: 3, durationSec: 0 },
      { exerciseKey: "push_up", workSets: 3, durationSec: 0 },
    ] });
    const s = splitSession(gtx);
    expect(s.cardio + s.strength).toBeGreaterThanOrEqual(44);
    expect(s.cardio).toBeGreaterThan(s.strength);
  });

  it("a watch run with no exercises counts as cardio; strength training as strength", () => {
    expect(splitSession(session({ activityKey: "running", title: "Easy run", minutes: 45 }))).toMatchObject({ cardio: 45, strength: 0 });
    expect(splitSession(session({ minutes: 50 }))).toMatchObject({ strength: 50 });
  });

  it("exercise: 4/4 done is ON PLAN, 2/4 is BEHIND with the misses on the ring", () => {
    const four = [16, 18, 20, 22].map((d) => session({ date: `2026-11-${d}` }));
    expect(buildBuckets(base({ week: { ...base().week, sessions: four } })).exercise).toMatchObject({ tag: "ON PLAN", done: 4, outOf: 4, totalMin: 200 });
    const two = [session({}), session({ date: "2026-11-18" }), session({ date: "2026-11-20", done: false }), session({ date: "2026-11-22", done: false })];
    const ex = buildBuckets(base({ week: { ...base().week, sessions: two } })).exercise;
    expect(ex).toMatchObject({ tag: "BEHIND", done: 2, outOf: 4 });
    expect(ex.ring).toEqual(["strength", "strength", "missed", "missed"]);
  });

  it("sleep: on target → ON PLAN; short → SHORT; low HRV → BELOW USUAL; 2 nights → no tag and a count", () => {
    expect(buildBuckets(base()).sleep).toMatchObject({ tag: "ON PLAN", recorded: 7, overCount: 6 });
    expect(buildBuckets(base({ week: { ...base().week, nights: nights([360, 350, 370, 365, 360, 355, 370]) } })).sleep.tag).toBe("SHORT");
    expect(buildBuckets(base({ week: { ...base().week, nights: nights([440, 430, 450, 420, 460, 400, 445], 45) } })).sleep.tag).toBe("BELOW USUAL");
    const thin = buildBuckets(base({ week: { ...base().week, nights: nights([440, 430, null, null, null, null, null]) } })).sleep;
    expect(thin).toMatchObject({ tag: null, avgMin: null, sub: "2 of 7 nights recorded" });
    expect(thin.ring).toEqual(["over", "over", "none", "none", "none", "none", "none"]);
  });

  it("nutrition: protein low wins the tag; 2 days logged → no tag, a dash, and the count", () => {
    expect(buildBuckets(base({ week: { ...base().week, days: days(7, 2240, 118) } })).nutrition).toMatchObject({ tag: "PROTEIN LOW", avgKcal: 2240, pctOfTarget: 97 });
    expect(buildBuckets(base()).nutrition).toMatchObject({ tag: "ON PLAN", onTarget: 7 });
    const thin = buildBuckets(base({ week: { ...base().week, days: days(2) } })).nutrition;
    expect(thin).toMatchObject({ tag: null, avgKcal: null, logged: 2, sub: "2 of 7 days logged" });
  });
});
