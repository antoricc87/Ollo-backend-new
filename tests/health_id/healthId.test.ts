import {
  applyEdits,
  factsSummary,
  parseStory,
  renderForAgent,
  renderHealthId,
  type HealthFacts,
} from "../../src/services/health_id/domain/healthId";

const facts = (over: Partial<HealthFacts> = {}): HealthFacts => ({
  age: 39,
  sex: "Male",
  height: { value: 180, unit: "cm" },
  weight: { value: 82, unit: "kg" },
  conditions: ["High cholesterol"],
  medications: ["Atorvastatin 20 mg"],
  allergies: [],
  smoking: "Never",
  alcohol: "Prefer not to say",
  activity: "Light exercise 1-2 times/week",
  lastPhysical: { status: "within_year", at: "2026-03-10T00:00:00.000Z" },
  familyHistory: ["diabetes"],
  ...over,
});

const empty: HealthFacts = {
  age: null, sex: null, height: null, weight: null, conditions: [], medications: [], allergies: [],
  smoking: null, alcohol: null, activity: null, lastPhysical: null, familyHistory: [],
};

const NOW = new Date("2026-11-11T10:00:00Z");

describe("factsSummary", () => {
  it("reads the record in the third person", () => {
    expect(factsSummary(facts())).toBe(
      "39-year-old man, 180 cm, 82 kg. Conditions on record: High cholesterol. Takes Atorvastatin 20 mg. " +
        "Doesn't smoke, exercises 1–2 times a week. Last physical: March 2026. Family history: diabetes."
    );
  });

  it("never writes in the first person", () => {
    expect(factsSummary(facts())).not.toMatch(/\b(I|I'm|my|me)\b/);
  });

  it("leaves out what was not said, including 'prefer not to say'", () => {
    const s = factsSummary(facts({ conditions: [], medications: [], familyHistory: [], lastPhysical: null }))!;
    expect(s).not.toMatch(/alcohol|Conditions|Takes|Family|physical/);
  });

  it("is null when nothing is known", () => {
    expect(factsSummary(empty)).toBeNull();
  });

  it("covers the other physical answers and joins lists", () => {
    expect(factsSummary({ ...empty, lastPhysical: { status: "over_year", at: null } })).toBe("Last physical: more than a year ago.");
    expect(factsSummary({ ...empty, lastPhysical: { status: "never", at: null } })).toBe("Has not had a physical.");
    expect(factsSummary({ ...empty, allergies: ["Peanuts", "Shellfish", "Dairy"] })).toBe("Allergic to Peanuts, Shellfish and Dairy.");
    expect(factsSummary({ ...empty, sex: "Female", age: 52 })).toBe("52-year-old woman.");
  });
});

describe("parseStory", () => {
  it("keeps known sections and drops junk", () => {
    const s = parseStory({ wants: { text: "  lose   weight ", by: "onboarding", updatedAt: "x" }, nope: { text: "a" }, focus: { text: "" }, worries: 3 });
    expect(Object.keys(s)).toEqual(["wants"]);
    expect(s.wants!.text).toBe("lose weight");
  });
  it("tolerates null and non-objects", () => {
    expect(parseStory(null)).toEqual({});
    expect(parseStory("x")).toEqual({});
  });
});

describe("applyEdits", () => {
  it("writes, versions nothing on a no-op, and removes on empty text", () => {
    const a = applyEdits({}, [{ key: "wants", text: "Lower LDL before next physical" }], "onboarding", NOW);
    expect(a.changes).toEqual([{ section: "wants", before: null, after: "Lower LDL before next physical", reason: null }]);
    const same = applyEdits(a.story, [{ key: "wants", text: "Lower LDL before next physical" }], "person", NOW);
    expect(same.changes).toEqual([]);
    const gone = applyEdits(a.story, [{ key: "wants", text: "  " }], "person", NOW);
    expect(gone.story.wants).toBeUndefined();
    expect(gone.changes[0]).toMatchObject({ before: "Lower LDL before next physical", after: null });
  });

  it("never lets Ollie overwrite what the person wrote last", () => {
    const mine = applyEdits({}, [{ key: "coaching", text: "Short and direct" }], "person", NOW).story;
    const r = applyEdits(mine, [{ key: "coaching", text: "Gentle" }, { key: "focus", text: "Heart health" }], "ollie", NOW);
    expect(r.story.coaching!.text).toBe("Short and direct");
    expect(r.held).toEqual([{ key: "coaching", text: "Gentle" }]);
    expect(r.story.focus).toMatchObject({ text: "Heart health", by: "ollie" });
  });

  it("lets Ollie update its own or onboarding text", () => {
    const s = applyEdits({}, [{ key: "constraints", text: "Busy weekdays" }], "onboarding", NOW).story;
    const r = applyEdits(s, [{ key: "constraints", text: "Busy weekdays; knee injury, no running" }], "ollie", NOW);
    expect(r.held).toEqual([]);
    expect(r.story.constraints!.by).toBe("ollie");
  });
});

describe("rendering", () => {
  it("orders sections and marks an untold story", () => {
    const story = applyEdits({}, [{ key: "success", text: "Off statins" }, { key: "focus", text: "Heart health" }], "onboarding", NOW).story;
    const r = renderHealthId(facts(), story);
    expect(r.sections.map((s) => s.key)).toEqual(["focus", "success"]);
    expect(renderHealthId(facts(), {}).storyEmpty).toBe(true);
  });

  it("gives Ollie the same content the person sees", () => {
    const story = applyEdits({}, [{ key: "wants", text: "Lower LDL" }], "onboarding", NOW).story;
    const text = renderForAgent(renderHealthId(facts(), story))!;
    expect(text).toContain("39-year-old man");
    expect(text).toContain("wants from ollo: Lower LDL");
    expect(renderForAgent(renderHealthId(facts(), {}))).not.toContain("not told");
    expect(renderForAgent(renderHealthId(empty, {}))).toBeNull();
  });
});
