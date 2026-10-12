import { changesLine, keepUntouched, sessionChanges } from "../../src/services/workouts/design/sessionEdit";

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
    expect(changes).toEqual({ added: ["Pull-up"], removed: [], changed: [], kept: 4 });
    expect(changesLine(changes)).toBe("added Pull-up; 4 other exercises unchanged");
  });

  it("lets a named exercise change, and only that one", () => {
    const next = session([ex("face_pull", "Face pull", 4, 12), ex("chest_fly", "Chest fly", 3, 10), ex("seated_cable_row", "Seated cable row", 2, 12), ex("dead_bug", "Dead bug", 3, 10)]);
    const after = keepUntouched(before, next, "one more set of face pulls");
    expect(sessionChanges(before, after)).toEqual({ added: [], removed: [], changed: ["Face pull"], kept: 3 });
  });

  it("lets the whole dose move when the request is about the whole session", () => {
    const next = session([ex("face_pull", "Face pull", 2, 12), ex("chest_fly", "Chest fly", 2, 12), ex("dead_bug", "Dead bug", 2, 10)], { durationMin: 40 });
    const after = keepUntouched(before, next, "make it shorter, 40 minutes");
    expect(sessionChanges(before, after)).toEqual({ added: [], removed: ["Seated cable row"], changed: ["Face pull", "Dead bug"], kept: 1 });
  });

  it("changes the warm-up only when asked to", () => {
    const next = session(before.exercises, { warmup: ["10 min row"] });
    expect(keepUntouched(before, next, "a longer warm-up").warmup).toEqual(["10 min row"]);
    expect(keepUntouched(before, next, "swap the fly for push-ups").warmup).toEqual(["5 min easy bike"]);
  });
});
