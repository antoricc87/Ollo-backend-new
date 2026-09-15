import { buildLabReportSummary, SummaryEntry } from "../../src/services/lab_extraction/reportSummary";

const entry = (over: Partial<SummaryEntry>): SummaryEntry => ({
  testType: "Glucose",
  result: "88",
  units: "mg/dL",
  referenceRange: "70-99",
  isOutOfRange: false,
  ...over,
});

// Words that turn a factual summary into a clinical judgement or advice.
const BANNED = /\b(recommend\w*|healthy|unhealthy|normal|abnormal\w*|suggest\w*|diagnos\w*|should|need(s)?|due|concern\w*|risk|deficien\w*|diet|exercise)\b/i;

describe("buildLabReportSummary", () => {
  it("is empty when there are no entries", () => {
    expect(buildLabReportSummary([])).toBe("");
    expect(buildLabReportSummary(null)).toBe("");
  });

  it("states that every value is inside the printed ranges", () => {
    const text = buildLabReportSummary([entry({}), entry({ testType: "CRP", result: "0.4" })]);
    expect(text).toBe("All 2 measured values are inside the reference ranges printed on this report.");
  });

  it("lists flagged values with their printed range and refers to the clinician", () => {
    const text = buildLabReportSummary([
      entry({}),
      entry({ testType: "LDL", result: "162", referenceRange: "<100", isOutOfRange: true }),
    ]);
    expect(text).toContain("1 of 2 values are outside the reference range printed on this report: LDL 162 mg/dL (range <100).");
    expect(text).toContain("Your clinician can explain");
  });

  it("caps the list and counts the rest", () => {
    const flagged = Array.from({ length: 9 }, (_, i) => entry({ testType: `Test ${i}`, isOutOfRange: true }));
    const text = buildLabReportSummary(flagged);
    expect(text).toContain("Test 5 88 mg/dL (range 70-99); and 3 more.");
    expect(text).not.toContain("Test 6");
  });

  it("mentions values marked for a check", () => {
    const text = buildLabReportSummary([entry({ needsReview: true })]);
    expect(text).toContain("1 value is marked to check against the original PDF.");
  });

  it("never uses judgement or advice words", () => {
    const cases: SummaryEntry[][] = [
      [entry({})],
      [entry({}), entry({ testType: "HbA1c", result: "6.1", units: "%", referenceRange: "4.8-5.6", isOutOfRange: true, needsReview: true })],
      Array.from({ length: 12 }, (_, i) => entry({ testType: `Marker ${i}`, isOutOfRange: i % 2 === 0, referenceRange: i % 3 ? "70-99" : "" })),
    ];
    for (const c of cases) expect(buildLabReportSummary(c)).not.toMatch(BANNED);
  });
});
