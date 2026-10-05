import { PROTOCOLS, byKey, resolveProtocol, requiredSlots, slug } from "../../src/services/encounter/domain/protocols";
import { RULES, evaluateSlots, highestLevel } from "../../src/services/encounter/domain/redflags";
import { applyAnswer, historyComplete, markAsked, nextStep, open, questionFor, shouldHalt, MAX_TURNS } from "../../src/services/encounter/domain/stateMachine";
import { handout, recapLines, bookingReason } from "../../src/services/encounter/domain/summary";
import { emptyState, EncounterState, Protocol } from "../../src/services/encounter/domain/types";
import { lintOutput } from "../../src/services/agent/safety/lint";

const chest = byKey("chest_discomfort") as Protocol;
const start = (key = "chest_discomfort", text = "I've had a tight feeling in my chest since yesterday") =>
  open(emptyState(key, text, 1), resolveProtocol(key));

describe("protocol integrity", () => {
  it("every protocol has an opener, a source and at least one required slot", () => {
    for (const p of PROTOCOLS) {
      expect(p.opener.length).toBeGreaterThan(0);
      expect(p.source.org.length).toBeGreaterThan(0);
      expect(requiredSlots(p).length).toBeGreaterThan(0);
    }
  });

  it("slot keys are unique within a protocol", () => {
    for (const p of PROTOCOLS) {
      const keys = p.slots.map((s) => s.key);
      expect(keys.length).toBe(keys.filter((k, i) => keys.indexOf(k) === i).length);
    }
  });

  /** The rules reference options by the words the user saw. If a label is reworded and the
      rule isn't, the rule silently stops firing — the worst failure this feature can have. */
  it("every red-flag rule points at a slot and options that actually exist", () => {
    for (const rule of RULES) {
      const targets = rule.complaint ? [byKey(rule.complaint) as Protocol] : PROTOCOLS;
      for (const p of targets) {
        const slot = p.slots.find((s) => s.key === rule.slotKey);
        expect(slot ? "ok" : `${rule.id}: no slot ${rule.slotKey} on ${p.key}`).toBe("ok");
        const values = (slot!.options ?? []).map((o) => o.value);
        for (const label of rule.labels) {
          expect(values.indexOf(slug(label)) >= 0 ? "ok" : `${rule.id}: no option "${label}" on ${p.key}.${rule.slotKey}`).toBe("ok");
        }
      }
    }
  });

  it("falls back to general_unwell for an unknown complaint", () => {
    expect(resolveProtocol("something_made_up").key).toBe("general_unwell");
    expect(resolveProtocol(null).key).toBe("general_unwell");
  });
});

describe("question order", () => {
  it("asks the safety screen before any history", () => {
    const step = nextStep(start(), chest);
    expect(step.kind).toBe("ask");
    if (step.kind === "ask") {
      expect(step.slot.key).toBe("associated");
      expect(step.phase).toBe("SAFETY_SCREEN");
    }
  });

  it("moves to history once the safety slot is answered", () => {
    const s = applyAnswer(start(), chest, "associated", ["none_of_these"]);
    const step = nextStep(s, chest);
    expect(step.kind).toBe("ask");
    if (step.kind === "ask") expect(step.phase).toBe("HISTORY");
  });

  it("does not re-ask a slot the user skipped", () => {
    const s = markAsked(start(), "associated");
    const step = nextStep(s, chest);
    if (step.kind === "ask") expect(step.slot.key).not.toBe("associated");
  });

  it("stops at the turn cap even with slots outstanding", () => {
    const s: EncounterState = { ...start(), turns: MAX_TURNS };
    expect(nextStep(s, chest)).toEqual({ kind: "done", phase: "RECAP" });
  });

  it("reaches RECAP once every required slot is settled", () => {
    let s = start();
    for (const slot of requiredSlots(chest)) {
      const value = slot.kind === "scale" ? 6 : slot.kind === "multi" ? [(slot.options ?? [])[0].value] : (slot.options ?? [{ value: "x" }])[0].value;
      s = applyAnswer(s, chest, slot.key, value as any);
    }
    expect(historyComplete(s, chest)).toBe(true);
  });
});

