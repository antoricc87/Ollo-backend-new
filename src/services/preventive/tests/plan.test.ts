import type { ScreeningProfile } from "../../labs_journey/domain/screening.rules";
import { coverageOf, TAG } from "../domain/coverage";
import { OPTIONAL } from "../domain/optional";
import { buildPlan } from "../domain/plan";
import { buildVaccines } from "../domain/vaccines";

/** The preventive plan (P0): rules → typed, covered, explained items; vaccines; every other test as optional. */

const profile = (over: Partial<ScreeningProfile> = {}): ScreeningProfile => ({
  age: 39,
  sex: "male",
  bmi: 24.6,
  smoking: "never",
  conditions: [],
  medications: [],
  diet: [],
  family: { breastOrOvarianCancer: false, colorectalCancer: false, prostateCancer: false, diabetes: false, earlyHeartDisease: false, highCholesterol: false, osteoporosis: false },
  pregnant: false,
  ...over,
});

const keysOf = (plan: ReturnType<typeof buildPlan>) => plan.groups.flatMap((g) => g.items.map((i) => i.key));
const item = (plan: ReturnType<typeof buildPlan>, key: string) => plan.groups.flatMap((g) => g.items).find((i) => i.key === key);

describe("his profile: man, 39, family history of high cholesterol", () => {
  const plan = buildPlan(profile({ family: { ...profile().family, highCholesterol: true } }));

  it("groups by type, in order, empty groups hidden", () => {
    expect(plan.groups.map((g) => g.type)).toEqual(["lab", "procedure", "vaccine", "check"]);
  });
  it("cholesterol and Lp(a) carry the family history", () => {
    expect(item(plan, "lipid_panel")?.tags[0]).toEqual({ key: "family", text: "Family history" });
    expect(item(plan, "lipoprotein_a")?.tags.map((t) => t.text)).toEqual(["Family history", "Once"]);
  });
  it("colon screening is coming from 45, not now", () => {
    expect(item(plan, "colorectal")).toMatchObject({ status: "coming", tags: [{ key: "coming", text: "From 45" }] });
  });
  it("no mammogram, cervical or PSA for a man of 39", () => {
    expect(keysOf(plan)).not.toEqual(expect.arrayContaining(["mammography"]));
    expect(keysOf(plan)).not.toContain("cervical");
    expect(keysOf(plan)).not.toContain("psa");
  });
  it("optional tests related to the family history come first", () => {
    expect(plan.optional.slice(0, 3).map((o) => o.key)).toEqual(expect.arrayContaining(["cac", "apob", "hscrp"]));
    expect(plan.optional.find((o) => o.key === "cac")?.tags).toEqual([{ key: "family", text: "Family history" }]);
  });
  it("never offers as optional what the plan already has, nor a test for the other sex", () => {
    const opt = plan.optional.map((o) => o.key);
    expect(opt).not.toContain("colon_early"); // colorectal is coming
    expect(opt).not.toContain("female_hormones");
    expect(opt).not.toContain("breast_mri");
    expect(opt).toContain("testosterone");
  });
});

describe("woman, 45", () => {
  const plan = buildPlan(profile({ age: 45, sex: "female", bmi: 23 }));
  it("mammogram and Pap/HPV are diagnostics, colon screening a procedure, now", () => {
    expect(item(plan, "mammography")?.type).toBe("diagnostic");
    expect(item(plan, "cervical")?.type).toBe("diagnostic");
    expect(item(plan, "colorectal")).toMatchObject({ type: "procedure", status: "planned" });
  });
  it("HPV vaccine is a decision to discuss at 45; shingles is coming at 50", () => {
    expect(item(plan, "hpv")?.priority).toBe("DISCUSS");
    expect(item(plan, "shingles")?.status).toBe("coming");
  });
});

