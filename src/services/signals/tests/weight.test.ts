import { weightChange } from "../domain/detectors/weight";
import { describeFinding } from "../domain/describe";
import { DETECTORS, domainOf, EVENT_DETECTORS } from "../domain/registry";
import { SignalInput } from "../domain/types";

const input = (weights: { date: string; kg: number }[], over: Partial<SignalInput> = {}): SignalInput =>
  ({ patientId: "p", today: "2026-10-12", timeZone: "UTC", nights: [], days: [], workouts: [], weights, plan: null, openFindings: [], ...over } as SignalInput);

describe("weight changed substantially", () => {
  it("fires on a loss of 5% or more within a month, in the unit they weigh in", () => {
    const c = weightChange.run(input([{ date: "2026-09-14", kg: 82 }, { date: "2026-10-10", kg: 77.5 }]));
    expect(c?.evidence).toMatchObject({ direction: "down", changePercent: 5.5, unit: "kg", days: 26, planAimsForLoss: false });
    expect(describeFinding(c!)).toEqual({ title: "Weight down substantially", line: "Down 4.5 kg (5.5%) in 26 days" });
    const lb = weightChange.run(input([{ date: "2026-09-14", kg: 82 }, { date: "2026-10-10", kg: 77.5 }], { weightUnit: "lb" }));
    expect(describeFinding(lb!).line).toBe("Down 9.9 lb (5.5%) in 26 days");
  });

  it("fires on a gain too", () => {
    expect(weightChange.run(input([{ date: "2026-09-20", kg: 70 }, { date: "2026-10-11", kg: 74 }]))?.evidence).toMatchObject({ direction: "up" });
  });

  it("still fires under a weight-loss plan, and says the plan aims for loss", () => {
    const c = weightChange.run(input([{ date: "2026-09-14", kg: 82 }, { date: "2026-10-10", kg: 77.5 }], { plan: { outcome: "LOSE_WEIGHT" } as any }));
    expect(describeFinding(c!).line).toBe("Down 4.5 kg (5.5%) in 26 days; your plan aims for loss");
  });

  it("stays quiet under the bar, on weigh-ins too close together, and on an old last weigh-in", () => {
    expect(weightChange.run(input([{ date: "2026-09-14", kg: 82 }, { date: "2026-10-10", kg: 79 }]))).toBeNull(); // 3.7%
    expect(weightChange.run(input([{ date: "2026-10-05", kg: 82 }, { date: "2026-10-10", kg: 76 }]))).toBeNull(); // 5 days apart
    expect(weightChange.run(input([{ date: "2026-08-20", kg: 82 }, { date: "2026-09-15", kg: 76 }]))).toBeNull(); // last weigh-in 27 days ago
    expect(weightChange.run(input([{ date: "2026-10-10", kg: 76 }]))).toBeNull();
    expect(weightChange.run(input([{ date: "2026-08-01", kg: 90 }, { date: "2026-10-10", kg: 80 }]))).toBeNull(); // nothing inside the 30-day window
  });
});

describe("what a finding is about", () => {
  /** Ruling Oct 12 2026: Signals lists check-ins and HEALTH findings; habits stay notes from Ollie. */
  it("health = recovery, labs and substantial weight change — and nothing else", () => {
    const health = [...DETECTORS, ...EVENT_DETECTORS].filter((d) => d.domain === "health").map((d) => d.key).sort();
    expect(health).toEqual(["labs.report", "recovery.dip", "recovery.restored", "weight.change"]);
  });

  it("training, logging, protein, sleep against target and weight against the plan are habits", () => {
    for (const key of ["training.stopped", "training.drifting", "training.consistent", "logging.stopped", "nutrition.protein_short", "sleep.debt", "weight.off_track"]) expect(domainOf(key)).toBe("habit");
  });

  it("a finding whose detector no longer exists is never shown as a health signal", () => {
    expect(domainOf("retired.detector")).toBe("habit");
  });
});
