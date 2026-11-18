import { followUpAck, followUpFor, slotFor, CheckInRecord } from "../../src/services/encounter/domain/followUp";
import { mergeSigns, NONE, rescreenFor, routeDecided } from "../../src/services/encounter/domain/rescreen";
import { resolveProtocol } from "../../src/services/encounter/domain/protocols";
import { evaluateSlots } from "../../src/services/encounter/domain/redflags";
import { lintOutput } from "../../src/services/agent/safety/lint";

/** Worsening check-ins (rulings Nov 16 2026). */

const start = new Date("2026-11-01T09:00:00Z");
const on = (day: number) => new Date(start.getTime() + day * 86_400_000);
const r = (day: number, trend: CheckInRecord["trend"]): CheckInRecord => ({ day, trend, createdAt: on(day) });

describe("worse is asked again the next day", () => {
  it("worse on day 2 makes day 3 a follow-up day", () => {
    expect(slotFor(3, [r(2, "WORSE")])).toBe(3);
    const f = followUpFor(start, [r(2, "WORSE")], on(3));
    expect(f.due).toBe(true);
    expect(f.slot).toBe(3);
  });
  it("not on the day of the worse answer itself", () => {
    expect(followUpFor(start, [r(2, "WORSE")], on(2)).due).toBe(false);
  });
  it("better or the same keeps the normal schedule", () => {
    expect(followUpFor(start, [r(2, "SAME")], on(3)).due).toBe(false);
    expect(followUpFor(start, [r(2, "BETTER")], on(4)).due).toBe(false);
  });
  it("still worse → asked daily, never past the window", () => {
    expect(followUpFor(start, [r(3, "WORSE"), r(2, "WORSE")], on(4)).due).toBe(true);
    expect(followUpFor(start, [r(14, "WORSE")], on(15)).due).toBe(false);
  });
  it("the reply says tomorrow, and lints clean", () => {
    const ack = followUpAck(start, [r(2, "WORSE")], on(2), "UTC");
    expect(ack.nextDay).toBe(3);
    expect(ack.next).toBe("I'll check in again tomorrow.");
    expect(lintOutput(ack.next)).toEqual([]);
  });
});

describe("worse asks the warning signs again", () => {
  it("the question is the protocol's own warning-sign options", () => {
    const q = rescreenFor(resolveProtocol("back_pain"))!;
    expect(q.slotKey).toBe("associated");
    expect(q.options.map((o) => o.label)).toContain("Weakness in a leg");
    expect(lintOutput(q.question)).toEqual([]);
  });

  it("a sign said before is never un-said; 'none' adds nothing", () => {
    expect(mergeSigns(["fever"], [NONE])).toEqual(["fever"]);
    expect(mergeSigns([NONE], ["weakness_in_a_leg"])).toEqual(["weakness_in_a_leg"]);
    expect(mergeSigns(null, [])).toEqual([NONE]);
  });

  it("a new leg weakness on a back-pain check-in trips the same rule as on day 1", () => {
    const q = rescreenFor(resolveProtocol("back_pain"))!;
    const weak = q.options.find((o) => o.label === "Weakness in a leg")!.value;
    const state: any = { complaintKey: "back_pain", slots: { associated: mergeSigns([NONE], [weak]) }, redFlags: [] };
    expect(evaluateSlots(state).map((f) => f.ruleId)).toContain("back.cauda_equina");
  });
});

describe("the clinician offer is answered once", () => {
  it("any decided route ends the offers", () => {
    expect(routeDecided("UNDECIDED")).toBe(false);
    expect(routeDecided("TRACKING")).toBe(true);
    expect(routeDecided("OLLO_DOCTOR")).toBe(true);
  });
});
