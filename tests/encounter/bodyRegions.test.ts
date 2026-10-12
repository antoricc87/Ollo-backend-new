import fs from "fs";
import path from "path";
import { lintOutput } from "../../src/services/agent/safety/lint";
import { BODY_REGIONS, bodyFor, MAX_REGIONS, regionsKey, regionsLine, sanitizeRegions } from "../../src/services/encounter/domain/bodyRegions";
import { resolveProtocol } from "../../src/services/encounter/domain/protocols";
import { nextStep } from "../../src/services/encounter/domain/stateMachine";
import { recapLines } from "../../src/services/encounter/domain/summary";
import { emptyState } from "../../src/services/encounter/domain/types";

const ids = Object.keys(BODY_REGIONS);
const inView = (view: "front" | "back") => ids.filter((id) => BODY_REGIONS[id].views.indexOf(view) >= 0);

describe("the body map's region catalogue", () => {
  it("is the mockup's figure: 41 regions on the front, 31 on the back, 62 keys in all", () => {
    expect(inView("front")).toHaveLength(41);
    expect(inView("back")).toHaveLength(31);
    expect(ids).toHaveLength(62);
  });

  /** The drawing and the catalogue are two files; a key in one and not the other is a region nobody can tap or nobody can name. */
  it("matches the traced figure key for key", () => {
    const file = path.resolve(__dirname, "../../../docs/body-map/regions.json");
    if (!fs.existsSync(file)) return; // the docs folder is outside this repo
    const drawn = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const view of ["front", "back"] as const) expect(drawn[view].map((r: any) => r.id).sort()).toEqual(inView(view).sort());
  });

  it("names each side for the person, not the viewer", () => {
    expect(BODY_REGIONS.eye_r.label).toBe("Right eye");
    expect(BODY_REGIONS.lower_back_l.label).toBe("Lower back (left)");
    expect(new Set(ids.map((id) => BODY_REGIONS[id].label)).size).toBe(ids.length);
  });
});

describe("which questions show the figure", () => {
  const shown: [string, string][] = [["chest_discomfort", "location"], ["headache", "location"], ["abdominal_pain", "location"], ["back_pain", "location"], ["rash", "location"], ["joint_pain", "which_joints"]];

  it.each(shown)("%s · %s is a real question and gets the figure", (protocolKey, slotKey) => {
    expect(resolveProtocol(protocolKey).slots.some((s) => s.key === slotKey)).toBe(true);
    expect(bodyFor(protocolKey, slotKey)?.regions).toHaveLength(62);
  });

  /** Ruling Oct 9 2026: the place is asked first, so later questions can be put about it. */
  it.each(shown)("%s asks where straight after the warning-sign question", (protocolKey, slotKey) => {
    const protocol = resolveProtocol(protocolKey);
    const state = emptyState(protocolKey, "it hurts", protocol.version);
    const first = nextStep(state, protocol);
    expect(first.kind === "ask" && first.phase).toBe("SAFETY_SCREEN");
    if (first.kind !== "ask") return;
    const after = nextStep({ ...state, slots: { [first.slot.key]: ["none_of_these"] } }, protocol);
    expect(after.kind === "ask" && after.slot.key).toBe(slotKey);
  });

  it("never shows it for a complaint with no place, or for any other question", () => {
    for (const key of ["cough_fever", "breathlessness", "fatigue", "dizziness", "low_mood", "general_unwell"]) for (const slot of resolveProtocol(key).slots) expect(bodyFor(key, slot.key)).toBeNull();
    expect(bodyFor("back_pain", "onset")).toBeNull();
    expect(bodyFor("back_pain", "severity")).toBeNull();
  });

  it("opens the back for back pain and zooms the head for a headache", () => {
    expect(bodyFor("back_pain", "location")).toMatchObject({ view: "back", focus: "torso" });
    expect(bodyFor("headache", "location")).toMatchObject({ view: "front", focus: "head" });
  });
});

