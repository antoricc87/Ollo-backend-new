import { policyTable, route } from "../../src/services/agent/llm/policy";

/** One model policy for every call (R1, Oct 19 2026): the table, its overrides, and no gpt-4 by default. */
describe("llm policy", () => {
  it("every task starts on GPT-6 Luna, except the lab read-back (a different model on purpose) — no gpt-4 anywhere", () => {
    for (const line of policyTable({})) {
      expect(line).not.toMatch(/gpt-4/);
      if (line.startsWith("verify=")) continue;
      expect(line).toMatch(/=gpt-6-luna:/);
    }
  });

  it("design, plan and extraction escalate to GPT-6.1 Sol; conversation does not (yet)", () => {
    expect(route("design", {}).escalate).toEqual({ model: "gpt-6.1-sol", effort: "medium" });
    expect(route("extract_vision", {}).escalate?.model).toBe("gpt-6.1-sol");
    expect(route("converse", {}).escalate).toBeNull();
  });

  it("one override per task: model and effort", () => {
    expect(route("design", { LLM_DESIGN: "gpt-6.1-sol:high" })).toMatchObject({ model: "gpt-6.1-sol", effort: "high" });
    expect(route("design", { LLM_DESIGN: "gpt-6-luna" })).toMatchObject({ model: "gpt-6-luna", effort: "none" });
  });

  it("escalation can be turned off or redirected, and never points at the model already running", () => {
    expect(route("design", { LLM_DESIGN_ESCALATE: "off" }).escalate).toBeNull();
    expect(route("design", { LLM_DESIGN_ESCALATE: "gpt-6-sol:low" }).escalate).toEqual({ model: "gpt-6-sol", effort: "low" });
    expect(route("design", { LLM_DESIGN: "gpt-6.1-sol" }).escalate).toBeNull();
  });

  it("the variables set before the policy still work", () => {
    expect(route("converse", { AGENT_MODEL: "gpt-6-sol" }).model).toBe("gpt-6-sol");
    expect(route("checkin", { AGENT_CHECKIN_MODEL: "gpt-6.1-sol", AGENT_CHECKIN_EFFORT: "high" })).toMatchObject({ model: "gpt-6.1-sol", effort: "high" });
    // The new name wins over the old one.
    expect(route("converse", { AGENT_MODEL: "gpt-6-sol", LLM_CONVERSE: "gpt-6-luna:low" })).toMatchObject({ model: "gpt-6-luna", effort: "low" });
  });

  it("never sends effort none to Sol (it refuses it)", () => {
    expect(route("design", { LLM_DESIGN: "gpt-6.1-sol:none" }).effort).toBe("low");
    expect(route("design", { LLM_DESIGN_ESCALATE: "gpt-6.1-sol:none" }).escalate?.effort).toBe("low");
  });

  it("the fast tier is per task", () => {
    expect(route("extract_vision", { LLM_EXTRACT_VISION_TIER: "fast" }).tier).toBe("fast");
    expect(route("extract_vision", {}).tier).toBe("fast");
    expect(route("extract_vision", { LLM_EXTRACT_VISION_TIER: "default" }).tier).toBe("default");
    expect(route("design", {}).tier).toBe("fast");
    expect(route("summarize", {}).tier).toBe("default");
  });
});
