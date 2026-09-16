import { canonicalise, convertRange, normaliseUnit, parseResult } from "../../src/utils/labUnits";
import { buildCurrentLabs, LabReportLike } from "../../src/utils/labBiomarkers";

describe("normaliseUnit", () => {
  it("folds count spellings into K/µL and M/µL", () => {
    for (const u of ["Thousand/uL", "x10E3/uL", "10^3/µL", "K/uL", "x10^9/L", "10*9/L", "migliaia/uL"]) expect(normaliseUnit(u)).toBe("K/µL");
    for (const u of ["Million/uL", "x10E6/uL", "10^12/L", "M/uL"]) expect(normaliseUnit(u)).toBe("M/µL");
  });
  it("folds enzyme and hormone spellings", () => {
    expect(normaliseUnit("IU/L")).toBe("U/L");
    expect(normaliseUnit("uIU/mL")).toBe("mIU/L");
    expect(normaliseUnit("mIU/L")).toBe("mIU/L");
    expect(normaliseUnit("mL/min/1.73m2")).toBe("mL/min/1.73m²");
  });
  it("passes unknown spellings through and blanks to null", () => {
    expect(normaliseUnit("/HPF")).toBe("/HPF");
    expect(normaliseUnit("")).toBeNull();
    expect(normaliseUnit(null)).toBeNull();
  });
});

describe("parseResult", () => {
  it("reads plain, comma-decimal and censored values", () => {
    expect(parseResult("5.1")).toEqual({ value: 5.1, censored: null });
    expect(parseResult("1,015")).toEqual({ value: 1.015, censored: null });
    expect(parseResult("<0.5")).toEqual({ value: 0.5, censored: "<" });
    expect(parseResult("> 60")).toEqual({ value: 60, censored: ">" });
    expect(parseResult("NEGATIVE")).toEqual({ value: null, censored: null });
  });
});

describe("canonicalise", () => {
  it("converts glucose mmol/L → mg/dL with its range and keeps the printed original", () => {
    const c = canonicalise("glucose", "5.2", "mmol/L", "3.9-6.1");
    expect(c.result).toBe("94");
    expect(c.units).toBe("mg/dL");
    expect(c.referenceRange).toBe("70-110");
    expect(c.converted).toBe(true);
    expect(c.printed).toEqual({ result: "5.2", units: "mmol/L", referenceRange: "3.9-6.1" });
  });
  it("converts cholesterol, creatinine, albumin, CRP, vitamin D, HbA1c", () => {
    expect(canonicalise("tcl", "5.6", "mmol/L", "<5.2 mmol/L").result).toBe("217");
    expect(canonicalise("tcl", "5.6", "mmol/L", "<5.2 mmol/L").referenceRange).toBe("<201");
    expect(canonicalise("creatinine", "80", "umol/L", "60-110").result).toBe("0.9");
    expect(canonicalise("creatinine", "80", "umol/L", "60-110").referenceRange).toBe("0.68-1.24");
    expect(canonicalise("albumin", "42", "g/L", "35-50").result).toBe("4.2");
    expect(canonicalise("albumin", "42", "g/L", "35-50").referenceRange).toBe("3.5-5");
    expect(canonicalise("crp", "0.3", "mg/dL", "<0.5").result).toBe("3");
    expect(canonicalise("vitamin d", "75", "nmol/L", "50-125").result).toBe("30");
    expect(canonicalise("hba1c", "42", "mmol/mol", "20-42").result).toBe("6");
  });
  it("converts absolute counts in cells/µL to K/µL", () => {
    const c = canonicalise("neutrophils absolute", "8262", "cells/uL", "1500-7800");
    expect(c.result).toBe("8.3");
    expect(c.units).toBe("K/µL");
    expect(c.referenceRange).toBe("1.5-7.8");
  });
  it("keeps a censored prefix through conversion", () => {
    const c = canonicalise("crp", "<0.5", "mg/dL", "<0.5");
    expect(c.result).toBe("<5");
    expect(c.censored).toBe("<");
    expect(c.value).toBe(5);
  });
  it("only respells the unit when the value is already in the display unit", () => {
    const c = canonicalise("wbc", "4.3", "x10E3/uL", "3.8-10.8");
    expect(c.result).toBe("4.3");
    expect(c.units).toBe("K/µL");
    expect(c.converted).toBe(false);
    expect(c.printed).toEqual({ result: "4.3", units: "x10E3/uL", referenceRange: "3.8-10.8" });
  });
  it("leaves untouched values with no printed change", () => {
    const c = canonicalise("wbc", "5.1", "K/µL", "3.8-10.8");
    expect(c.printed).toBeNull();
    expect(canonicalise("urine glucose", "NEGATIVE", "", "NEGATIVE")).toMatchObject({ value: null, units: null, printed: null });
  });
});

describe("convertRange", () => {
  it("scales every number and drops a trailing unit", () => {
    expect(convertRange("3.9-6.1", (v) => v * 18.016, 0)).toBe("70-110");
    expect(convertRange("≥ 1.0 mmol/L", (v) => v * 38.67, 0)).toBe("≥ 39");
    expect(convertRange("", (v) => v)).toBe("");
  });
});

const report = (id: string, collectedAt: string, rows: [string, string, string][]): LabReportLike => ({
  id,
  createdAt: collectedAt,
  collectedAt,
  labResults: rows.map(([testType, result, units], i) => ({ id: `${id}-${i}`, category: "Blood", testType, referenceRange: "", isOutOfRange: false, result, units })),
});

describe("buildCurrentLabs with units", () => {
  it("lines up a mmol/L report with a mg/dL report in one history", () => {
    const eu = report("eu", "2026-03-01T00:00:00Z", [["Glucosio", "5.2", "mmol/L"]]);
    const us = report("us", "2025-03-01T00:00:00Z", [["Glucose", "88", "mg/dL"]]);
    const [g] = buildCurrentLabs([us, eu]);
    expect(g.key).toBe("glucose");
    expect(g.result).toBe("94");
    expect(g.units).toBe("mg/dL");
    expect(g.history.map((h) => [h.result, h.units, h.converted])).toEqual([["94", "mg/dL", true], ["88", "mg/dL", false]]);
    expect(g.history[0].printed?.result).toBe("5.2");
  });
  it("prefers hs-CRP over standard CRP on the same report", () => {
    const r = report("r", "2026-03-01T00:00:00Z", [["CRP", "<5", "mg/L"], ["hs-CRP", "0.8", "mg/L"]]);
    const [crp] = buildCurrentLabs([r]);
    expect(crp.key).toBe("crp");
    expect(crp.testType).toBe("hs-CRP");
    expect(crp.result).toBe("0.8");
  });
});
