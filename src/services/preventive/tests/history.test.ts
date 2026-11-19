import { lastDoneByItem } from "../domain/history";
import { cadenceLabel } from "../domain/cadence";

/** Last done, from every source on record. */
describe("last done by item", () => {
  const biomarkers = { lipid_panel: ["ldl", "hdl", "tcl", "triglycerides"], hba1c_glucose: ["hba1c", "glucose"] };

  it("labs: the newest sample, with what was out of range in it", () => {
    const out = lastDoneByItem({
      biomarkers,
      done: [],
      recordNames: [],
      labs: [
        { key: "ldl", name: "LDL cholesterol", collectedAt: "2025-02-01T12:00:00Z", outOfRange: true },
        { key: "ldl", name: "LDL cholesterol", collectedAt: "2026-06-10T12:00:00Z", outOfRange: false },
        { key: "hdl", name: "HDL cholesterol", collectedAt: "2026-06-10T12:00:00Z", outOfRange: false },
      ],
    });
    expect(out.lipid_panel).toEqual({ on: "2026-06-10", source: "lab", outcome: "normal", flagged: [] });
    expect(out.hba1c_glucose).toBeUndefined();
  });

  it("tests without a biomarker key are found by name (HIV, hepatitis C)", () => {
    const out = lastDoneByItem({ biomarkers, done: [], recordNames: [], labs: [{ key: "hiv 1 2 ag ab", name: "HIV-1/2 Ag/Ab", collectedAt: "2023-04-02T12:00:00Z", outOfRange: false }] });
    expect(out.hiv?.on).toBe("2023-04-02");
  });

  it("a booking or what they said; the newest wins", () => {
    const out = lastDoneByItem({
      biomarkers,
      labs: [],
      recordNames: [],
      done: [
        { itemKey: "colorectal", doneOn: new Date("2019-05-01T12:00:00Z"), source: "person", outcome: "normal" },
        { itemKey: "colorectal", doneOn: new Date("2022-03-01T12:00:00Z"), source: "person", outcome: "findings" },
      ],
    });
    expect(out.colorectal).toEqual({ on: "2022-03-01", source: "person", outcome: "findings" });
  });

  it("a record name with no date counts only when nothing dated does", () => {
    const undated = lastDoneByItem({ biomarkers, labs: [], done: [], recordNames: ["Colonoscopy", "Influenza vaccine"] });
    expect(undated.colorectal).toEqual({ on: null, source: "record", outcome: "unknown" });
    expect(undated.flu?.on).toBeNull();
    const dated = lastDoneByItem({ biomarkers, labs: [], recordNames: ["Colonoscopy"], done: [{ itemKey: "colorectal", doneOn: "2022-03-01", source: "person", outcome: "normal" }] });
    expect(dated.colorectal.on).toBe("2022-03-01");
  });

  it("labels", () => {
    expect([cadenceLabel(null), cadenceLabel(12), cadenceLabel(120), cadenceLabel(3)]).toEqual(["Once", "Every year", "Every 10 years", "Every 3 months"]);
  });
});
