import { z } from "zod";
import { defineTool } from "./registry";
import { PACK_KEYS, PACKS } from "./packs";
import { PACK_RULES } from "../prompt/system";

/**
 * Mid-turn access to an area this turn did not load (agent/tools/packs.ts). The loop adds the pack's tools
 * to the next step; the result carries the pack's rules, which the system prompt did not include.
 */
export const loadTools = defineTool({
  name: "load_tools",
  description: `Load the tools of another area when this request needs one you do not have. Areas: ${PACK_KEYS.map((k) => `${k} (${PACKS[k].covers})`).join("; ")}. The tools are available on your next step.`,
  schema: z.object({ areas: z.array(z.enum(PACK_KEYS)).min(1).max(PACK_KEYS.length) }),
  risk: "read",
  async run(_ctx, input) {
    const areas = input.areas as (typeof PACK_KEYS)[number][];
    return {
      result: {
        loaded: areas,
        tools: areas.flatMap((k) => PACKS[k].tools),
        rules: areas.map((k) => PACK_RULES[k]).filter((r) => r.trim()).join("\n") || null,
        note: "These tools are available now. Follow the rules above for them, then continue with the request.",
      },
    };
  },
});
