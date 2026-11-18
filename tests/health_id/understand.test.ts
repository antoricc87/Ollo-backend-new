import {
  checkStory,
  emptyFacts,
  familyPayload,
  missingFacts,
  normalizeFacts,
  normalizeStory,
  unionNames,
  validBirthDate,
} from "../../src/services/health_id/domain/understand";

const TODAY = "2026-11-11";

describe("normalizeFacts", () => {
  it("keeps what fits the record", () => {
    const f = normalizeFacts(
      {
        birthDate: "1987-05-01", age: null, sex: "Male",
        height: { value: 70, unit: "in" }, weight: { value: 182.4, unit: "lb" },
        conditions: ["High cholesterol", "high cholesterol", " "], medications: [{ name: "Atorvastatin", dosage: "20 mg" }, { name: "atorvastatin", dosage: null }],
        allergies: ["Peanuts"], smoking: "Former smoker", alcohol: "Moderate", caffeine: "Heavy",
        activity: "Light exercise 1-2 times/week", lastPhysical: { status: "within_year", month: "2026-03" }, familyHistory: ["diabetes", "diabetes", "nonsense"],
      },
      TODAY
    );
    expect(f).toMatchObject({
      birthDate: "1987-05-01", sex: "Male", height: { value: 70, unit: "in" }, weight: { value: 182.4, unit: "lb" },
      conditions: ["High cholesterol"], medications: [{ name: "Atorvastatin", dosage: "20 mg" }], allergies: ["Peanuts"],
      smoking: "Former smoker", lastPhysical: { status: "within_year", month: "2026-03" }, familyHistory: ["diabetes"],
    });
  });

  it("drops values outside human ranges and words outside the vocabularies", () => {
    const f = normalizeFacts({ height: { value: 7, unit: "cm" }, weight: { value: 900, unit: "kg" }, sex: "M", smoking: "sometimes", activity: "Active" }, TODAY);
    expect(f.height).toBeNull();
    expect(f.weight).toBeNull();
    expect(f.sex).toBeNull();
    expect(f.smoking).toBeNull();
    expect(f.activity).toBeNull();
  });

  it("never turns an age into a birth date, and refuses impossible dates", () => {
    expect(normalizeFacts({ age: 39 }, TODAY)).toMatchObject({ age: 39, birthDate: null });
    expect(validBirthDate("1987-02-30", TODAY)).toBeNull();
    expect(validBirthDate("2027-01-01", TODAY)).toBeNull();
    expect(validBirthDate("1990-13-01", TODAY)).toBeNull();
    expect(validBirthDate("15/03/1990", TODAY)).toBeNull();
  });

  it("keeps a physical month only for 'within a year' and never in the future", () => {
    expect(normalizeFacts({ lastPhysical: { status: "over_year", month: "2024-01" } }, TODAY).lastPhysical).toEqual({ status: "over_year", month: null });
    expect(normalizeFacts({ lastPhysical: { status: "within_year", month: "2027-01" } }, TODAY).lastPhysical).toEqual({ status: "within_year", month: null });
  });

  it("keeps a plain name and refuses anything else", () => {
    expect(normalizeFacts({ firstName: "Marco", lastName: "D'Angelo-Rossi" }, TODAY)).toMatchObject({ firstName: "Marco", lastName: "D'Angelo-Rossi" });
    expect(normalizeFacts({ firstName: "<script>", lastName: "x".repeat(80) }, TODAY)).toMatchObject({ firstName: null, lastName: null });
  });

  it("survives junk", () => {
    expect(normalizeFacts(null, TODAY)).toEqual(emptyFacts());
    expect(normalizeFacts({ conditions: "x", medications: [null, {}] }, TODAY)).toEqual(emptyFacts());
  });
});

describe("missingFacts", () => {
  it("counts what was heard or is already on record", () => {
    const f = { ...emptyFacts(), sex: "Female" as const, height: { value: 165, unit: "cm" as const } };
    expect(missingFacts(f)).toEqual(["birthDate", "weight"]);
    expect(missingFacts(f, { weight: true, birthDate: true })).toEqual([]);
  });
});

describe("checkStory", () => {
  it("refuses the first person", () => {
    expect(checkStory({ wants: "I want to lower my LDL" })).toMatch(/first person/);
    expect(checkStory({ wants: "Wants to lower LDL before the next physical" })).toBe(true);
  });
  it("refuses an addition that lost what was there", () => {
    const before = { constraints: "Busy weekdays; travels for work twice a month" };
    expect(checkStory({ constraints: "Knee injury" }, before)).toMatch(/dropped/);
    expect(checkStory({}, before)).toMatch(/dropped/);
    expect(checkStory({ constraints: "Busy weekdays; travels for work twice a month; knee injury, no running" }, before)).toBe(true);
  });
});

describe("normalizeStory", () => {
  it("keeps known sections, trimmed", () => {
    expect(normalizeStory({ focus: "  Heart   health ", nope: "x", wants: null })).toEqual({ focus: "Heart health" });
  });
});

describe("to the record", () => {
  it("merges family history onto what is there", () => {
    const p = familyPayload({ id: "x", patientSummaryId: "y", historyOfCancer: ["lung cancer"], historyOfStroke: true }, ["colorectalCancer", "diabetes", "earlyHeartDisease"]);
    expect(p.historyOfCancer).toEqual(["lung cancer", "colorectal cancer"]);
    expect(p.historyOfChronicConditions).toEqual(["diabetes"]);
    expect(p.historyOfStroke).toBe(true);
    expect(p.historyOfHeartAttack).toBe(true);
    expect((p as any).id).toBeUndefined();
  });
  it("adds names without duplicates, keeping the record's spelling", () => {
    expect(unionNames(["Hypertension"], ["hypertension", "Asthma"])).toEqual(["Hypertension", "Asthma"]);
  });
});
