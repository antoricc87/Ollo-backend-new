import { ANNOUNCE_DAYS, isUnseenNote } from "../../src/services/agent/memory/thread.store";

const now = Date.parse("2026-10-09T12:00:00Z");
const daysAgo = (n: number) => new Date(now - n * 86_400_000);

describe("a note from Ollie is announced until it is opened", () => {
  it("announces an unopened note", () => {
    expect(isUnseenNote({ source: "PROACTIVE", seenAt: null, lastMessageAt: daysAgo(1) }, now)).toBe(true);
  });

  it("stops once it has been opened, however recent", () => {
    expect(isUnseenNote({ source: "PROACTIVE", seenAt: daysAgo(0), lastMessageAt: daysAgo(1) }, now)).toBe(false);
  });

  it("never announces a conversation the person started", () => {
    expect(isUnseenNote({ source: "CHAT", seenAt: null, lastMessageAt: daysAgo(0) }, now)).toBe(false);
    expect(isUnseenNote({ source: "VOICE", seenAt: null, lastMessageAt: daysAgo(0) }, now)).toBe(false);
  });

  it("lets an unopened note go quiet after a week", () => {
    expect(isUnseenNote({ source: "PROACTIVE", seenAt: null, lastMessageAt: daysAgo(ANNOUNCE_DAYS + 1) }, now)).toBe(false);
  });
});
