import { Region } from "../../agent/safety/policy";
import { escalationFor, EscalationScript } from "./escalation";
import { flagLines } from "./summary";
import { EncounterState, Protocol } from "./types";

/**
 * The ending of a check-in: what this could be.
 *
 * Ruling 2026-09-16 (user), which SUPERSEDES the "never say what it might be"
 * design: the check-in is a conversation that ends with candidate conditions,
 * disclaimed, with a clinician as the next step — the posture Doctronic ships
 * (an AI that is explicitly not a doctor, plus real physicians behind it).
 *
 * So this file is the one place in the codebase where model-authored clinical
 * content is allowed through, and it is bounded hard:
 *   - the SHAPE is fixed here (2–4 possibilities, each with what fits, what
 *     does not, and what would change it);
 *   - the WARNING SIGNS and the ESCALATION are code-built from the protocol and
 *     the tripped rules — never model text (escalation.ts, summary.ts);
 *   - `validate` rejects the phrasings that are still forbidden INSIDE a
 *     check-in (dose, reassurance, prognosis, triage windows, confidence
 *     claims), so the model rewrites instead of the guard silently rewriting;
 *   - escalation is still ONE-WAY: a tripped red flag overrides whatever next
 *     step the model asked for, and nothing here can lower it.
 *
 * The handout (summary.ts) stays code-built and unchanged. A clinician reading
 * it must see the patient's own words, not our model's guesses.
 */

export const CHECKIN_DISCLAIMER =
  "I'm an AI trained on medical data, not a doctor — this isn't a diagnosis, and a clinician needs to confirm it.";

export const MIN_POSSIBILITIES = 2;
export const MAX_POSSIBILITIES = 4;
const MAX_REASONS = 4;

export type PossibilityInput = {
  /** A condition in plain language. "Tension-type headache", not "cephalalgia". */
  condition: string;
  /** The person's OWN answers that fit it. At least one — an unargued guess is not useful. */
  fits: string[];
  /** Anything that argues against it. Optional, and worth more than another `fits` line. */
  doesNotFit?: string[];
  /** The answer, test or change that would move this up or down. */
  wouldChange?: string;
};

export type Possibility = Required<Pick<PossibilityInput, "condition" | "fits">> & {
  doesNotFit: string[];
  wouldChange: string | null;
};

/**
 * Where the conversation sends them. EMERGENCY and SEE_SOMEONE_TODAY are
 * decided by the rules, never by the model.
 */
export type NextStepKind = "EMERGENCY" | "SEE_SOMEONE_TODAY" | "BOOK_OLLO_DOCTOR" | "OWN_DOCTOR" | "WATCH_AND_CHECK_BACK";

export const NEXT_STEP_KINDS: NextStepKind[] = ["EMERGENCY", "SEE_SOMEONE_TODAY", "BOOK_OLLO_DOCTOR", "OWN_DOCTOR", "WATCH_AND_CHECK_BACK"];

export type Assessment = {
  possibilities: Possibility[];
  /** Published criteria for this complaint, in the words the user was asked them in. */
  warningSigns: string[];
  /** Criteria the user already matched, with their source. Empty when none tripped. */
  matched: string[];
  escalation: EscalationScript | null;
  nextStep: { kind: NextStepKind; why: string };
  disclaimer: string;
};

/** Thrown with a message written FOR THE MODEL — the tool hands it back so it can rewrite. */
export class AssessmentRejected extends Error {}

/* ------------------------------ what may not be said ----------------------- */

/**
 * Still forbidden inside a check-in. Naming a candidate condition is now
 * allowed; these are not, and they are the half of the boundary that protects
 * someone from staying home when they shouldn't.
 */
