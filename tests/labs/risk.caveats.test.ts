import { buildRiskReport, RiskProfile } from "../../src/services/labs_journey/domain/risk";
import { buildCurrentLabs, LabReportLike } from "../../src/utils/labBiomarkers";

const NOW = new Date("2026-09-16T00:00:00Z");

const profile = (over: Partial<RiskProfile> = {}): RiskProfile => ({
  age: 40,
  sex: "M",
  heightCm: 180,
  weightKg: 78,
  smoker: false,
  diabetic: false,
  parentalDiabetes: false,
  onBloodPressureTreatment: false,
  bloodPressure: { systolic: 118, diastolic: 76, source: "tracker", at: "2026-09-01T00:00:00Z" },
  ...over,
});

const report = (id: string, collectedAt: string, values: Record<string, [string, string]>): LabReportLike => ({
  id,
  createdAt: collectedAt,
  collectedAt,
  labResults: Object.entries(values).map(([testType, [result, units]], i) => ({
    id: `${id}-${i}`,
    category: "Blood",
    testType,
    referenceRange: "",
    isOutOfRange: false,
    result,
    units,
  })),
});

// Full PhenoAge + lipid + glucose panel, all measured recently.
const FRESH = report("r-new", "2026-08-01T00:00:00Z", {
  Albumin: ["4.4", "g/dL"],
  Creatinine: ["0.9", "mg/dL"],
  Glucose: ["88", "mg/dL"],
  CRP: ["0.8", "mg/L"],
  RDW: ["12.8", "%"],
  WBC: ["5.6", "K/uL"],
  MCV: ["90", "fL"],
  Lymphocytes: ["32", "%"],
  "Alkaline phosphatase": ["60", "U/L"],
  "Total cholesterol": ["180", "mg/dL"],
  HDL: ["55", "mg/dL"],
  Triglycerides: ["90", "mg/dL"],
});

describe("risk report caveats", () => {
  it("has no caveats when every input is recent and measured", () => {
    const r = buildRiskReport(profile(), buildCurrentLabs([FRESH]), NOW);
    expect(r.biologicalAge?.caveats).toEqual({ oldInputs: null, assumed: [] });
    expect(r.cardiovascular?.caveats).toEqual({ oldInputs: null, assumed: [] });
    expect(r.diabetes?.caveats).toEqual({ oldInputs: null, assumed: [] });
  });

  it("uses the latest value per biomarker and counts the ones older than 12 months", () => {
    // Newest panel lacks albumin and creatinine; those come from a 2-year-old report.
    const newest = report("r-new", "2026-08-01T00:00:00Z", {
      Glucose: ["88", "mg/dL"],
      CRP: ["0.8", "mg/L"],
      RDW: ["12.8", "%"],
      WBC: ["5.6", "K/uL"],
      MCV: ["90", "fL"],
      Lymphocytes: ["32", "%"],
      "Alkaline phosphatase": ["60", "U/L"],
      "Total cholesterol": ["180", "mg/dL"],
      HDL: ["55", "mg/dL"],
      Triglycerides: ["90", "mg/dL"],
    });
    const old = report("r-old", "2024-06-01T00:00:00Z", {
      Albumin: ["4.1", "g/dL"],
      Creatinine: ["1.0", "mg/dL"],
      Glucose: ["110", "mg/dL"], // superseded by the newer 88
    });
    const older = report("r-older", "2023-01-01T00:00:00Z", { Albumin: ["3.9", "g/dL"] });

    const labs = buildCurrentLabs([older, newest, old]);
    expect(labs.find((b) => b.key === "albumin")?.result).toBe("4.1");
    expect(labs.find((b) => b.key === "glucose")?.result).toBe("88");

    const r = buildRiskReport(profile(), labs, NOW);
    expect(r.biologicalAge?.caveats.oldInputs).toEqual({ count: 2, total: 9, oldestAt: "2024-06-01T00:00:00.000Z" });
    // Lipid and diabetes blocks only use fresh inputs.
    expect(r.cardiovascular?.caveats.oldInputs).toBeNull();
    expect(r.diabetes?.caveats.oldInputs).toBeNull();
  });

  it("flags assumed CRP and assumed blood pressure on the blocks that use them", () => {
    const noCrp = report("r-new", "2026-08-01T00:00:00Z", {
      Albumin: ["4.4", "g/dL"],
      Creatinine: ["0.9", "mg/dL"],
      Glucose: ["88", "mg/dL"],
      RDW: ["12.8", "%"],
      WBC: ["5.6", "K/uL"],
      MCV: ["90", "fL"],
      Lymphocytes: ["32", "%"],
      "Alkaline phosphatase": ["60", "U/L"],
      "Total cholesterol": ["180", "mg/dL"],
      HDL: ["55", "mg/dL"],
      Triglycerides: ["90", "mg/dL"],
    });
    const r = buildRiskReport(
      profile({ bloodPressure: { systolic: 120, diastolic: 80, source: "assumed", at: null } }),
      buildCurrentLabs([noCrp]),
      NOW
    );
    expect(r.biologicalAge?.caveats.assumed).toEqual(["CRP not measured — 1 mg/L assumed."]);
    expect(r.biologicalAge?.caveats.oldInputs).toBeNull(); // CRP is not counted as an input when assumed
    expect(r.cardiovascular?.caveats.assumed).toEqual(["Blood pressure assumed at 120/80 — no reading on record."]);
    expect(r.diabetes?.caveats.assumed).toEqual(["Blood pressure assumed at 120/80 — no reading on record."]);
  });

  it("counts LDL and triglycerides as the inputs when total cholesterol is derived", () => {
    const derived = report("r-new", "2026-08-01T00:00:00Z", { HDL: ["55", "mg/dL"], Triglycerides: ["90", "mg/dL"] });
    const oldLdl = report("r-old", "2024-01-01T00:00:00Z", { LDL: ["110", "mg/dL"] });
    const r = buildRiskReport(profile(), buildCurrentLabs([derived, oldLdl]), NOW);
    expect(r.cardiovascular?.caveats.assumed).toEqual(["Total cholesterol estimated from LDL, HDL and triglycerides."]);
    expect(r.cardiovascular?.caveats.oldInputs).toEqual({ count: 1, total: 3, oldestAt: "2024-01-01T00:00:00.000Z" });
  });
});

