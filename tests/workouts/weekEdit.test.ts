import { applyWeekEdits, dayOfWeekday, WeekEditError, type DesignOne, type WeekDraftState, type WeekSession } from "../../src/services/workouts/design/weekEdit";
import { weekShapeIssues } from "../../src/services/workouts/design/workoutDesign.service";

/**
 * A change to a drafted week touches only what was named. The device
 * conversation behind this (Oct 5 2026): "Sessions should be Monday Wednesday
 * and Thursday" came back with all three sessions rewritten.
 */

const session = (day: number, title: string, focus = "mixed"): WeekSession => ({
  day,
  session: {
    activityKey: "strength",
    title,
    plannedFor: `2026-10-0${4 + day}`,
    durationMin: 60,
    focus,
    muscleGroups: ["core"],
    exercises: [{ exerciseKey: "plank", name: "Plank", sets: [{ durationSec: 30, restSec: 60 }, { durationSec: 30, restSec: 60 }] }],
  } as any,
  fit: { ok: true, issues: [] },
  assumptions: [],
});

// Monday 5 Oct 2026 → Sunday 11 Oct. Sessions Mon, Wed, Fri; Wednesday is the day to keep.
const week = (): WeekDraftState => ({ startDate: "2026-10-05", days: 7, priorityDay: 3, sessions: [session(1, "Mobility and easy core", "mobility"), session(3, "Light upper body"), session(5, "Gentle cardio", "mobility")] });

const neverDesign: DesignOne = async () => {
  throw new Error("the designer must not be called");
};
const fakeDesign = (title: string): DesignOne & { calls: any[] } => {
  const calls: any[] = [];
  const fn: any = async (spec: any) => {
    calls.push(spec);
    return { session: { ...session(spec.day, title).session, plannedFor: "wrong-on-purpose" }, fit: { ok: true, issues: [] }, assumptions: [] };
  };
  fn.calls = calls;
  return fn;
};
const body = (s: WeekSession) => ({ ...s.session, plannedFor: null });

describe("weekdays of a week", () => {
  it("maps a weekday to its day number from the start date", () => {
    expect(dayOfWeekday("2026-10-05", 7, "thu")).toBe(4);
    expect(dayOfWeekday("2026-10-07", 7, "mon")).toBe(6); // a week that starts on a Wednesday
    expect(dayOfWeekday("2026-10-05", 3, "thu")).toBeNull(); // a 3-day week ends on Wednesday
  });
});

describe("moving a session", () => {
  it("moves Friday to Thursday without designing anything, and leaves every session as it was", async () => {
    const w = week();
    const out = await applyWeekEdits(w, [{ op: "move", from: "fri", to: "thu" }], neverDesign);
    expect(out.sessions.map((s) => s.day)).toEqual([1, 3, 4]);
    expect(out.sessions[0]).toBe(w.sessions[0]); // untouched: the very same object
    expect(out.sessions[1]).toBe(w.sessions[1]);
    expect(body(out.sessions[2])).toEqual(body(w.sessions[2])); // moved: same content
    expect(out.sessions[2].session.plannedFor).toBe("2026-10-08");
    expect(out.designed).toEqual([]);
    expect(out.priorityDay).toBe(3);
  });

  it("swaps two sessions when the target day is taken, and the day to keep follows its session", async () => {
    const w = week();
    const out = await applyWeekEdits(w, [{ op: "move", from: "wed", to: "mon" }], neverDesign);
    expect(out.sessions.map((s) => [s.day, s.session.title])).toEqual([
      [1, "Light upper body"],
      [3, "Mobility and easy core"],
      [5, "Gentle cardio"],
    ]);
    expect(out.priorityDay).toBe(1);
  });

  it("refuses a day with no session, or a weekday outside the week", async () => {
    await expect(applyWeekEdits(week(), [{ op: "move", from: "tue", to: "thu" }], neverDesign)).rejects.toThrow(WeekEditError);
    await expect(applyWeekEdits({ ...week(), days: 5 }, [{ op: "move", from: "mon", to: "sat" }], neverDesign)).rejects.toThrow(/no sat/);
  });
});

