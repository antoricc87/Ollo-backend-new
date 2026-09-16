import { checkinModeFor } from "../../src/services/encounter/domain/mode";
import { lintOutput } from "../../src/services/agent/safety/lint";

/**
 * The widened guard must live exactly as long as the interview does. The bug
 * this pins (Sep 16 2026): an encounter stays OPEN after its assessment for the
 * follow-up loop, so keying the mode on OPEN left every later message in the
 * thread able to name conditions.
 */

const assessment = { possibilities: [{ condition: "Tension-type headache" }, { condition: "migraine (without aura)" }] };

describe("checkinModeFor", () => {
  it("is off with no check-in", () => {
    expect(checkinModeFor(null)).toEqual({ active: false, paused: false, assessedConditions: [] });
  });

  it("is active while the history is being taken", () => {
    expect(checkinModeFor({ status: "OPEN", phase: "SAFETY_SCREEN" }).active).toBe(true);
    expect(checkinModeFor({ status: "OPEN", phase: "HISTORY" }).active).toBe(true);
  });

  it("stays active once the history is complete but nothing is assessed yet", () => {
    expect(checkinModeFor({ status: "OPEN", phase: "RECAP" }).active).toBe(true);
  });

  it("switches OFF after the assessment, even though the encounter stays open", () => {
    const mode = checkinModeFor({ status: "OPEN", phase: "ROUTE" }, assessment);
    expect(mode.active).toBe(false);
    expect(mode.assessedConditions).toEqual(["Tension-type headache", "migraine (without aura)"]);
  });

  it("switches off after a crisis halt, with nothing to explain", () => {
    expect(checkinModeFor({ status: "OPEN", phase: "ROUTE" }, null)).toEqual({ active: false, paused: false, assessedConditions: [] });
  });

  /* Ruling 2026-09-16: End = pause. Not active (no widened guard), but the thread knows it can be picked back up. */
  it("a check-in ended with End is paused, not active", () => {
    const mode = checkinModeFor({ status: "ABANDONED", phase: "HISTORY" });
    expect(mode.active).toBe(false);
    expect(mode.paused).toBe(true);
  });

  it("is off once closed", () => {
    expect(checkinModeFor({ status: "CLOSED", phase: "CLOSED" }, assessment).active).toBe(false);
  });

  it("reopens when a new answer moves the phase back into the interview", () => {
    const mode = checkinModeFor({ status: "OPEN", phase: "HISTORY" }, assessment);
    expect(mode.active).toBe(true);
    expect(mode.assessedConditions).toEqual([]);
  });
});

describe("after an assessment, the guard", () => {
  const assessed = checkinModeFor({ status: "OPEN", phase: "ROUTE" }, assessment).assessedConditions;

  it("lets a possibility the assessment named be discussed", () => {
    expect(lintOutput("That sounds like migraine, which usually comes with light sensitivity.", { onRecordConditions: assessed }).map((f) => f.act)).toEqual([]);
  });

  it("still flags a condition the assessment did NOT name", () => {
    expect(lintOutput("Honestly, this sounds like IBS to me.", { onRecordConditions: assessed }).map((f) => f.act)).toContain("DIAGNOSE");
  });
});
