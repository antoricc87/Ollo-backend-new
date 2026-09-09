import { evaluate, highestLevel } from "./redflags";
import { requiredSlots } from "./protocols";
import { EncounterState, Phase, Protocol, Slot, SlotValue, TrippedFlag } from "./types";

/**
 * Which question comes next, and when the check-in is done. Deterministic:
 * the model never decides to stop early, skip the safety screen, or keep
 * going past the cap.
 */

/** Hard ceiling so a session cannot wander. Generous — protocols are ~7 slots. */
export const MAX_TURNS = 15;

/** Slots that carry red-flag criteria. Always asked FIRST, before any history. */
const SAFETY_SLOT_KEYS = ["associated", "safety"];

/**
 * Rules that end the interview immediately. Continuing to take a history from
 * someone describing self-harm is the wrong thing to do — they get the crisis
 * script and a route to a person, not question 4 of 7.
 */
const HALT_RULES = ["mood.self_harm", "text.self_harm"];

export const shouldHalt = (flags: TrippedFlag[]): boolean => flags.some((f) => HALT_RULES.indexOf(f.ruleId) >= 0);

const isAnswered = (state: EncounterState, key: string): boolean => {
  const v = state.slots[key];
  if (v === undefined || v === null) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "string") return v.trim().length > 0;
  return true;
};

/** Asked once and skipped counts as done — we don't badger. */
const isSettled = (state: EncounterState, key: string): boolean => isAnswered(state, key) || state.askedKeys.indexOf(key) >= 0;

const isSafety = (s: Slot) => SAFETY_SLOT_KEYS.indexOf(s.key) >= 0;

export type Step =
  | { kind: "ask"; slot: Slot; phase: Phase }
  | { kind: "done"; phase: Phase };

/**
 * The next thing to do. Order: safety screen → required history → optional
 * history → recap. Never re-asks a settled slot.
 */
export const nextStep = (state: EncounterState, protocol: Protocol): Step => {
  if (shouldHalt(state.redFlags)) return { kind: "done", phase: "ROUTE" };
  if (state.turns >= MAX_TURNS) return { kind: "done", phase: "RECAP" };

  const pending = (pred: (s: Slot) => boolean) => protocol.slots.filter((s) => pred(s) && !isSettled(state, s.key))[0];

  const safety = pending(isSafety);
  if (safety) return { kind: "ask", slot: safety, phase: "SAFETY_SCREEN" };

  const required = pending((s) => s.required && !isSafety(s));
  if (required) return { kind: "ask", slot: required, phase: "HISTORY" };

  const optional = pending((s) => !s.required && !isSafety(s));
  if (optional) return { kind: "ask", slot: optional, phase: "HISTORY" };

  return { kind: "done", phase: "RECAP" };
};

/** Every required slot settled (answered or explicitly skipped). */
export const historyComplete = (state: EncounterState, protocol: Protocol): boolean =>
  requiredSlots(protocol).every((s) => isSettled(state, s.key));

/**
 * Records one answer and returns the next state. Red flags are re-evaluated on
 * every turn and are additive — `evaluate` never drops one already stuck.
 */
export const applyAnswer = (
  state: EncounterState,
  protocol: Protocol,
  slotKey: string,
  value: SlotValue,
  freeText?: string
): EncounterState => {
  const next: EncounterState = {
    ...state,
    slots: { ...state.slots, [slotKey]: value },
    askedKeys: state.askedKeys.indexOf(slotKey) >= 0 ? state.askedKeys : [...state.askedKeys, slotKey],
    turns: state.turns + 1,
  };
  next.redFlags = evaluate(next, freeText);
  next.phase = nextStep(next, protocol).phase;
  return next;
};

/** Marks a slot as put to the user, so a skip isn't asked again. */
export const markAsked = (state: EncounterState, slotKey: string): EncounterState =>
  state.askedKeys.indexOf(slotKey) >= 0 ? state : { ...state, askedKeys: [...state.askedKeys, slotKey] };

/** Opens the encounter: the text prescan runs before anything else. */
export const open = (state: EncounterState, protocol: Protocol): EncounterState => {
  const withFlags: EncounterState = { ...state, redFlags: evaluate(state, state.complaintText) };
  return { ...withFlags, phase: nextStep(withFlags, protocol).phase };
};

export const escalationLevel = (state: EncounterState) => highestLevel(state.redFlags);
