import { changesLine, keepUntouched, lengthAsked, sessionChanges } from "../../src/services/workouts/design/sessionEdit";

const set = (reps: number, rest = 60) => ({ targetReps: reps, targetRepsMax: null, targetKg: null, durationSec: null, restSec: rest });
const ex = (exerciseKey: string, name: string, sets: number, reps: number) => ({ exerciseKey, name, loadNote: null, alternatives: [], sets: Array.from({ length: sets }, () => set(reps)) });
const session = (exercises: any[], over: any = {}): any => ({ title: "Light full body", focus: "mobility", durationMin: 60, warmup: ["5 min easy bike"], cooldown: ["Child's pose"], exercises, ...over });

/** The Oct 11 2026 conversation: "add pull-ups" came back with five of seven exercises different. */
describe("editing one drafted session", () => {
  const before = session([ex("face_pull", "Face pull", 3, 12), ex("chest_fly", "Chest fly", 2, 12), ex("seated_cable_row", "Seated cable row", 2, 12), ex("dead_bug", "Dead bug", 3, 10)]);

  it("puts back the sets of every exercise the request did not name", () => {
    const drifted = session([ex("face_pull", "Face pull", 2, 15), ex("pull_up", "Pull-up", 2, 8), ex("chest_fly", "Chest fly", 2, 10), ex("seated_cable_row", "Seated cable row", 2, 12), ex("dead_bug", "Dead bug", 2, 12)], { warmup: ["Arm circles"], title: "Upper body mobility" });
    const after = keepUntouched(before, drifted, "add pull-ups");
    expect(after.exercises!.find((e: any) => e.exerciseKey === "face_pull")!.sets).toEqual(before.exercises[0].sets);
    expect(after.exercises!.find((e: any) => e.exerciseKey === "dead_bug")!.sets).toEqual(before.exercises[3].sets);
    expect(after.warmup).toEqual(["5 min easy bike"]);
    expect(after.title).toBe("Light full body");
    const changes = sessionChanges(before, after);
    expect(changes).toEqual({ added: ["Pull-up"], removed: [], moreSets: [], fewerSets: [], changed: [], kept: 4, minutes: null });
    expect(changesLine(changes)).toBe("added Pull-up; 4 other exercises unchanged");
  });

  it("lets a named exercise change, and only that one", () => {
    const next = session([ex("face_pull", "Face pull", 4, 12), ex("chest_fly", "Chest fly", 3, 10), ex("seated_cable_row", "Seated cable row", 2, 12), ex("dead_bug", "Dead bug", 3, 10)]);
    const after = keepUntouched(before, next, "one more set of face pulls");
    expect(sessionChanges(before, after)).toEqual({ added: [], removed: [], moreSets: ["Face pull"], fewerSets: [], changed: [], kept: 3, minutes: null });
  });

  it("lets the whole dose move when the request is about the whole session", () => {
    const next = session([ex("face_pull", "Face pull", 2, 12), ex("chest_fly", "Chest fly", 2, 12), ex("dead_bug", "Dead bug", 2, 10)], { durationMin: 40 });
    const after = keepUntouched(before, next, "make it shorter, 40 minutes");
    const c = sessionChanges(before, after);
    expect(c).toEqual({ added: [], removed: ["Seated cable row"], moreSets: [], fewerSets: ["Face pull", "Dead bug"], changed: [], kept: 1, minutes: { from: 60, to: 40 } });
    expect(changesLine(c)).toBe("60 → 40 min; removed Seated cable row; FEWER sets of Face pull, Dead bug; 1 other exercise unchanged");
  });

  it("changes the warm-up only when asked to", () => {
    const next = session(before.exercises, { warmup: ["10 min row"] });
    expect(keepUntouched(before, next, "a longer warm-up").warmup).toEqual(["10 min row"]);
    expect(keepUntouched(before, next, "swap the fly for push-ups").warmup).toEqual(["5 min easy bike"]);
  });
});

/** Oct 18 2026: "make it 45 minutes" reached the designer as words only, so 35 min stayed; one session even lost a set and the reply said "more volume". */
describe("a length said in words", () => {
  it.each([
    ["Make it a 45-minute session by adding more upper body exercises or sets.", 45],
    ["session should be 45 minutes", 45],
    ["45 min please", 45],
    ["make it an hour", 60],
    ["1.5 hours", 90],
    ["an hour and a half", 90],
    ["90 mins", 90],
  ])("%s → %d", (text, minutes) => expect(lengthAsked(text)).toBe(minutes));

  it("a relative length moves from the session as it is", () => {
    expect(lengthAsked("about 15 minutes longer", 45)).toBe(60);
    expect(lengthAsked("add 10 minutes", 35)).toBe(45);
    expect(lengthAsked("10 min shorter", 45)).toBe(35);
    // Without the session's length a relative one is not guessed.
    expect(lengthAsked("15 minutes longer")).toBeNull();
  });

  // A warm-up's length is a part of the session, not the session's length.
  it.each(["add pull-ups", "3 sets of 10", "more sets", "a 10 min warm-up", "add 15 minutes of cool-down stretching"])("no length in %s", (text) => {
    expect(lengthAsked(text)).toBeNull();
  });

  it("a session that lost a set says FEWER, never more", () => {
    const before = session([ex("dumbbell_shoulder_press", "Dumbbell shoulder press", 3, 8), ex("face_pull", "Face pull", 2, 12)], { durationMin: 35 });
    const after = session([ex("dumbbell_shoulder_press", "Dumbbell shoulder press", 2, 8), ex("face_pull", "Face pull", 2, 12)], { durationMin: 35 });
    expect(changesLine(sessionChanges(before, after))).toBe("FEWER sets of Dumbbell shoulder press; 1 other exercise unchanged");
  });
});
