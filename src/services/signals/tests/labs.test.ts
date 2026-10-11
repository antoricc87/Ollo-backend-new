import { CHANGE_FRACTION, labsDelta, labsDeltaOf } from "../domain/detectors/labs";

type Row = { testType: string; result: string; isOutOfRange: boolean; units?: string; referenceRange?: string; category?: string };
const report = (id: string, collectedAt: string, rows: Row[], uploadedAt = `${collectedAt}T10:00:00Z`) => ({
  id,
  createdAt: new Date(uploadedAt),
  collectedAt: new Date(`${collectedAt}T08:00:00Z`),
  labResults: rows.map((r, i) => ({ id: `${id}-${i}`, category: r.category ?? "Lipids", units: r.units ?? "mg/dL", referenceRange: r.referenceRange ?? "0-100", ...r })),
});

const ldl = (result: string, flagged: boolean) => ({ testType: "LDL Cholesterol", result, isOutOfRange: flagged });
const hdl = (result: string, flagged: boolean) => ({ testType: "HDL Cholesterol", result, isOutOfRange: flagged, referenceRange: "40-100" });
const crp = (result: string, flagged: boolean) => ({ testType: "CRP", result, isOutOfRange: flagged, units: "mg/L", referenceRange: "0-3", category: "Inflammation" });

describe("labs.report", () => {
  it("is silent on a first report with nothing flagged", () => {
    expect(labsDelta([report("a", "2026-10-01", [ldl("90", false), hdl("55", false)])], ["a"])).toBeNull();
  });

  it("fires on a newly flagged value and carries the previous one", () => {
    const reports = [report("a", "2026-03-01", [ldl("95", false)]), report("b", "2026-10-01", [ldl("160", true), hdl("55", false)])];
    const c = labsDelta(reports, ["b"]);
    expect(c?.direction).toBe("CONCERN");
    expect(c?.severity).toBe(1);
    const ev = c!.evidence as any;
    expect(ev.newlyFlagged.map((r: any) => r.key)).toEqual(["ldl"]);
    expect(ev.newlyFlagged[0].previous).toMatchObject({ result: "95", on: "2026-03-01", flagged: false });
    expect(ev.reportIds).toEqual(["b"]);
    expect(ev.unremarkable).toBe(1);
    expect(c?.label).toContain("1 newly outside range (ldl)");
  });

  it("stays silent when the same PDF is uploaded twice", () => {
    const rows = [ldl("160", true), crp("5.1", true)];
    const reports = [report("a", "2026-10-01", rows), report("a2", "2026-10-01", rows, "2026-10-01T10:05:00Z")];
    expect(labsDelta(reports, ["a2"])).toBeNull();
    const delta = labsDeltaOf(reports, ["a2"]);
    expect(delta.stillFlagged).toHaveLength(2);
    expect(delta.newlyFlagged).toHaveLength(0);
  });

  it("does not re-raise a value flagged before and unchanged, but carries it as evidence", () => {
    const reports = [report("a", "2026-03-01", [ldl("160", true)]), report("b", "2026-10-01", [ldl("165", true), crp("8", true)])];
    const c = labsDelta(reports, ["b"]);
    const ev = c!.evidence as any;
    expect(ev.newlyFlagged.map((r: any) => r.key)).toEqual(["crp"]);
    expect(ev.stillFlagged.map((r: any) => r.key)).toEqual(["ldl"]);
    expect(ev.stillFlagged[0].changeFraction).toBeLessThan(CHANGE_FRACTION);
  });

  it("counts a flagged value that moved materially as half a bar: one alone is silent, two clear it", () => {
    const one = [report("a", "2026-03-01", [ldl("160", true)]), report("b", "2026-10-01", [ldl("210", true)])];
    expect(labsDelta(one, ["b"])).toBeNull();
    expect(labsDeltaOf(one, ["b"]).changed.map((r) => r.key)).toEqual(["ldl"]);
    expect(labsDelta([report("a", "2026-03-01", [ldl("160", true), crp("8", true)]), report("b", "2026-10-01", [ldl("210", true), crp("12", true)])], ["b"])?.severity).toBe(1);
  });

  it("fires POSITIVE when the only news is a value back in range", () => {
    const reports = [report("a", "2026-03-01", [ldl("160", true)]), report("b", "2026-10-01", [ldl("95", false)])];
    const c = labsDelta(reports, ["b"]);
    expect(c?.direction).toBe("POSITIVE");
    expect((c!.evidence as any).backInRange[0]).toMatchObject({ key: "ldl", result: "95", previous: { result: "160", flagged: true } });
  });

  it("ignores an older report uploaded after a newer one", () => {
    const reports = [report("new", "2026-10-01", [ldl("95", false)]), report("old", "2025-01-01", [ldl("170", true)])];
    expect(labsDelta(reports, ["old"])).toBeNull();
  });

  it("treats a batch of files as one candidate", () => {
    const reports = [report("a", "2026-10-01", [ldl("160", true)]), report("b", "2026-10-01", [crp("9", true)])];
    const c = labsDelta(reports, ["a", "b"]);
    expect(c?.severity).toBe(2);
    expect((c!.evidence as any).collectedAt).toEqual(["2026-10-01", "2026-10-01"]);
  });

  it("caps severity on a big panel", () => {
    const rows = Array.from({ length: 9 }, (_, i) => ({ testType: `Marker ${i}`, result: "9", isOutOfRange: true, category: "Misc" }));
    expect(labsDelta([report("a", "2026-10-01", rows)], ["a"])?.severity).toBe(4);
  });
});
