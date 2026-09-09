import { PanelSource } from "../../labs_journey/domain/screening.rules";

/**
 * The check-in ("encounter") domain. See docs/ai-check-in-architecture.md in
 * the mobile repo for why this exists and what it may never do.
 *
 * Everything in this folder is PURE and deterministic: no LLM, no Prisma, no
 * I/O. The model's job in this feature is to fill slots and phrase questions;
 * every decision — which question comes next, whether a red flag tripped, when
 * the history is complete, what the handout says — is made here, where it can
 * be unit-tested and read by a human.
 */

export type { PanelSource };

export type SlotKind = "single" | "multi" | "scale" | "duration" | "freetext";

export type SlotOption = { value: string; label: string };

export type Slot = {
  key: string;
  kind: SlotKind;
  /** The default phrasing. A model may rephrase it; it may never change which slot is asked. */
  prompt: string;
  required: boolean;
  options?: SlotOption[];
  /** 0–10 for `scale`. */
  range?: [number, number];
};

export type Protocol = {
  key: string;
  version: number;
  /** What the user picked, in their words. Never a diagnosis label. */
  title: string;
  /** Shown once when the protocol opens, to set expectations. */
  opener: string;
  slots: Slot[];
  source: PanelSource;
};

export type SlotValue = string | string[] | number | null;

export type RedFlagLevel = "EMERGENCY" | "SEEK_CARE_NOW";

export type TrippedFlag = {
  ruleId: string;
  level: RedFlagLevel;
  /** The criterion in plain language — what the user is being asked to check against. */
  criterion: string;
  source: PanelSource;
};

export type Phase =
  | "OPENING"
  | "SAFETY_SCREEN"
  | "HISTORY"
  | "CONTEXT"
  | "RECAP"
  | "ROUTE"
  | "CLOSED";

/** Everything known about one check-in. The single argument to every pure function here. */
export type EncounterState = {
  complaintKey: string;
  protocolVersion: number;
  phase: Phase;
  /** What the user typed to open the check-in, verbatim. */
  complaintText: string;
  slots: Record<string, SlotValue>;
  /** Slots already put to the user — asked-and-skipped must not be asked again. */
  askedKeys: string[];
  /** Sticky: acknowledging a flag does not clear it, and it appears on the handout. */
  redFlags: TrippedFlag[];
  turns: number;
};

export const emptyState = (complaintKey: string, complaintText: string, protocolVersion: number): EncounterState => ({
  complaintKey,
  protocolVersion,
  phase: "OPENING",
  complaintText,
  slots: {},
  askedKeys: [],
  redFlags: [],
  turns: 0,
});
