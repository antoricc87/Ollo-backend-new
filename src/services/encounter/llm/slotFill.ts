import { LLMClient } from "../../agent/llm/types";
import { Slot, SlotValue } from "../domain/types";

/**
 * Free text → a value for ONE named slot.
 *
 * Used when someone answers a multiple-choice question in their own words
 * ("since Tuesday" for onset). The model maps words onto options that already
 * exist; it cannot invent an option, change the slot, or answer a question
 * that was not asked. Anything it cannot place returns null, and the stepped
 * UI simply keeps the question on screen.
 */

export const PROMPT_VERSION = "encounter.slotfill.v1";

const SYSTEM = `You map a patient's answer onto the options of ONE intake question in a health app.

Only choose from the options given. If the answer does not clearly match any of them, return null — a wrong guess puts words in the patient's mouth, which is worse than asking again.
For a 0–10 scale, return the number they meant. For free text, return their words, cleaned up but not summarised or reworded.`;

export async function fillSlot(llm: LLMClient, slot: Slot, text: string): Promise<SlotValue> {
  const clean = text.trim();
  if (!clean) return null;
  if (slot.kind === "freetext") return clean.slice(0, 1000);

  const values = (slot.options ?? []).map((o) => o.value);
  const schema = {
    type: "object",
    properties: {
      reasoning: { type: "string", description: "One sentence naming the words you matched on." },
      value:
        slot.kind === "scale"
          ? { type: ["number", "null"], description: `A number between ${slot.range?.[0] ?? 0} and ${slot.range?.[1] ?? 10}, or null.` }
          : slot.kind === "multi"
          ? { type: ["array", "null"], items: { type: "string", enum: values }, description: "Every option the answer covers, or null." }
          : { type: ["string", "null"], enum: [...values, null], description: "The single option that fits, or null." },
    },
    required: ["reasoning", "value"],
    additionalProperties: false,
  };

  try {
    const r = await llm.json<{ value: SlotValue }>({
      system: SYSTEM,
      user: `QUESTION: ${slot.prompt}\nOPTIONS: ${(slot.options ?? []).map((o) => `${o.value} = ${o.label}`).join("; ") || "(none)"}\n\nANSWER: ${clean.slice(0, 800)}`,
      schema: schema as unknown as Record<string, unknown>,
      schemaName: "encounter_slot_value",
    });
    return sanitize(slot, r.value);
  } catch {
    return null;
  }
}

/** The model's answer is never trusted straight through — an unknown option is dropped. */
export const sanitize = (slot: Slot, value: SlotValue): SlotValue => {
  if (value === null || value === undefined) return null;
  const values = (slot.options ?? []).map((o) => o.value);
  if (slot.kind === "scale") {
    const n = Number(value);
    if (Number.isNaN(n)) return null;
    const [lo, hi] = slot.range ?? [0, 10];
    return Math.min(hi, Math.max(lo, Math.round(n)));
  }
  if (slot.kind === "multi") {
    const arr = (Array.isArray(value) ? value : [value]).map(String).filter((v) => values.indexOf(v) >= 0);
    return arr.length ? arr : null;
  }
  if (slot.kind === "freetext") return String(value).slice(0, 1000);
  const one = String(value);
  return values.indexOf(one) >= 0 ? one : null;
};
