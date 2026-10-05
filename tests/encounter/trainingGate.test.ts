import { generalSessionLine, stopLine, strictestGate, trainingGateFor, treatmentWording } from "../../src/services/encounter/domain/trainingGate";
import { resolveProtocol } from "../../src/services/encounter/domain/protocols";
import { emptyState, EncounterState, SlotValue } from "../../src/services/encounter/domain/types";
import { lintOutput } from "../../src/services/agent/safety/lint";

/**
 * What a check-in on record allows for training (ruling Oct 4 2026). Before
 * this, a check-in answered "no" to every warning sign ended exactly like one
 * answered "yes": no session. These pin the three outcomes and the one line
 * that holds in all of them — nothing is designed as treatment.
 */

const assessment = { possibilities: [{ condition: "Muscle strain or overuse" }, { condition: "Sciatica (nerve irritation)" }] };

const enc = (key: string, slots: Record<string, SlotValue>, over: Partial<EncounterState> = {}, status = "OPEN") => {
  const protocol = resolveProtocol(key);
  return { id: "e1", status, protocol, state: { ...emptyState(key, "it hurts", protocol.version), phase: "ROUTE" as const, slots, ...over } };
};

const mildBack = { associated: ["none_of_these"], location: "lower_back", radiates: "it_stays_put", onset: "in_the_last_few_days", pattern: "getting_better", severity: 3 };

describe("trainingGateFor", () => {
  it("normal: assessed, no warning sign, nothing calling for care", () => {
    const g = trainingGateFor(enc("back_pain", mildBack), assessment);
    expect(g.level).toBe("normal");
    expect(g.reasons).toEqual([]);
  });

  it("general: the conversation that prompted this — travels down a leg, a month or more", () => {
    const g = trainingGateFor(enc("back_pain", { ...mildBack, radiates: "down_one_leg", onset: "a_month_or_more_ago", pattern: "comes_and_goes", severity: 5 }), assessment);
    expect(g.level).toBe("general");
    expect(g.reasons).toEqual(["it travels beyond where it starts", "it has been going on for a month or more"]);
    expect(g.conditions).toEqual(["Muscle strain or overuse", "Sciatica (nerve irritation)"]);
    expect(g.stopIf).toContain("Weakness in a leg");
    expect(g.stopIf).not.toContain("None of these");
  });

  it.each([
    ["getting worse", { pattern: "getting_worse" }],
    ["constant", { pattern: "constant" }],
    ["7 of 10", { severity: 7 }],
    ["keeps coming back", { onset: "it_keeps_coming_back" }],
    ["an answer kept in their own words, which no rule here can read", { onset: "worse after every match, eases over a few days" }],
  ])("general: %s", (_n, slots) => {
    expect(trainingGateFor(enc("back_pain", { ...mildBack, ...slots }), assessment).level).toBe("general");
  });

  it("hold: a matched warning sign, whatever else was answered", () => {
    const flag = { ruleId: "back.weakness", level: "SEEK_CARE_NOW" as const, criterion: "Back pain with new leg weakness", source: { org: "NICE", year: 2025 } };
    const g = trainingGateFor(enc("back_pain", mildBack, { redFlags: [flag] }), assessment);
    expect(g.level).toBe("hold");
    expect(g.pending).toBe(false);
    expect(g.reasons).toEqual(["Back pain with new leg weakness"]);
  });

  it("hold: exertion is the question for chest, breathing and dizziness — a clear check-in does not open training", () => {
    for (const key of ["chest_discomfort", "breathlessness", "dizziness"]) {
      const g = trainingGateFor(enc(key, { associated: ["none_of_these"], severity: 2, onset: "today", pattern: "getting_better" }), assessment);
      expect(g.level).toBe("hold");
      expect(g.pending).toBe(false);
    }
  });

  it("hold (pending): the interview is still running, or was paused with End", () => {
    expect(trainingGateFor(enc("back_pain", mildBack, { phase: "HISTORY" }), null)).toMatchObject({ level: "hold", pending: true });
    expect(trainingGateFor(enc("back_pain", mildBack, { phase: "HISTORY" }, "ABANDONED"), null)).toMatchObject({ level: "hold", pending: true });
    // A new answer after an assessment reopens the interview — and the hold.
    expect(trainingGateFor(enc("back_pain", mildBack, { phase: "HISTORY" }), assessment)).toMatchObject({ level: "hold", pending: true });
  });

  it("a crisis halt (ROUTE with no assessment) never opens training", () => {
    expect(trainingGateFor(enc("low_mood", {}), null).level).toBe("hold");
  });

  it("several check-ins: the strictest decides", () => {
    const normal = trainingGateFor(enc("back_pain", mildBack), assessment);
    const general = trainingGateFor(enc("joint_pain", { severity: 8 }), assessment);
    expect(strictestGate([normal, general])?.level).toBe("general");
    expect(strictestGate([])).toBeNull();
  });
});

describe("treatmentWording", () => {
  const gate = { conditions: ["Muscle strain or overuse", "Sciatica (nerve irritation)"] };

  it.each([
    "Lower back rehab",
    "Stretches to relieve your back",
    "Sciatica mobility flow",
    "Hip hinge — good for sciatica",
    "Nerve glides, 10 each side",
    "Core work to fix the pain",
    "Spinal decompression hang",
  ])("flags: %s", (text) => {
    expect(treatmentWording([text], gate)).not.toBeNull();
  });

  it.each(["Mobility and easy core", "Light full body", "Recovery day: easy walk and stretching", "Cat-cow", "kept light and general while your back pain is unassessed by a clinician", "a weight you could do 12 with"])(
    "stays clean: %s",
    (text) => {
      expect(treatmentWording([text], gate)).toBeNull();
    }
  );
});

describe("the code-built card lines", () => {
  const g = trainingGateFor(enc("back_pain", { ...mildBack, radiates: "down_one_leg" }), assessment);

  it("say what the session is not, and when to stop", () => {
    expect(generalSessionLine(g)).toBe("A general, lighter session — not treatment for your back pain. Exercises aimed at it are for a clinician or physiotherapist to choose.");
    expect(stopLine(g)).toMatch(/^Stop and get seen if any of these appear: numbness around the groin/);
  });

  it("pass the output linter — the gate must not emit what the guard forbids", () => {
    for (const line of [generalSessionLine(g), generalSessionLine(g, "week"), stopLine(g)!]) expect(lintOutput(line)).toEqual([]);
  });
});