describe("up to date: last done → next due (Nov 19 2026)", () => {
  const today = "2026-11-19";
  it("a lab done 5 months ago is up to date until a year after it", () => {
    const plan = buildPlan(profile(), { today, last: { lipid_panel: { on: "2026-06-10", source: "lab", outcome: "normal", flagged: [] } } });
    expect(keysOf(plan)).not.toContain("lipid_panel");
    const lipid = plan.upToDate.find((i) => i.key === "lipid_panel")!;
    expect(lipid.nextDue).toBe("2027-06-10");
    expect(lipid.cadence?.from).toBe("plan");
  });
  it("a lab done 14 months ago is due again (labs: once a year)", () => {
    const plan = buildPlan(profile(), { today, last: { lipid_panel: { on: "2025-09-01", source: "lab", outcome: "normal", flagged: [] } } });
    expect(keysOf(plan)).toContain("lipid_panel");
  });
  it("a result outside its range brings it back in 6 months, and says why", () => {
    const plan = buildPlan(profile(), { today, last: { lipid_panel: { on: "2026-10-01", source: "lab", outcome: "findings", flagged: ["LDL cholesterol"] } } });
    const lipid = plan.upToDate.find((i) => i.key === "lipid_panel")!;
    expect(lipid.nextDue).toBe("2027-04-01");
    expect(lipid.cadence).toMatchObject({ months: 6, from: "result", reason: "LDL cholesterol was outside the range last time" });
  });
  it("a once-only test done years ago never comes back", () => {
    const plan = buildPlan(profile(), { today, last: { hiv: { on: "2019-03-01", source: "lab", outcome: "normal", flagged: [] } } });
    expect(plan.upToDate.find((i) => i.key === "hiv")).toMatchObject({ nextDue: null, cadence: { months: null } });
  });
  it("a normal colonoscopy: 10 years; one with findings: 3", () => {
    const at50 = profile({ age: 50 });
    const normal = buildPlan(at50, { today, last: { colorectal: { on: "2022-03-01", source: "person", outcome: "normal" } } });
    expect(normal.upToDate.find((i) => i.key === "colorectal")?.nextDue).toBe("2032-03-01");
    const findings = buildPlan(at50, { today, last: { colorectal: { on: "2022-03-01", source: "person", outcome: "findings" } } });
    expect(keysOf(findings)).toContain("colorectal"); // 2025-03 has passed: due again
  });
  it("their own interval wins over the plan's and a result's", () => {
    const plan = buildPlan(profile({ sex: "female", age: 45 }), { today, last: { mammography: { on: "2026-01-15", source: "booking", outcome: "normal" } }, cadence: { mammography: 12 } });
    expect(plan.upToDate.find((i) => i.key === "mammography")).toMatchObject({ nextDue: "2027-01-15", cadence: { months: 12, from: "you" } });
  });
  it("done at an unknown date: still in the plan, so they can say when", () => {
    const plan = buildPlan(profile({ age: 50 }), { today, last: { colorectal: { on: null, source: "record", outcome: "unknown" } } });
    expect(plan.groups.flatMap((g) => g.items).find((i) => i.key === "colorectal")?.last).toMatchObject({ on: null, source: "record" });
  });
});

describe("coverage: ACA from the source, not the name", () => {
  it("USPSTF A/B and ACIP vaccines are covered; grade C, I or a society are not", () => {
    expect(coverageOf("lab", { org: "USPSTF", year: 2019, grade: "A" }).tag).toBe(TAG);
    expect(coverageOf("vaccine", { org: "CDC · ACIP adult schedule", year: 2025 }).aca).toBe(true);
    expect(coverageOf("lab", { org: "USPSTF", year: 2018, grade: "C" }).aca).toBe(false);
    expect(coverageOf("lab", { org: "National Lipid Association", year: 2024 }).aca).toBe(false);
  });
});

describe("vaccines (ACIP)", () => {
  const keys = (over: Partial<ScreeningProfile>) => buildVaccines(profile(over)).map((v) => v.key);
  it("everyone: flu, tetanus, COVID (as a decision)", () => {
    expect(keys({ age: 30 })).toEqual(expect.arrayContaining(["flu", "tdap", "covid"]));
  });
  it("50+: shingles and pneumococcal; 75+: RSV", () => {
    expect(keys({ age: 52 })).toEqual(expect.arrayContaining(["shingles", "pneumococcal"]));
    expect(keys({ age: 52 })).not.toContain("rsv");
    expect(keys({ age: 76 })).toContain("rsv");
  });
  it("younger with a risk condition: pneumococcal from 19; RSV from 50", () => {
    expect(keys({ age: 30, conditions: ["type 2 diabetes"] })).toContain("pneumococcal");
    expect(keys({ age: 55, conditions: ["copd"] })).toContain("rsv");
  });
  it("HPV through 26 is planned; hepatitis B 19–59; pregnancy adds RSV", () => {
    expect(buildVaccines(profile({ age: 24 })).find((v) => v.key === "hpv")?.priority).toBe("DUE");
    expect(keys({ age: 62 })).not.toContain("hepatitis_b");
    expect(keys({ age: 30, sex: "female", pregnant: true })).toContain("rsv_pregnancy");
  });
  it("never says 'due'", () => {
    for (const v of buildVaccines(profile({ age: 70, conditions: ["diabetes"] }))) expect(v.why.toLowerCase()).not.toMatch(/\bdue\b|you need|you should/);
  });
});

describe("the optional catalog", () => {
  it("every test says what it checks, why it is optional, how, and a directional price", () => {
    for (const o of OPTIONAL) {
      expect(o.checks.length).toBeGreaterThan(10);
      expect(o.whyOptional.length).toBeGreaterThan(30);
      expect(o.how.length).toBeGreaterThan(5);
      expect(o.price).toMatch(/^Often \$/);
      expect(o.whyOptional.toLowerCase()).not.toMatch(/you need|you should|recommended for you/);
    }
  });
  it("keys are unique", () => {
    expect(new Set(OPTIONAL.map((o) => o.key)).size).toBe(OPTIONAL.length);
  });
});
