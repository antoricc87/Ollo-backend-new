import { sanitize } from "../../src/services/encounter/llm/slotFill";
import { escalationFor, NEUTRAL_CLOSE } from "../../src/services/encounter/domain/escalation";
import { byKey, slug } from "../../src/services/encounter/domain/protocols";
import { RULES } from "../../src/services/encounter/domain/redflags";
import { Protocol, Slot, TrippedFlag } from "../../src/services/encounter/domain/types";
import { lintOutput } from "../../src/services/agent/safety/lint";

const chest = byKey("chest_discomfort") as Protocol;
const slotFor = (key: string): Slot => chest.slots.find((s) => s.key === key)!;
const flag = (ruleId: string): TrippedFlag => {
  const r = RULES.find((x) => x.id === ruleId)!;
  return { ruleId: r.id, level: r.level, criterion: r.criterion, source: r.source };
};

describe("slot-fill sanitiser", () => {
  it("drops an option that does not exist on the slot", () => {
    expect(sanitize(slotFor("location"), "left_ventricle")).toBeNull();
  });

  it("keeps an option that does", () => {
    expect(sanitize(slotFor("location"), slug("Centre of my chest"))).toBe(slug("Centre of my chest"));
  });

  it("filters a multi answer down to the options that exist", () => {
    const value = [slug("Cold sweat"), "made_up_option"];
    expect(sanitize(slotFor("associated"), value)).toEqual([slug("Cold sweat")]);
  });

  it("returns null rather than an empty list when nothing survives", () => {
    expect(sanitize(slotFor("associated"), ["made_up_option"])).toBeNull();
  });

  it("clamps and rounds a scale into range", () => {
    const severity = slotFor("severity");
    expect(sanitize(severity, 99)).toBe(10);
    expect(sanitize(severity, -4)).toBe(0);
    expect(sanitize(severity, 6.4)).toBe(6);
    expect(sanitize(severity, "not a number" as any)).toBeNull();
  });
});

describe("escalation copy", () => {
  it("is null when nothing tripped", () => {
    expect(escalationFor([])).toBeNull();
  });

  it("names the region's emergency number when the region is known", () => {
    const s = escalationFor([flag("cardiac.radiating")], "UK");
    expect(s!.action).toContain("999");
  });

  it("falls back to both numbers when the region is not known", () => {
    const s = escalationFor([flag("cardiac.radiating")], null);
    expect(s!.action).toContain("911");
    expect(s!.action).toContain("112");
  });

  it("shows the matched criterion with its source, rather than a verdict", () => {
    const s = escalationFor([flag("cardiac.radiating")], "US");
    expect(s!.criteria[0]).toContain("American Heart Association");
    expect(s!.body).toContain("I can't tell you how serious");
  });

  it("gives self-harm the crisis script and no criteria list", () => {
    const s = escalationFor([flag("mood.self_harm")], "US");
    expect(s!.title).toBe("Please talk to someone now");
    expect(s!.action).toContain("988");
    expect(s!.criteria).toEqual([]);
  });

  it("prefers the emergency script when both levels tripped", () => {
    const s = escalationFor([flag("cardiac.at_rest"), flag("cardiac.radiating")], "US");
    expect(s!.level).toBe("EMERGENCY");
  });

  /** Escalation is the one place a forbidden act would do the most damage. */
  it("emits nothing the output guard would flag", () => {
    for (const region of ["US", "UK", null] as const) {
      for (const id of ["cardiac.radiating", "cardiac.at_rest", "mood.self_harm"]) {
        const s = escalationFor([flag(id)], region)!;
        expect(lintOutput([s.title, s.body, s.action, ...s.criteria].join(" "))).toEqual([]);
      }
    }
    expect(lintOutput(NEUTRAL_CLOSE)).toEqual([]);
  });
});