describe("adding, changing and removing", () => {
  it("designs only the added session, with the others passed as fixed context", async () => {
    const w = week();
    const design = fakeDesign("Easy conditioning");
    const out = await applyWeekEdits(w, [{ op: "add", day: "sat", request: "an easy bike session" }], design);
    expect(design.calls).toHaveLength(1);
    expect(design.calls[0]).toMatchObject({ day: 6, date: "2026-10-10", previous: null, request: "an easy bike session" });
    expect(design.calls[0].others).toHaveLength(3);
    expect(out.sessions.map((s) => s.day)).toEqual([1, 3, 5, 6]);
    expect(out.sessions.slice(0, 3)).toEqual(w.sessions);
    expect(out.sessions[3].session.plannedFor).toBe("2026-10-10"); // the day is set here, not by the designer
    expect(out.designed).toEqual([6]);
  });

  it("changes one session against its previous version and leaves the rest", async () => {
    const w = week();
    const design = fakeDesign("Longer upper body");
    const out = await applyWeekEdits(w, [{ op: "change", day: "wed", request: "add more upper body work to fill the hour" }], design);
    expect(design.calls[0].previous).toBe(w.sessions[1].session);
    expect(design.calls[0].others).toEqual([w.sessions[0], w.sessions[2]]);
    expect(out.sessions[0]).toBe(w.sessions[0]);
    expect(out.sessions[2]).toBe(w.sessions[2]);
    expect(out.sessions[1].session.title).toBe("Longer upper body");
    expect(out.designed).toEqual([3]);
  });

  it("a designed session that is then moved is still reported on its final day", async () => {
    const out = await applyWeekEdits(week(), [{ op: "add", day: "sat", request: "x" }, { op: "move", from: "sat", to: "sun" }], fakeDesign("New"));
    expect(out.designed).toEqual([7]);
  });

  it("removes a session and forgets the day to keep when that was it", async () => {
    const out = await applyWeekEdits(week(), [{ op: "remove", day: "wed" }], neverDesign);
    expect(out.sessions.map((s) => s.day)).toEqual([1, 5]);
    expect(out.priorityDay).toBeNull();
  });

  it("refuses to add onto a taken day, change an empty one, or empty the week", async () => {
    await expect(applyWeekEdits(week(), [{ op: "add", day: "mon", request: "x" }], neverDesign)).rejects.toThrow(/already has/);
    await expect(applyWeekEdits(week(), [{ op: "change", day: "tue", request: "x" }], neverDesign)).rejects.toThrow(/no session/);
    const one = { ...week(), sessions: [session(1, "Only")] };
    await expect(applyWeekEdits(one, [{ op: "remove", day: "mon" }], neverDesign)).rejects.toThrow(/at least one/);
  });
});

describe("what an edited week must still hold", () => {
  it("flags two heavy days on the same muscles made consecutive by a move", () => {
    const heavy = [{ day: 1, focus: "strength", muscleGroups: ["legs"] }, { day: 2, focus: "strength", muscleGroups: ["legs"] }];
    expect(weekShapeIssues(heavy, false).join(" ")).toMatch(/consecutive/);
    expect(weekShapeIssues([heavy[0], { ...heavy[1], day: 3 }], false)).toEqual([]);
  });

  it("under caution, flags a strength day and a week left without a mobility day", () => {
    expect(weekShapeIssues([{ day: 1, focus: "mixed", muscleGroups: [] }], true).join(" ")).toMatch(/mobility/);
    expect(weekShapeIssues([{ day: 1, focus: "mobility", muscleGroups: [] }, { day: 3, focus: "strength", muscleGroups: [] }], true).join(" ")).toMatch(/strength/);
    expect(weekShapeIssues([{ day: 1, focus: "mobility", muscleGroups: [] }, { day: 3, focus: "mixed", muscleGroups: [] }], true)).toEqual([]);
  });
});
