import { REGIONS, Region, emergencyNumbersLine } from "../../agent/safety/policy";
import { RedFlagLevel, TrippedFlag } from "./types";

/**
 * ESCALATE copy. Fixed strings assembled from a region table — never generated
 * at runtime, because this is the one output where a model getting creative is
 * unacceptable.
 *
 * Note what these scripts do NOT say: they do not tell the user how serious it
 * is or what it might be. They restate the criterion the user themselves
 * matched, name its source, and say what to do. The judgement stays with the
 * guideline (Rule 1).
 */

export type EscalationScript = {
  level: RedFlagLevel;
  title: string;
  body: string;
  /** The matched criteria, verbatim, with their sources. */
  criteria: string[];
  action: string;
};

export const escalationFor = (flags: TrippedFlag[], region?: Region | null): EscalationScript | null => {
  if (!flags.length) return null;
  const emergency = flags.filter((f) => f.level === "EMERGENCY");
  const numbers = region ? REGIONS[region].emergencyNumber : emergencyNumbersLine(null);
  const criteria = (emergency.length ? emergency : flags).map((f) => `${f.criterion} (${f.source.org}, ${f.source.year})`);

  if (flags.some((f) => f.ruleId === "mood.self_harm" || f.ruleId === "text.self_harm")) {
    return {
      level: "EMERGENCY",
      title: "Please talk to someone now",
      body: "I'm glad you told me. I'm not the right kind of help for this, and I don't want to keep you filling in a form.",
      criteria: [],
      action: `Call your local emergency number (${numbers}) if you're in immediate danger. You can also reach ${
        region ? REGIONS[region].crisisLine : "988 (Suicide & Crisis Lifeline) in the US"
      } any time.`,
    };
  }

  if (emergency.length) {
    return {
      level: "EMERGENCY",
      title: "This is on the list of things that shouldn't wait",
      body: "What you've told me matches something clinicians treat as an emergency. I can't tell you how serious your situation is — but I can tell you this is on that list.",
      criteria,
      action: `Call your local emergency number now (${numbers}) or get to the nearest emergency department. Don't drive yourself.`,
    };
  }

  return {
    level: "SEEK_CARE_NOW",
    title: "Worth being seen today",
    body: "What you've told me matches something clinicians say should be looked at the same day rather than left.",
    criteria,
    action: "Contact your doctor today, or use an urgent care service. I'll keep everything you've told me ready to hand over.",
  };
};

/** The neutral close. Deliberately carries no verdict — it is a REFLECT plus a ROUTE. */
export const NEUTRAL_CLOSE =
  "That's everything written down. I can't tell you how serious this is or what's causing it — that needs a clinician. Here's how to get it looked at.";