const BANNED: { id: string; re: RegExp; why: string }[] = [
  { id: "confidence", re: /\b\d{1,3}\s?%|\bi'?m (sure|certain|confident)\b|\bdefinitely\b|\bcertainly\b|\bclinically (validated|proven)\b/i, why: "no confidence or accuracy claims — say what fits and what doesn't instead" },
  { id: "dose", re: /\b\d+(\.\d+)?\s?(mg|mcg|µg|ug|iu|ui)\b|\b(take|start|stop|switch to|double|halve) (a |an |the )?(ibuprofen|paracetamol|acetaminophen|aspirin|antibiotics?|antihistamines?|statins?|metformin|omeprazole|melatonin|supplements?)\b/i, why: "no medication, supplement or dose advice — that is the clinician's call" },
  { id: "reassure", re: /\b(nothing to worry about|no need to worry|don'?t worry|no cause for concern|nothing serious|not serious|probably (just |)(nothing|fine)|you'?re fine|perfectly (normal|fine)|harmless)\b/i, why: "no reassurance — you may raise concern, never lower it" },
  { id: "triage", re: /\b(can wait|no rush|not urgent|you don'?t need (to see|a doctor|urgent|medical)|not an emergency)\b|\b(within|in) (the next )?(24|48|72) hours\b|\b(reasonable|fine|okay|ok|safe|sensible) to (wait|watch|hold off)\b|\b(wait|watch) and see\b/i, why: "no verdict on how urgent this is — offer a route, don't grade the urgency" },
  { id: "prognose", re: /\b(should|will|usually|typically|normally) (clear up|resolve|go away|settle|pass|improve on its own)\b|\b(lasts?|goes away|clears up) (in|within|after) (a few|\d+) (days?|weeks?)\b/i, why: "no prediction of how this will go — you cannot know that" },
];

const scan = (fields: string[]) => {
  for (const text of fields) {
    for (const rule of BANNED) {
      const m = text.match(rule.re);
      if (m) throw new AssessmentRejected(`"${m[0]}" is not allowed in a check-in assessment: ${rule.why}. Rewrite that line and call the tool again.`);
    }
  }
};

/* --------------------------------- warning signs --------------------------- */

/** Slots that carry published red-flag criteria — mirrors stateMachine's list. */
const SAFETY_SLOT_KEYS = ["associated", "safety"];

const NONE_OF_THESE = /^(none of these|none|no)$/i;

/**
 * The "go sooner if" list, taken from the protocol's own safety options — the
 * same published criteria the person was screened against, in the same words.
 * Code-built on purpose: this is the line that has to be right even when the
 * model is having an off day.
 */
export const warningSignsFor = (protocol: Protocol): string[] =>
  protocol.slots
    .filter((s) => SAFETY_SLOT_KEYS.indexOf(s.key) >= 0)
    .flatMap((s) => (s.options ?? []).map((o) => o.label))
    .filter((label) => !NONE_OF_THESE.test(label.trim()));

/* ---------------------------------- build ---------------------------------- */

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

const list = (values: string[] | undefined, max: number): string[] =>
  (values ?? []).map(clean).filter(Boolean).slice(0, max);

/**
 * Validates the model's possibilities and assembles the assessment around the
 * parts only code may write. Throws `AssessmentRejected` with an instruction
 * the model can act on.
 */
export const buildAssessment = (
  input: { possibilities: PossibilityInput[]; nextStep?: { kind?: string; why?: string } },
  state: EncounterState,
  protocol: Protocol,
  region: Region | null = null
): Assessment => {
  const raw = (input.possibilities ?? []).filter((p) => p && clean(p.condition ?? ""));
  if (raw.length < MIN_POSSIBILITIES)
    throw new AssessmentRejected(
      `A check-in assessment needs at least ${MIN_POSSIBILITIES} possibilities — one candidate on its own reads as a diagnosis. Give ${MIN_POSSIBILITIES}–${MAX_POSSIBILITIES}, most consistent first.`
    );

  const possibilities: Possibility[] = raw.slice(0, MAX_POSSIBILITIES).map((p) => {
    const condition = clean(p.condition);
    const fits = list(p.fits, MAX_REASONS);
    if (!fits.length) throw new AssessmentRejected(`"${condition}" has nothing under what fits. Say which of their own answers points at it, or drop it.`);
    const doesNotFit = list(p.doesNotFit, MAX_REASONS);
    const wouldChange = p.wouldChange ? clean(p.wouldChange) : null;
    scan([condition, ...fits, ...doesNotFit, ...(wouldChange ? [wouldChange] : [])]);
    return { condition, fits, doesNotFit, wouldChange };
  });

  const escalation = escalationFor(state.redFlags, region);
  const why = clean(input.nextStep?.why ?? "");
  scan(why ? [why] : []);

  // Escalation is one-way: a tripped rule decides the next step, whatever the model asked for.
  const nextStep = escalation
    ? { kind: (escalation.level === "EMERGENCY" ? "EMERGENCY" : "SEE_SOMEONE_TODAY") as NextStepKind, why: escalation.action }
    : {
        kind: (NEXT_STEP_KINDS.indexOf(input.nextStep?.kind as NextStepKind) >= 0 ? (input.nextStep!.kind as NextStepKind) : "BOOK_OLLO_DOCTOR") as NextStepKind,
        why: why || "A clinician can confirm what this is and what to do about it.",
      };

  return {
    possibilities,
    warningSigns: warningSignsFor(protocol),
    matched: flagLines(state),
    escalation,
    nextStep,
    disclaimer: CHECKIN_DISCLAIMER,
  };
};
