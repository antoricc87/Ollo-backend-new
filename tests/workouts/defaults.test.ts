import { deriveDefaults, HistorySession } from "../../src/services/workouts/design/defaults";

const gymDay = (date: string, durationMin = 50, over: Partial<HistorySession> = {}): HistorySession => ({ date, durationMin, place: "gym", shape: "strength", hasLifts: true, ...over });
const nothing = { stated: {}, profile: null, plan: null, history: [] };

describe("what a design falls back on", () => {
  it("with nothing known: a gym, 45 minutes, a general mixed session — and says so", () => {
    const d = deriveDefaults(nothing);
    expect(d).toMatchObject({ place: "gym", durationMin: 45, focus: "mixed", experience: "some", preferredDays: [] });
    expect(d.assumed).toEqual(["Assumed a gym — say if you train somewhere else", "45 min — say if you want it shorter or longer", "A general mixed session"]);
  });

  it("what they said beats everything and is never listed as assumed", () => {
    const d = deriveDefaults({ stated: { place: "home", durationMin: 60, focus: "strength" }, profile: { place: "gym", sessionMinutes: 40 }, plan: { outcome: "LOSE_WEIGHT" }, history: [gymDay("2026-10-01")] });
    expect(d).toMatchObject({ place: "home", durationMin: 60, focus: "strength" });
    expect(d.assumed).toEqual([]);
  });

  it("the profile beats history, and is not an assumption either", () => {
    const d = deriveDefaults({ stated: { focus: "mobility" }, profile: { place: "home", sessionMinutes: 40, experience: "experienced", preferredDays: ["tue", "fri"] }, plan: null, history: [gymDay("2026-10-01"), gymDay("2026-10-03"), gymDay("2026-10-05")] });
    expect(d).toMatchObject({ place: "home", durationMin: 40, experience: "experienced", preferredDays: ["tue", "fri"] });
    expect(d.assumed).toEqual([]);
  });

  it("their own sessions fill what the profile does not say", () => {
    // Mondays and Thursdays at home for about an hour, soccer on Saturdays
    const history = [gymDay("2026-09-28", 60, { place: "home" }), gymDay("2026-10-01", 55, { place: "home" }), gymDay("2026-10-05", 65, { place: "home" }), gymDay("2026-10-08", 60, { place: "home" }), { date: "2026-10-10", durationMin: 90, place: null, shape: "sport", hasLifts: false }];
    const d = deriveDefaults({ stated: {}, profile: { place: null }, plan: null, history });
    expect(d).toMatchObject({ place: "home", durationMin: 60, preferredDays: ["mon", "thu"], experience: "some" });
    expect(d.from).toMatchObject({ place: "history", durationMin: "history", preferredDays: "history", experience: "history" });
    expect(d.assumed).toEqual(["Planned for home, where you last trained", "60 min, your usual length", "A general mixed session"]);
  });

  it("the last saved week beats the median of logged sessions (Oct 18 2026: asked at 60, redesigned at 35)", () => {
    const history = [gymDay("2026-09-28", 35), gymDay("2026-10-01", 30), gymDay("2026-10-03", 35)];
    const d = deriveDefaults({ stated: {}, profile: { place: "gym" }, plan: null, history, lastWeek: { sessionMinutes: 60, days: ["thu", "mon", "wed"] } });
    expect(d).toMatchObject({ durationMin: 60, preferredDays: ["mon", "wed", "thu"] });
    expect(d.from).toMatchObject({ durationMin: "last_week", preferredDays: "last_week" });
    expect(d.assumed).toContain("60 min, like your last training week");
  });

  it("the profile still beats the last saved week", () => {
    const d = deriveDefaults({ stated: {}, profile: { place: "gym", sessionMinutes: 45, preferredDays: ["tue"] }, plan: null, history: [], lastWeek: { sessionMinutes: 60, days: ["mon"] } });
    expect(d).toMatchObject({ durationMin: 45, preferredDays: ["tue"] });
  });

  it("a soccer match does not count toward the usual length or days", () => {
    const d = deriveDefaults({ ...nothing, history: [1, 2, 3, 4].map((i) => ({ date: `2026-10-0${i}`, durationMin: 90, place: null, shape: "sport", hasLifts: false })) });
    expect(d.durationMin).toBe(45);
    expect(d.preferredDays).toEqual([]);
  });

  it("the plan leads the kind of session; no plan means a general mixed one", () => {
    expect(deriveDefaults({ ...nothing, plan: { outcome: "RECOMPOSITION" } }).focus).toBe("hypertrophy");
    expect(deriveDefaults({ ...nothing, plan: { outcome: "LOSE_WEIGHT" } }).focus).toBe("mixed");
    expect(deriveDefaults(nothing).from.focus).toBe("default");
  });

  it("leaves the kind of session to their own words when they described it", () => {
    const d = deriveDefaults({ ...nothing, stated: { describesSession: true }, plan: { outcome: "RECOMPOSITION" } });
    expect(d.focus).toBeNull();
    expect(d.assumed.some((a) => /session/.test(a))).toBe(false);
  });
});
