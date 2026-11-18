import { closeUnfollowed, closeVerdict, followUpAck, CheckInRecord } from "../../src/services/encounter/domain/followUp";
import { lintOutput } from "../../src/services/agent/safety/lint";

/** A check-in closes by itself (ruling Nov 16 2026): better twice, or at day 14. */

const start = new Date("2026-11-01T09:00:00Z");
const on = (day: number) => new Date(start.getTime() + day * 86_400_000);
const r = (day: number, trend: CheckInRecord["trend"]): CheckInRecord => ({ day, trend, createdAt: on(day) });

describe("closeVerdict", () => {
  it("better twice in a row closes it as resolved, on any day", () => {
    expect(closeVerdict(start, [r(2, "BETTER"), r(5, "BETTER")], on(5))).toBe("resolved");
  });
  it("better once, or better after worse, keeps it open inside the window", () => {
    expect(closeVerdict(start, [r(2, "BETTER")], on(3))).toBeNull();
    expect(closeVerdict(start, [r(2, "BETTER"), r(5, "WORSE"), r(10, "BETTER")], on(10))).toBeNull();
  });
  it("past day 14: lapsed with no answers, resolved if the last was better, persisted otherwise", () => {
    expect(closeVerdict(start, [], on(15))).toBe("lapsed");
    expect(closeVerdict(start, [r(5, "SAME"), r(10, "BETTER")], on(15))).toBe("resolved");
    expect(closeVerdict(start, [r(5, "BETTER"), r(10, "SAME")], on(15))).toBe("persisted");
  });
  it("nothing closes on day 14 itself", () => {
    expect(closeVerdict(start, [], on(14))).toBeNull();
  });
});

describe("check-ins that are not followed", () => {
  it("an interview left unfinished lapses after 14 quiet days", () => {
    expect(closeUnfollowed("unfinished", start, on(3), on(16))).toBeNull();
    expect(closeUnfollowed("unfinished", start, on(3), on(18))).toBe("lapsed");
  });
  it("a matched warning sign closes as escalated at the window", () => {
    expect(closeUnfollowed("red_flag", start, start, on(10))).toBeNull();
    expect(closeUnfollowed("red_flag", start, start, on(15))).toBe("escalated");
  });
});

describe("the reply when an answer closes it", () => {
  it("says it closed, asks nothing more, and lints clean", () => {
    const ack = followUpAck(start, [r(5, "BETTER"), r(2, "BETTER")], on(5), "UTC");
    expect(ack.closed).toBe("resolved");
    expect(ack.nextDay).toBeNull();
    expect(ack.next).toMatch(/closed this check-in/);
    expect(lintOutput(ack.next)).toEqual([]);
  });
  it("a single better answer keeps the schedule", () => {
    const ack = followUpAck(start, [r(2, "BETTER")], on(2), "UTC");
    expect(ack.closed).toBeNull();
    expect(ack.nextDay).toBe(5);
  });
});