describe("risk report censored values", () => {
  const panel = (crp: [string, string] | null): LabReportLike =>
    report("r-new", "2026-08-01T00:00:00Z", {
      Albumin: ["4.4", "g/dL"],
      Creatinine: ["0.9", "mg/dL"],
      Glucose: ["88", "mg/dL"],
      RDW: ["12.8", "%"],
      WBC: ["5.6", "K/uL"],
      MCV: ["90", "fL"],
      Lymphocytes: ["32", "%"],
      "Alkaline phosphatase": ["60", "U/L"],
      "Total cholesterol": ["180", "mg/dL"],
      HDL: ["55", "mg/dL"],
      Triglycerides: ["90", "mg/dL"],
      ...(crp ? { CRP: crp } : {}),
    });

  it("treats CRP '<5 mg/L' as below detection, not as 5", () => {
    const r = buildRiskReport(profile(), buildCurrentLabs([panel(["<5", "mg/L"])]), NOW);
    expect(r.biologicalAge?.caveats.assumed).toEqual(["CRP reported as below 5 mg/L — 1 mg/L assumed."]);
    expect(r.biologicalAge?.drivers).not.toContain("CRP above 3 mg/L (inflammation) ages it.");
    const measured = buildRiskReport(profile(), buildCurrentLabs([panel(["1", "mg/L"])]), NOW);
    expect(r.biologicalAge?.phenotypicAge).toBe(measured.biologicalAge?.phenotypicAge);
  });

  it("uses half the limit when the hs assay's floor is below the default", () => {
    const r = buildRiskReport(profile(), buildCurrentLabs([panel(["<0.3", "mg/L"])]), NOW);
    expect(r.biologicalAge?.caveats.assumed).toEqual(["CRP reported as below 0.3 mg/L — 0.15 mg/L assumed."]);
  });

  it("reads CRP printed in mg/dL through the unit layer", () => {
    const r = buildRiskReport(profile(), buildCurrentLabs([panel(["0.4", "mg/dL"])]), NOW);
    expect(r.biologicalAge?.caveats.assumed).toEqual([]);
    expect(r.biologicalAge?.drivers).toContain("CRP above 3 mg/L (inflammation) ages it.");
  });

  it("lists a censored glucose as missing with the printed limit", () => {
    const rep = panel(null);
    rep.labResults.find((l) => l.testType === "Glucose")!.result = "<60";
    const r = buildRiskReport(profile(), buildCurrentLabs([rep]), NOW);
    expect(r.diabetes).toBeNull();
    expect(r.diabetesMissing).toEqual(["fasting glucose (report only says <60 mg/dL)"]);
  });
});
