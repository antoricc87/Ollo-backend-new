import { OwnDataBlock, renderOwnData } from "./context";
import { EncounterState, Protocol, Slot } from "./types";

/**
 * Turns the structured record into the three things a check-in produces: a
 * recap for the user, a handout for a clinician, and a booking reason.
 *
 * Every line here is a REFLECT or a CITE — a restatement of what the user
 * answered, or a red-flag criterion with its source. Nothing in this file
 * interprets, ranks, judges severity or predicts anything, and nothing should
 * ever be added that does. It is deliberately not model-generated: a summary
 * is exactly where a fluent model would be tempted to add "which suggests…".
 */

const labelFor = (slot: Slot, value: unknown): string => {
  const v = String(value);
  const opt = (slot.options ?? []).find((o) => o.value === v);
  return opt ? opt.label : v;
};

const answerText = (slot: Slot, value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    const labels = value.map((v) => labelFor(slot, v)).filter(Boolean);
    return labels.length ? labels.join(", ") : null;
  }
  if (slot.kind === "scale") return `${value} out of ${slot.range ? slot.range[1] : 10}`;
  const s = String(value).trim();
  return s.length ? labelFor(slot, s) : null;
};

export type RecapLine = { question: string; answer: string };

/** What you told me — the answered slots, in the order they were asked. */
export const recapLines = (state: EncounterState, protocol: Protocol): RecapLine[] => {
  const lines: RecapLine[] = [];
  for (const slot of protocol.slots) {
    const a = answerText(slot, state.slots[slot.key]);
    if (a) lines.push({ question: slot.prompt, answer: a });
  }
  return lines;
};

/** One line per tripped criterion, with the body that publishes it. */
export const flagLines = (state: EncounterState): string[] =>
  state.redFlags.map((f) => `${f.criterion} (${f.source.org}, ${f.source.year})`);

/**
 * The clinician handout. Carries its own provenance line: whoever reads this
 * needs to know it is a patient's self-report captured by software, not an
 * assessment.
 */
export const handout = (
  state: EncounterState,
  protocol: Protocol,
  patient: { firstName?: string | null; age?: number | null; sex?: string | null } = {},
  ownData: OwnDataBlock[] = []
): string => {
  const who = [patient.firstName, patient.age ? `${patient.age}` : null, patient.sex].filter(Boolean).join(", ");
  const out: string[] = [];

  out.push(`CHECK-IN — ${protocol.title}`);
  if (who) out.push(who);
  out.push("");
  out.push("IN THEIR WORDS");
  out.push(state.complaintText.trim() || "(not recorded)");
  out.push("");
  out.push("HISTORY");
  for (const line of recapLines(state, protocol)) out.push(`- ${line.question} ${line.answer}`);

  if (state.redFlags.length) {
    out.push("");
    out.push("CRITERIA THE PATIENT MATCHED");
    for (const line of flagLines(state)) out.push(`- ${line}`);
  }

  for (const line of renderOwnData(ownData)) out.push(line);

  out.push("");
  out.push(
    "Patient self-report captured by an AI intake tool. Not a clinical assessment, not reviewed by a clinician, and no diagnosis or triage decision has been made or implied."
  );
  return out.join("\n");
};

/** Goes on the booking so the clinician sees why it was made. Never a diagnosis label. */
export const bookingReason = (protocol: Protocol): string => `Check-in: ${protocol.title.toLowerCase()}`;
