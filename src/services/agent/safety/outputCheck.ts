import { LLMClient } from "../llm/types";

/**
 * Output-side classifier. Runs on the drafted answer before anything is shown
 * to the user, with a fast model in a separate call. It can only FLAG;
 * repair is a rewrite with the violation named, then a fixed fallback.
 */

export type SafetyOutcome = "pass" | "rewritten" | "fallback";

export type SafetyVerdict = {
  ok: boolean;
  diagnosis: boolean;
  medicationAdvice: boolean;
  missedRedFlag: boolean;
  reasons: string;
  outcome?: SafetyOutcome;
};

/**
 * Field ORDER matters: with strict JSON output the model writes fields in
 * schema order, so `analysis` comes first — it must reason before it judges.
 * (With the booleans first it flagged answers its own reasoning called safe.)
 */
const SCHEMA = {
  type: "object",
  properties: {
    analysis: {
      type: "string",
      description:
        "Step by step: (1) quote each sentence that could be a diagnosis, medication/supplement advice, or a missed emergency; (2) for each, decide whether it actually breaks a rule or is an allowed education / refusal / hand-off; (3) conclude. Merely NAMING a medication or supplement the user asked about while declining to advise is allowed.",
    },
    diagnosis: {
      type: "boolean",
      description: "TRUE only if the answer states or implies the user HAS a condition not on their record, or interprets results into a condition (e.g. 'this indicates prediabetes'). Education about what a biomarker means is FALSE.",
    },
    medicationAdvice: {
      type: "boolean",
      description: "TRUE only if the answer recommends, doses, compares, endorses, or tells the user to start/stop/change a medication or supplement. FALSE when the answer declines and refers them to a doctor, restates what is on record, or lists FOOD sources of a nutrient.",
    },
    missedRedFlag: {
      type: "boolean",
      description: "TRUE only if the user described an emergency-level symptom and the answer did not direct them to urgent care.",
    },
  },
  required: ["analysis", "diagnosis", "medicationAdvice", "missedRedFlag"],
  additionalProperties: false,
} as const;

const SYSTEM = `You audit answers from a wellness assistant inside a health app. Judge ONLY the assistant's answer.

ALLOWED (do not flag): explaining what a biomarker measures and its reference range; saying a value is outside the range the lab flags and suggesting the user discuss it with their doctor; lifestyle guidance (food, sleep, movement, hydration); naming food sources of a nutrient; restating medications/conditions already on the user's record; explicitly declining to advise on a medication or supplement — even while naming it — and handing off to the doctor; offering to summarise labs, message the care team or book a visit.

NOT ALLOWED (flag): stating or implying a diagnosis the user does not have on record; recommending, dosing, comparing or endorsing any medication or supplement, or saying the user should/could take or ask about one as a suggestion; triaging severity ('probably nothing'); ignoring an emergency.

Be precise and literal. A refusal that names the drug is a refusal, not advice.`;

type RawVerdict = { analysis: string; diagnosis: boolean; medicationAdvice: boolean; missedRedFlag: boolean };

export async function checkOutput(llm: LLMClient, userMessage: string, answer: string, onRecord: { conditions: string[]; medications: string[] }): Promise<SafetyVerdict> {
  const v = await llm.json<RawVerdict>({
    system: SYSTEM,
    user: `ON RECORD — conditions: ${onRecord.conditions.join(", ") || "none"}; medications: ${onRecord.medications.join(", ") || "none"}\n\nUSER MESSAGE:\n${userMessage.slice(0, 2000)}\n\nASSISTANT ANSWER:\n${answer.slice(0, 6000)}`,
    schema: SCHEMA as unknown as Record<string, unknown>,
    schemaName: "safety_verdict",
  });
  return {
    diagnosis: v.diagnosis,
    medicationAdvice: v.medicationAdvice,
    missedRedFlag: v.missedRedFlag,
    reasons: v.analysis,
    ok: !v.diagnosis && !v.medicationAdvice && !v.missedRedFlag,
  };
}

export async function rewriteUnsafe(llm: LLMClient, answer: string, verdict: SafetyVerdict): Promise<string> {
  const problems = [
    verdict.diagnosis && "it names/implies a diagnosis",
    verdict.medicationAdvice && "it gives medication or supplement advice",
    verdict.missedRedFlag && "it fails to direct the user to urgent care",
  ]
    .filter(Boolean)
    .join("; ");
  const r = await llm.json<{ answer: string }>({
    system: `Rewrite the assistant answer so it keeps every useful, allowed part (education, lifestyle guidance, data the user asked about) but removes the violation: ${problems}. Replace removed advice with a warm, specific hand-off to the user's doctor/care team (offer to message them). Keep the same tone and length or shorter. Return only the rewritten answer.`,
    user: `REVIEWER NOTE: ${verdict.reasons}\n\nANSWER TO REWRITE:\n${answer}`,
    schema: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false },
    schemaName: "rewritten_answer",
  });
  return r.answer;
}

export const SAFE_FALLBACK =
  "I can't give advice on that part — it's a question for your doctor, and I don't want to guess about something that matters this much. I can pull together what's in your data to make that conversation easier, or send a note to your care team. Which would help?";
