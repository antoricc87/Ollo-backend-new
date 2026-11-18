import { EncounterRoute } from "@prisma/client";
import { Protocol, SlotValue } from "./types";

/**
 * WORSE MEANS ASK THE WARNING SIGNS AGAIN (Nov 16 2026).
 *
 * The warning-sign rules (redflags.ts) read the interview's answers, chiefly
 * the `associated` question — so a follow-up that only records "worse" never
 * gave them anything new to read, and "worse, and now my leg is weak" was
 * written down as "worse". After a worse answer the same warning-sign
 * question is put again, and the answer goes through the same path as in the
 * interview (`EncounterService.answer` → `applyAnswer` → `evaluate`), so a
 * match escalates exactly as it would have on day 1. Their own words go with
 * it, so the text prescan runs too.
 */

export const RESCREEN_SLOT = "associated";
export const NONE = "none_of_these";

export type Rescreen = { slotKey: string; question: string; options: { value: string; label: string }[] };

/** The question, built from the protocol's own warning-sign options. Null when the protocol has none. */
export const rescreenFor = (protocol: Protocol): Rescreen | null => {
  const slot = protocol.slots.find((s) => s.key === RESCREEN_SLOT);
  if (!slot?.options?.length) return null;
  return { slotKey: slot.key, question: "Since it's worse — is any of these new?", options: slot.options.map((o) => ({ value: o.value, label: o.label })) };
};

/**
 * What the slot holds after the re-check: everything ever reported stays
 * (escalation is one-way — a sign said on day 1 is never un-said), plus what
 * is new. "None of these" adds nothing; it only replaces an earlier "none".
 */
export const mergeSigns = (existing: SlotValue, picked: string[]): string[] => {
  const before = (Array.isArray(existing) ? existing : existing ? [String(existing)] : []).filter((v) => v !== NONE);
  const added = picked.filter((v) => v !== NONE && before.indexOf(v) < 0);
  const merged = [...before, ...added];
  return merged.length ? merged : [NONE];
};

/* ---------------------- what they chose when offered a clinician ---------------------- */

/**
 * The answer to the clinician offer is kept on the check-in (`route`), so a
 * "no thanks" is not met with the same offer at every worse answer (ruling
 * Nov 16 2026). Any decided route ends the offers for that check-in; a
 * warning sign still escalates — that is not an offer.
 */
export type RouteChoice = "ollo_doctor" | "own_doctor" | "keep_watching";

export const ROUTE_OF: Record<RouteChoice, EncounterRoute> = {
  ollo_doctor: "OLLO_DOCTOR",
  own_doctor: "OWN_DOCTOR",
  keep_watching: "TRACKING",
};

export const routeDecided = (route: EncounterRoute | string | null | undefined) => !!route && route !== "UNDECIDED";

/** How the follow-up section names a decided route, so Ollie does not offer again. */
export const ROUTE_LINE: Record<string, string> = {
  OLLO_DOCTOR: "chose an Ollo clinician / the care team",
  OWN_DOCTOR: "said they will see their own doctor",
  TRACKING: "said no thanks to a clinician for now, keeping an eye on it",
  CRISIS: "was given the crisis route",
};
