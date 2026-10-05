import { trimFlagged } from "../../src/services/agent/safety/trim";
import { factsFallback, FACTS_CLOSING, SAFE_FALLBACK } from "../../src/services/agent/safety/outputCheck";
import { lintOutput } from "../../src/services/agent/safety/lint";
import { labFacts } from "../../src/services/agent/tools/labs.tools";

/** The Oct 5 2026 report explanation, in the wording that was refused whole. */
const REPORT = `Here's a breakdown of your lab report from September 30, 2026:

**Flagged (outside the lab's range):**
- **Bilirubin, Total:** 1.3 mg/dL (reference: 0.0–1.2)
- Bilirubin is a pigment made when red blood cells break down. Slightly elevated levels can be due to several reasons, including Gilbert's syndrome (a common, harmless inherited trait) or increased breakdown of red blood cells. It's worth raising with your doctor.
- **Lipoprotein (a):** 129.0 nmol/L (reference: <75.0)

**The rest of your results:**
- Most other values, including kidney function and blood counts, are within the lab's reference range, which is a good sign.`;

describe("trimFlagged", () => {
  it("cuts the flagged sentences and keeps the rest", () => {
    const lint = lintOutput(REPORT).map((f) => f.sentence);
    expect(lint.length).toBe(1);
    const out = trimFlagged(REPORT, [...lint, "Most other values... are within the lab's reference range, which is a good sign."]);
    expect(out).not.toBeNull();
    expect(out!.removed).toHaveLength(2);
    expect(out!.text).not.toMatch(/harmless|good sign/);
    expect(out!.text).toMatch(/Bilirubin is a pigment/);
    expect(out!.text).toMatch(/worth raising with your doctor/);
    expect(out!.text).toMatch(/Lipoprotein \(a\):\*\* 129\.0/);
    // The heading whose only line was cut goes with it.
    expect(out!.text).not.toMatch(/The rest of your results/);
    expect(lintOutput(out!.text)).toEqual([]);
  });

  it("matches through markdown, curly quotes and a quote of part of a sentence", () => {
    const out = trimFlagged("Your LDL was 128 mg/dL on Aug 19, above the lab’s 0–100 range. **That’s nothing to worry about.** Saturated fat, fibre and activity all relate to it, and it is worth raising at your next visit.", ["That's nothing to worry about"]);
    expect(out!.text).toBe("Your LDL was 128 mg/dL on Aug 19, above the lab’s 0–100 range. Saturated fat, fibre and activity all relate to it, and it is worth raising at your next visit.");
  });

  it("is no repair when the flag cannot be located", () => {
    expect(trimFlagged(REPORT, [])).toBeNull();
    expect(trimFlagged(REPORT, ["a sentence that is not in the answer"])).toBeNull();
    expect(trimFlagged(REPORT, ["the", "a"])).toBeNull();
  });

  it("is no repair when nothing useful is left", () => {
    expect(trimFlagged("You could try a daily 2000 IU vitamin D3 supplement for a few months. Good luck!", ["You could try a daily 2000 IU vitamin D3 supplement for a few months."])).toBeNull();
  });
});

describe("facts fallback", () => {
  const rows = [
    { testType: "Bilirubin, Total", result: "1.3", units: "mg/dL", referenceRange: "0.0-1.2", isOutOfRange: true },
    { testType: "Lipoprotein (a)", result: "129.0", units: "nmol/L", referenceRange: "<75.0", isOutOfRange: true },
    { testType: "Glucose", result: "88", units: "mg/dL", referenceRange: "70-99", isOutOfRange: false },
  ];

  it("states the flagged values as printed", () => {
    const text = labFacts("Your report from 30 Sep 2026 has 3 values", rows);
    expect(text).toMatch(/2 are outside the range the lab prints/);
    expect(text).toMatch(/\*\*Bilirubin, Total:\*\* 1\.3 mg\/dL \(lab range 0\.0-1\.2\)/);
    expect(text).toMatch(/The other 1 is inside the lab's range\./);
    expect(text).not.toMatch(/Glucose/);
  });

  it("says so when nothing is outside the range", () => {
    expect(labFacts("Your report from 30 Sep 2026 has 1 value", [rows[2]])).toBe("Your report from 30 Sep 2026 has 1 value. None is outside the range the lab prints.");
  });

  it("is code the guard has no objection to", () => {
    const text = factsFallback([labFacts("Your report from 30 Sep 2026 has 3 values", rows)])!;
    expect(text.endsWith(FACTS_CLOSING)).toBe(true);
    expect(lintOutput(text)).toEqual([]);
    expect(text).not.toMatch(/healthy|normal|good|harmless|risk|suggests|recommend/i);
  });

  it("a turn that read nothing still declines", () => {
    expect(factsFallback([])).toBeNull();
    expect(lintOutput(SAFE_FALLBACK)).toEqual([]);
  });
});
