import { AssessmentRejected, buildAssessment, CHECKIN_DISCLAIMER, MAX_POSSIBILITIES, warningSignsFor } from "../../src/services/encounter/domain/assessment";
import { byKey, resolveProtocol } from "../../src/services/encounter/domain/protocols";
import { open } from "../../src/services/encounter/domain/stateMachine";
import { emptyState, EncounterState, Protocol, TrippedFlag } from "../../src/services/encounter/domain/types";
import { lintOutput } from "../../src/services/agent/safety/lint";

/**
 * The ending of a check-in (ruling 2026-09-16): naming candidate conditions is
 * allowed here and nowhere else, so these cases pin down the half of the
 * boundary that is still enforced — no dose, no reassurance, no prognosis, no
 * urgency verdict, no confidence claim — plus the rule that a tripped red flag
 * decides the next step no matter what the model asked for.
 */

const headache = byKey("headache") as Protocol;
const state = (text = "A headache every afternoon for the past week"): EncounterState => open(emptyState("headache", text, 1), headache);

const flagged = (level: "EMERGENCY" | "SEEK_CARE_NOW"): EncounterState => ({
  ...state(),
  redFlags: [{ ruleId: "test.rule", level, criterion: "A headache that came on like a thunderclap is a reason to call emergency services.", source: { org: "NHS", year: 2025 } } as TrippedFlag],
});

const twoGood = [
  { condition: "Tension-type headache", fits: ["Both sides", "Builds through the afternoon"], doesNotFit: ["No nausea"], wouldChange: "Whether it eases on days away from a screen" },
  { condition: "Medication-overuse headache", fits: ["Daily for two weeks", "A painkiller most days"] },
];

describe("buildAssessment — shape", () => {
  it("keeps two to four possibilities, most consistent first", () => {
    const a = buildAssessment({ possibilities: twoGood }, state(), headache);
    expect(a.possibilities.map((p) => p.condition)).toEqual(["Tension-type headache", "Medication-overuse headache"]);
    expect(a.disclaimer).toBe(CHECKIN_DISCLAIMER);
  });

  it("rejects a single candidate — one on its own reads as a diagnosis", () => {
    expect(() => buildAssessment({ possibilities: [twoGood[0]] }, state(), headache)).toThrow(AssessmentRejected);
  });

  it("rejects a possibility with nothing under what fits", () => {
    const bad = [twoGood[0], { condition: "Cluster headache", fits: [] }];
    expect(() => buildAssessment({ possibilities: bad }, state(), headache)).toThrow(/what fits/i);
  });

  it("caps the list", () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ condition: `Possibility ${i}`, fits: ["Something they said"] }));
    expect(buildAssessment({ possibilities: many }, state(), headache).possibilities.length).toBe(MAX_POSSIBILITIES);
  });
});

describe("buildAssessment — what may still not be said", () => {
  const banned: { name: string; text: string }[] = [
    { name: "a dose", text: "Take ibuprofen 400 mg when it starts" },
    { name: "reassurance", text: "This is nothing to worry about" },
    { name: "a prognosis", text: "It should clear up in a few days" },
    { name: "an urgency verdict", text: "This can wait until your next physical" },
    { name: "a confidence claim", text: "I'm 90% sure about this one" },
  ];
  for (const c of banned) {
    it(`rejects ${c.name}`, () => {
      const possibilities = [{ ...twoGood[0], fits: [c.text] }, twoGood[1]];
      expect(() => buildAssessment({ possibilities }, state(), headache)).toThrow(AssessmentRejected);
    });
    it(`rejects ${c.name} in the next-step reason`, () => {
      expect(() => buildAssessment({ possibilities: twoGood, nextStep: { kind: "OWN_DOCTOR", why: c.text } }, state(), headache)).toThrow(AssessmentRejected);
    });
  }

  it("tells the model what to fix", () => {
    try {
      buildAssessment({ possibilities: [{ ...twoGood[0], fits: ["Nothing to worry about"] }, twoGood[1]] }, state(), headache);
      throw new Error("should have thrown");
    } catch (e: any) {
      expect(e).toBeInstanceOf(AssessmentRejected);
      expect(e.message).toMatch(/call the tool again/i);
    }
  });
});

describe("buildAssessment — escalation is one-way", () => {
  it("an emergency flag decides the next step, whatever the model asked for", () => {
    const a = buildAssessment({ possibilities: twoGood, nextStep: { kind: "WATCH_AND_CHECK_BACK", why: "Keep an eye on it" } }, flagged("EMERGENCY"), headache);
    expect(a.nextStep.kind).toBe("EMERGENCY");
    expect(a.nextStep.why).toBe(a.escalation!.action);
    expect(a.matched.length).toBe(1);
  });

  it("a same-day flag lands on SEE_SOMEONE_TODAY", () => {
    expect(buildAssessment({ possibilities: twoGood, nextStep: { kind: "WATCH_AND_CHECK_BACK" } }, flagged("SEEK_CARE_NOW"), headache).nextStep.kind).toBe("SEE_SOMEONE_TODAY");
  });

  it("with nothing tripped it takes the model's route, defaulting to a clinician", () => {
    expect(buildAssessment({ possibilities: twoGood }, state(), headache).nextStep.kind).toBe("BOOK_OLLO_DOCTOR");
    expect(buildAssessment({ possibilities: twoGood, nextStep: { kind: "OWN_DOCTOR", why: "You already have someone who knows this history." } }, state(), headache).nextStep.kind).toBe("OWN_DOCTOR");
  });
});

describe("the code-built half", () => {
  it("warning signs come from the protocol's own safety options, minus the opt-out", () => {
    const signs = warningSignsFor(headache);
    expect(signs.length).toBeGreaterThan(0);
    expect(signs.some((s) => /none of these/i.test(s))).toBe(false);
  });

  it("every code-written string still lints clean through the output guard", () => {
    const a = buildAssessment({ possibilities: twoGood }, flagged("SEEK_CARE_NOW"), resolveProtocol("headache"));
    for (const line of [a.disclaimer, a.nextStep.why, ...a.warningSigns, ...a.matched, a.escalation!.body, a.escalation!.action]) {
      expect({ line, acts: lintOutput(line) }).toEqual({ line, acts: [] });
    }
  });
});
