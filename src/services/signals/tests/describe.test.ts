import { lintOutput } from "../../agent/safety/lint";
import { describeFinding } from "../domain/describe";
import { DETECTORS, EVENT_DETECTORS } from "../domain/registry";

const SAMPLES: Record<string, { evidence: unknown; baseline?: unknown; line: string }> = {
  "recovery.dip": { evidence: { nights: [{}, {}, {}], vitals: [{ vital: "hrvMs" }, { vital: "sleepingHr" }] }, line: "HRV and sleeping heart rate away from your usual, 3 nights running" },
  "recovery.restored": { evidence: { nights: [{}, {}, {}] }, line: "Inside your usual range 3 nights running" },
  "sleep.debt": { evidence: { targetMinutes: 450, nights: [{}, {}, {}, {}, {}], shortNights: 4 }, line: "4 of 5 nights under your 7 h 30 min target" },
  "training.stopped": { evidence: { sessionsPerWeekTarget: 3, daysSince: 9 }, line: "No session in 9 days; your plan lists 3 a week" },
  "training.drifting": { evidence: { sessionsPerWeekTarget: 4, weeks: [{ done: 1 }, { done: 2 }] }, line: "1 and 2 of 4 sessions over the last two weeks" },
  "training.consistent": { evidence: { sessionsPerWeekTarget: 3 }, line: "3 or more sessions a week, three weeks running" },
  "logging.stopped": { evidence: { daysWithNoMealLogged: 4 }, line: "4 days with no meal logged" },
  "nutrition.protein_short": { evidence: { targetG: 130, loggedDays: 6, shortDays: 5 }, line: "5 of 6 logged days under your target of 130 g" },
  "weight.off_track": { evidence: { targetKgPerWeek: -0.5, observedKgPerWeek: 0.3 }, line: "+0.3 kg a week against a plan of -0.5 kg a week" },
  "labs.report": { evidence: { newlyFlagged: [{}, {}], changed: [], backInRange: [{}] }, line: "2 values newly outside the lab's range and 1 value back inside the range" },
};

describe("a finding in words", () => {
  it("has copy for every registered detector", () => {
    for (const d of [...DETECTORS, ...EVENT_DETECTORS]) expect(Object.keys(SAMPLES)).toContain(d.key);
  });

  it.each(Object.entries(SAMPLES))("%s states what was counted", (detectorKey, sample) => {
    const out = describeFinding({ detectorKey, evidence: sample.evidence, baseline: sample.baseline });
    expect(out.line).toBe(sample.line);
    expect(out.title).not.toBe("Something changed in your data");
  });

  it("still reads a logging finding stored before the evidence keys were renamed", () => {
    expect(describeFinding({ detectorKey: "logging.stopped", evidence: { consecutiveDaysUnlogged: 5 } }).line).toBe("5 days with no meal logged");
  });

  it("never throws on evidence it does not recognise", () => {
    for (const key of [...Object.keys(SAMPLES), "future.detector"]) expect(() => describeFinding({ detectorKey: key, evidence: null })).not.toThrow();
  });

  it("says nothing the output guard forbids", () => {
    for (const [detectorKey, sample] of Object.entries(SAMPLES)) {
      const out = describeFinding({ detectorKey, evidence: sample.evidence });
      expect(lintOutput(`${out.title}. ${out.line}.`)).toEqual([]);
    }
  });
});
