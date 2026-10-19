import { registry } from "../../src/services/agent/tools";
import { CORE_TOOLS, PACK_KEYS, PACKS, toolsForPacks } from "../../src/services/agent/tools/packs";
import { PACK_RULES, buildSystemPrompt } from "../../src/services/agent/prompt/system";

/** Area packs (R1 token cut, Oct 19 2026): every tool reachable, no rule pointing at a tool its pack lacks. */
describe("area packs", () => {
  const all = registry.specs().map((t) => t.name);

  it("every registered tool is in exactly one place: the core or one pack", () => {
    for (const name of all) {
      const homes = [CORE_TOOLS.includes(name) ? "core" : null, ...PACK_KEYS.filter((k) => PACKS[k].tools.includes(name))].filter(Boolean);
      expect({ name, homes }).toEqual({ name, homes: [homes[0]] });
      expect(homes).toHaveLength(1);
    }
  });

  it("no pack or the core names a tool that does not exist", () => {
    for (const name of [...CORE_TOOLS, ...PACK_KEYS.flatMap((k) => PACKS[k].tools)]) expect(all).toContain(name);
  });

  it("a pack's rules only mention tools that the pack or the core carries", () => {
    for (const k of PACK_KEYS) {
      const allowed = toolsForPacks([k]);
      const mentioned = all.filter((t) => new RegExp(`\\b${t}\\b`).test(PACK_RULES[k]));
      expect({ pack: k, outside: mentioned.filter((t) => !allowed.has(t)) }).toEqual({ pack: k, outside: [] });
    }
  });

  it("safety stays in every prompt whatever the packs", () => {
    const none = buildSystemPrompt({ snapshotText: "", packs: [] });
    expect(none).toMatch(/Hard boundary/);
    expect(none).toMatch(/Training and the body/);
    expect(none.length).toBeLessThan(buildSystemPrompt({ snapshotText: "" }).length);
  });

  it("starting a check-in and following one up are always loaded", () => {
    const core = toolsForPacks([]);
    for (const t of ["start_checkin", "ask_followup", "record_followup", "load_tools"]) expect(core.has(t)).toBe(true);
  });
});
