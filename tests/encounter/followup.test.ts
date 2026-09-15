import {
  followUpFor,
  trajectoryLine,
  persistenceNudge,
  dayOf,
  FOLLOW_UP_DAYS,
  PERSISTENCE_DAYS,
  CheckInRecord,
} from "../../src/services/encounter/domain/followUp";
import { ownDataBlocks, renderOwnData } from "../../src/services/encounter/domain/context";
import { handout } from "../../src/services/encounter/domain/summary";
import { byKey } from "../../src/services/encounter/domain/protocols";
import { emptyState, Protocol } from "../../src/services/encounter/domain/types";
import { lintOutput } from "../../src/services/agent/safety/lint";

const DAY = 86400000;
const ago = (days: number) => new Date(Date.now() - days * DAY);
const ci = (day: number, trend: "BETTER" | "SAME" | "WORSE"): CheckInRecord => ({ day, trend, createdAt: ago(Math.max(0, 12 - day)) });

describe("follow-up scheduling", () => {
  it("counts the episode day from the start", () => {
    expect(dayOf(ago(0))).toBe(1);
    expect(dayOf(ago(4))).toBe(4);
  });

  it("is not due before the first scheduled day", () => {
    expect(followUpFor(ago(1), []).due).toBe(false);
  });

  it("is due once a scheduled day has passed with nothing recorded", () => {
    expect(followUpFor(ago(FOLLOW_UP_DAYS[0]), []).due).toBe(true);
  });

  it("is not due again immediately after a report", () => {
    const started = ago(2);
    expect(followUpFor(started, [ci(2, "SAME")]).due).toBe(false);
  });

  it("becomes due again at the next scheduled day", () => {
    const started = ago(5);
    expect(followUpFor(started, [ci(2, "SAME")]).due).toBe(true);
  });
});

describe("trajectory — reflects, never interprets", () => {
  it("is null with nothing reported", () => {
    expect(trajectoryLine([])).toBeNull();
  });

  it("counts what they said and names the latest", () => {
    const line = trajectoryLine([ci(5, "WORSE"), ci(2, "SAME")])!;
    expect(line).toContain("worse once");
    expect(line).toContain("no different once");
    expect(line).toContain("Last time you said it was worse.");
  });

  it("says nothing about what any of it means", () => {
    for (const set of [[ci(2, "BETTER")], [ci(2, "SAME")], [ci(5, "WORSE"), ci(2, "WORSE")]]) {
      expect(lintOutput(trajectoryLine(set)!)).toEqual([]);
    }
  });
});

describe("persistence nudge", () => {
  it("does not fire early, however bad the report", () => {
    expect(persistenceNudge(2, [ci(2, "WORSE"), ci(1, "WORSE")])).toBeNull();
  });

  it("does not fire on a single non-improving report", () => {
    expect(persistenceNudge(PERSISTENCE_DAYS + 2, [ci(5, "SAME")])).toBeNull();
  });

  it("fires on consecutive non-improving reports past the day threshold", () => {
    const n = persistenceNudge(10, [ci(10, "SAME"), ci(5, "WORSE")]);
    expect(n).not.toBeNull();
    expect(n!.line).toContain("day 10");
    expect(n!.action).toMatch(/clinician/i);
  });

  /** The trap: an improving episode must never be nudged toward care. */
  it("never fires when the latest report is better", () => {
    expect(persistenceNudge(10, [ci(10, "BETTER"), ci(5, "WORSE")])).toBeNull();
  });

  /** The other trap: it must not explain, predict or grade what persistence means. */
  it("emits nothing the output guard would flag", () => {
    const n = persistenceNudge(10, [ci(10, "WORSE"), ci(5, "WORSE")])!;
    expect(lintOutput(`${n.line} ${n.action}`)).toEqual([]);
  });
});

describe("own-data context", () => {
  const input = {
    flaggedLabs: [
      { testType: "LDL cholesterol", result: "128", units: "mg/dL", referenceRange: "0–100", collectedAt: "2026-08-19" },
      { testType: "Vitamin D, 25-OH", result: "21", units: "ng/mL", referenceRange: "30–100", collectedAt: "2026-08-19" },
    ],
    conditions: ["Type 2 diabetes"],
    medications: [{ name: "metformin", dosage: "500 mg" }],
    allergies: ["Shellfish"],
    bloodPressure: { systolic: 128, diastolic: 82, at: "2026-09-01" },
  };

  it("is empty when there is nothing on record", () => {
    expect(ownDataBlocks({ flaggedLabs: [], conditions: [], medications: [], allergies: [], bloodPressure: null })).toEqual([]);
  });

  it("restates values with their units, the lab's range and the date", () => {
    const lines = ownDataBlocks(input).flatMap((b) => b.lines);
    expect(lines.some((l) => l.includes("128 mg/dL") && l.includes("0–100") && l.includes("2026-08-19"))).toBe(true);
    expect(lines.some((l) => l.includes("metformin 500 mg"))).toBe(true);
  });

  /** Layout can imply what a sentence never says, so the block says so outright. */
  it("says the labs are background, not a connection to the complaint", () => {
    const labs = ownDataBlocks(input).find((b) => b.heading.includes("LAB VALUES"))!;
    expect(labs.lines[0]).toMatch(/not because they are connected/i);
  });

  it("caps the lab list and says how many were left out", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ ...input.flaggedLabs[0], testType: `Marker ${i}` }));
    const lines = ownDataBlocks({ ...input, flaggedLabs: many }).find((b) => b.heading.includes("LAB VALUES"))!.lines;
    expect(lines.some((l) => /and 4 more/.test(l))).toBe(true);
  });

  it("emits nothing the output guard would flag", () => {
    const blocks = ownDataBlocks(input);
    expect(lintOutput(renderOwnData(blocks).join("\n"), { onRecordConditions: input.conditions })).toEqual([]);
  });

  it("reaches the handout without disturbing the provenance line", () => {
    const chest = byKey("chest_discomfort") as Protocol;
    const state = { ...emptyState("chest_discomfort", "Tight chest since yesterday", 1), slots: { severity: 6 } };
    const text = handout(state, chest, { firstName: "Antonio", age: 38 }, ownDataBlocks(input));
    expect(text).toContain("ALREADY ON THEIR RECORD");
    expect(text.trim().endsWith("no diagnosis or triage decision has been made or implied.")).toBe(true);
    expect(lintOutput(text, { onRecordConditions: input.conditions })).toEqual([]);
  });
});