describe("red flags", () => {
  it("trips on the opening text before any question is asked", () => {
    const s = start("chest_discomfort", "crushing chest pain and my left arm hurts");
    expect(s.redFlags.length).toBeGreaterThan(0);
    expect(highestLevel(s.redFlags)).toBe("EMERGENCY");
  });

  it("trips on a structured answer", () => {
    const s = applyAnswer(start("chest_discomfort", "chest feels odd"), chest, "associated", [slug("Cold sweat")]);
    expect(s.redFlags.map((f) => f.ruleId)).toContain("cardiac.radiating");
  });

  it("is sticky — a later answer cannot clear an earlier flag", () => {
    let s = applyAnswer(start("chest_discomfort", "chest feels odd"), chest, "associated", [slug("Cold sweat")]);
    expect(s.redFlags.length).toBe(1);
    s = applyAnswer(s, chest, "associated", ["none_of_these"]);
    expect(s.redFlags.map((f) => f.ruleId)).toContain("cardiac.radiating");
  });

  it("does not duplicate a flag across turns", () => {
    let s = applyAnswer(start("chest_discomfort", "chest feels odd"), chest, "associated", [slug("Cold sweat")]);
    s = applyAnswer(s, chest, "severity", 7);
    expect(s.redFlags.filter((f) => f.ruleId === "cardiac.radiating").length).toBe(1);
  });

  it("carries a criterion and a named source on every flag", () => {
    const s = applyAnswer(start("chest_discomfort", "chest feels odd"), chest, "associated", [slug("Cold sweat")]);
    for (const f of s.redFlags) {
      expect(f.criterion.length).toBeGreaterThan(20);
      expect(f.source.org.length).toBeGreaterThan(0);
    }
  });

  it("halts the interview on self-harm instead of taking a history", () => {
    const mood = byKey("low_mood") as Protocol;
    const s = applyAnswer(open(emptyState("low_mood", "everything feels flat lately", 1), mood), mood, "safety", slug("Yes, right now"));
    expect(shouldHalt(s.redFlags)).toBe(true);
    expect(nextStep(s, mood)).toEqual({ kind: "done", phase: "ROUTE" });
  });

  it("does not fire a rule belonging to another complaint", () => {
    const s = { ...emptyState("headache", "head hurts", 1), slots: { associated: [slug("Cold sweat")] } };
    expect(evaluateSlots(s).length).toBe(0);
  });
});

describe("summary", () => {
  const walked = () => {
    let s = start("chest_discomfort", "Tight feeling in the middle of my chest since yesterday morning");
    s = applyAnswer(s, chest, "associated", [slug("Short of breath")]);
    s = applyAnswer(s, chest, "onset", slug("In the last few days"));
    s = applyAnswer(s, chest, "location", slug("Centre of my chest"));
    s = applyAnswer(s, chest, "severity", 6);
    return s;
  };

  it("recaps answers as the user gave them, using the labels they saw", () => {
    const answers = recapLines(walked(), chest).map((l) => l.answer);
    expect(answers).toContain("Centre of my chest");
    expect(answers).toContain("6 out of 10");
    expect(answers).toContain("Short of breath");
  });

  it("puts the complaint verbatim and a provenance line in the handout", () => {
    const text = handout(walked(), chest, { firstName: "Antonio", age: 38 });
    expect(text).toContain("Tight feeling in the middle of my chest since yesterday morning");
    expect(text).toContain("Not a clinical assessment");
    expect(text).toContain("CRITERIA THE PATIENT MATCHED");
  });

  it("names the check-in, never a condition, in the booking reason", () => {
    expect(bookingReason(chest)).toBe("Check-in: chest discomfort");
  });

  /** Phase 0's linter, pointed at Phase 1's output. The summary is exactly where a fluent
      model would add "which suggests…" — this proves the deterministic one never does. */
  it("emits nothing the output guard would flag", () => {
    const s = walked();
    expect(lintOutput(handout(s, chest))).toEqual([]);
    for (const line of recapLines(s, chest)) expect(lintOutput(`${line.question} ${line.answer}`)).toEqual([]);
    for (const p of PROTOCOLS) {
      expect(lintOutput(p.opener)).toEqual([]);
      for (const slot of p.slots) expect(lintOutput(slot.prompt)).toEqual([]);
    }
  });

  it("emits nothing the output guard would flag, for every red-flag criterion", () => {
    for (const rule of RULES) expect(lintOutput(rule.criterion)).toEqual([]);
  });
});

/**
 * One question on the table (Oct 4 2026). The app's choices followed nextStep
 * while the model asked two or three questions in its own order, so the chips
 * matched at most one of them. Now both read questionFor.
 */
describe("questionFor — the one question the reply asks and the app shows choices for", () => {
  const back = byKey("back_pain") as Protocol;
  const opened = () => open(emptyState("back_pain", "my lower back hurts after football", back.version), back);
  const screened = () => applyAnswer(opened(), back, "associated", ["none_of_these"]);

  it("is the next question in order when the model names nothing", () => {
    const s = screened();
    expect(questionFor(s, back)).toEqual(nextStep(s, back));
  });

  it("follows the model when it names an uncovered question", () => {
    const step = questionFor(screened(), back, "radiates");
    expect(step.kind === "ask" && step.slot.key).toBe("radiates");
  });

  it("never lets the warning-sign question be skipped", () => {
    const step = questionFor(opened(), back, "radiates");
    expect(step.kind === "ask" && step.slot.key).toBe("associated");
  });

  it("ignores a question that is already answered, and one that does not exist", () => {
    const s = applyAnswer(screened(), back, "radiates", slug("Down one leg"));
    expect(questionFor(s, back, "radiates")).toEqual(nextStep(s, back));
    expect(questionFor(s, back, "made_up")).toEqual(nextStep(s, back));
  });

  it("an answer kept in their own words settles the question and prints as they said it", () => {
    const s = applyAnswer(screened(), back, "onset", "worse after every match, eases over three or four days");
    const next = questionFor(s, back);
    expect(next.kind === "ask" && next.slot.key).not.toBe("onset");
    expect(recapLines(s, back).find((l) => l.question === "When did this start?")?.answer).toBe("worse after every match, eases over three or four days");
  });

  it("offers 'It keeps coming back' for when it started", () => {
    expect(back.slots.find((x) => x.key === "onset")?.options?.map((o) => o.label)).toContain("It keeps coming back");
  });
});