describe("what was tapped", () => {
  it("keeps known keys once each, in order, and drops the rest", () => {
    expect(sanitizeRegions(["lower_back_l", "nonsense", "buttock_l", "lower_back_l", 7, null])).toEqual(["lower_back_l", "buttock_l"]);
    expect(sanitizeRegions("lower_back_l")).toEqual([]);
    expect(sanitizeRegions(ids)).toHaveLength(MAX_REGIONS);
  });

  it("is restated on the summary as marked on a diagram, beside the answer in words", () => {
    const protocol = resolveProtocol("back_pain");
    const state = emptyState("back_pain", "my back hurts", protocol.version);
    state.slots.location = "lower_back";
    state.slots[regionsKey("location")] = ["lower_back_l", "buttock_l"];
    const line = recapLines(state, protocol).find((l) => l.question === "Where in your back?");
    expect(line?.answer).toBe("Lower back. Marked on the body diagram: Lower back (left), Left buttock");
  });

  it("still appears when the words never settled the question", () => {
    const protocol = resolveProtocol("back_pain");
    const state = emptyState("back_pain", "my back hurts", protocol.version);
    state.slots[regionsKey("location")] = ["neck_back"];
    expect(recapLines(state, protocol).find((l) => l.question === "Where in your back?")?.answer).toBe("Marked on the body diagram: Back of neck");
  });

  it("says nothing the output guard forbids", () => {
    expect(lintOutput(`Where is it? Marked on the body diagram: ${regionsLine(ids)}.`)).toEqual([]);
  });
});

describe("Ollie's own follow-up questions", () => {
  const { addOwnQuestions, MAX_OWN_QUESTIONS, ownQuestions, ownQuestionsLeft } = require("../../src/services/encounter/domain/ownQuestions");
  const protocol = resolveProtocol("abdominal_pain");
  const base = () => emptyState("abdominal_pain", "my stomach hurts", protocol.version);

  it("keeps the question and the answer, in order, and prints both on the summary", () => {
    const { state, added } = addOwnQuestions(base(), [{ question: "Does it hurt more when you walk or cough?", answer: "Yes, when I walk" }]);
    expect(added).toHaveLength(1);
    expect(ownQuestions(state)).toEqual([{ question: "Does it hurt more when you walk or cough?", answer: "Yes, when I walk" }]);
    expect(recapLines(state, protocol).pop()).toEqual({ question: "Does it hurt more when you walk or cough?", answer: "Yes, when I walk" });
  });

  it("stops at the cap, skips a repeat and ignores an empty answer", () => {
    let state = base();
    for (let i = 0; i < MAX_OWN_QUESTIONS + 3; i++) state = addOwnQuestions(state, [{ question: `Question ${i}?`, answer: "yes" }]).state;
    expect(ownQuestions(state)).toHaveLength(MAX_OWN_QUESTIONS);
    expect(ownQuestionsLeft(state)).toBe(0);
    const one = addOwnQuestions(base(), [{ question: "Any nausea?", answer: "a bit" }]).state;
    expect(addOwnQuestions(one, [{ question: "any nausea?", answer: "no" }, { question: "Appetite?", answer: " " }]).added).toHaveLength(0);
  });

  it("does not count as one of the protocol's questions", () => {
    const { state } = addOwnQuestions(base(), [{ question: "Any nausea?", answer: "a bit" }]);
    expect(nextStep(state, protocol).kind).toBe("ask");
  });
});

describe("which question a message asked", () => {
  const { questionAsked } = require("../../src/services/encounter/domain/ownQuestions");
  it("takes the last question, without the markdown", () => {
    expect(questionAsked("Thanks — I've got the severity as **6/10**.\n\nHave you had **nausea or vomiting** along with the pain in your lower right abdomen?")).toBe("Have you had nausea or vomiting along with the pain in your lower right abdomen?");
    expect(questionAsked("Is it sharp? Or does it feel more like a dull ache when you walk?")).toBe("Or does it feel more like a dull ache when you walk?");
  });
  it("finds none in a statement", () => {
    expect(questionAsked("Got it, I've noted that.")).toBeNull();
    expect(questionAsked(null)).toBeNull();
  });
});
