import { LLMClient } from "../../agent/llm/types";
import { COMPLAINT_KEYS } from "../domain/protocols";

/**
 * Free text → one protocol key from a CLOSED vocabulary.
 *
 * This is the only place a model chooses anything structural, and its choice
 * is bounded to the list of protocols that exist. Anything it cannot place
 * becomes `general_unwell`; an unknown key is never trusted through.
 *
 * It classifies. It does not interpret: the key is a complaint the patient
 * described ("chest discomfort"), never a condition ("angina").
 */

export const PROMPT_VERSION = "encounter.classify.v1";

export type Classification = {
  complaintKey: string;
  /** True when the opening text is a question about a condition rather than a description of one. */
  askingForDiagnosis: boolean;
};

const SCHEMA = {
  type: "object",
  properties: {
    reasoning: { type: "string", description: "One sentence: which words in the message point at which key." },
    complaintKey: { type: "string", enum: COMPLAINT_KEYS, description: "The protocol that best fits what the person DESCRIBED." },
    askingForDiagnosis: {
      type: "boolean",
      description: "TRUE only if the message asks what they have or whether it is serious, rather than describing a symptom.",
    },
  },
  required: ["reasoning", "complaintKey", "askingForDiagnosis"],
  additionalProperties: false,
} as const;

const SYSTEM = `You route a patient's own words to one intake protocol in a health app.

Pick the protocol matching the symptom they DESCRIBE. Never infer a condition — "tight chest" is chest_discomfort, not angina; "burning after meals" is abdominal_pain, not reflux.
If several fit, pick the one carrying the most urgent safety questions (chest_discomfort over fatigue).
If nothing fits, or the message is too vague to place, use general_unwell.`;

export async function classify(llm: LLMClient, text: string): Promise<Classification> {
  try {
    const r = await llm.json<{ complaintKey: string; askingForDiagnosis: boolean }>({
      system: SYSTEM,
      user: text.slice(0, 1500),
      schema: SCHEMA as unknown as Record<string, unknown>,
      schemaName: "encounter_classification",
    });
    return {
      complaintKey: COMPLAINT_KEYS.indexOf(r.complaintKey) >= 0 ? r.complaintKey : "general_unwell",
      askingForDiagnosis: !!r.askingForDiagnosis,
    };
  } catch {
    // A classifier failure must not block the check-in — the general protocol asks the safe questions too.
    return { complaintKey: "general_unwell", askingForDiagnosis: false };
  }
}

/** Fixed DECLINE copy for someone opening with "what do I have?". */
export const DIAGNOSIS_DECLINE =
  "I can't tell you what's causing this — that needs a clinician who can examine you. What I can do is take it down properly so you walk in with it written down. Shall we?";
