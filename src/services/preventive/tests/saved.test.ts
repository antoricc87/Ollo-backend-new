import type { ScreeningProfile } from "../../labs_journey/domain/screening.rules";
import { buildPlan } from "../domain/plan";
import { checkWords, fallbackWords, reconcile, wordsKey } from "../domain/saved";

/** The saved plan (P1, pure part): reconcile with what is stored, words only when items move. */

const profile = (over: Partial<ScreeningProfile> = {}): ScreeningProfile => ({
  age: 39, sex: "male", bmi: 24, smoking: "never", conditions: [], medications: [], diet: [],
  family: { breastOrOvarianCancer: false, colorectalCancer: false, prostateCancer: false, diabetes: false, earlyHeartDisease: false, highCholesterol: true, osteoporosis: false },
  pregnant: false, ...over,
});

describe("reconcile", () => {
  const computed = buildPlan(profile());

  it("a fresh plan holds every rule item, as the rules say", () => {
    const { rows } = reconcile(computed, []);
    expect(rows.find((r) => r.key === "colorectal")?.status).toBe("coming");
    expect(rows.every((r) => r.addedBy === "rules")).toBe(true);
  });

  it("an optional test the person added stays, in its own type", () => {
    const { rows } = reconcile(computed, [{ key: "cac", type: "diagnostic", status: "added", addedBy: "person", snapshot: {} }]);
    const cac = rows.find((r) => r.key === "cac");
    expect(cac).toMatchObject({ type: "diagnostic", status: "added", addedBy: "person" });
    expect((cac?.snapshot as any).whyOptional).toMatch(/Not a screening test/);
  });

  it("when the rules later include an added test, the rules' version wins", () => {
    const at45 = buildPlan(profile({ age: 46 }));
    const { rows } = reconcile(at45, [{ key: "colorectal", type: "procedure", status: "added", addedBy: "person", snapshot: {} }]);
    expect(rows.filter((r) => r.key === "colorectal")).toHaveLength(1);
    expect(rows.find((r) => r.key === "colorectal")?.status).toBe("planned");
  });

  it("a rule item no longer produced is dropped; a removed catalog test too", () => {
    const { rows } = reconcile(computed, [
      { key: "mammography", type: "diagnostic", status: "planned", addedBy: "rules", snapshot: {} },
      { key: "not_a_test", type: "lab", status: "added", addedBy: "person", snapshot: {} },
    ]);
    expect(rows.map((r) => r.key)).not.toContain("mammography");
    expect(rows.map((r) => r.key)).not.toContain("not_a_test");
  });

  it("coming → planned at the age changes the words key; a re-read without change does not", () => {
    const a = wordsKey(reconcile(buildPlan(profile({ age: 44 })), []).rows);
    const b = wordsKey(reconcile(buildPlan(profile({ age: 44 })), []).rows);
    const c = wordsKey(reconcile(buildPlan(profile({ age: 45 })), []).rows);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("the words", () => {
  const rows = reconcile(buildPlan(profile()), []).rows;

  it("the code's own words are never empty and name what is coming", () => {
    const w = fallbackWords(rows);
    expect(w.headline).toMatch(/items in your plan, \d+ lab tests in one blood draw\. Coming up: colon cancer screening\./);
    expect(Object.keys(w.groups)).toEqual(["lab", "procedure", "vaccine", "check"]);
  });

  it("the model's words are refused when they give a verdict or say 'due'", () => {
    const groups = { lab: "One blood draw covers your heart, sugar and liver tests.", procedure: "Colon screening starts at 45.", vaccine: "Two shots at a pharmacy.", check: "Measured at any visit." };
    expect(checkWords({ headline: "Your plan for this year: one blood draw, two vaccines.", groups }, ["lab", "procedure", "vaccine", "check"])).toBe(true);
    expect(checkWords({ headline: "You are due for a cholesterol test and two vaccines.", groups }, ["lab"])).toBe("headline wording");
    expect(checkWords({ headline: "Your plan for this year: one blood draw, two vaccines.", groups: { ...groups, lab: "" } }, ["lab"])).toBe("group lab");
  });
});
