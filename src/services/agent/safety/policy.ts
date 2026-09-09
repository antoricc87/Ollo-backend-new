/**
 * The safety contract, as data.
 *
 * The hard boundary is stated three times in this codebase: in Ollie's system
 * prompt (prose the model reads), in the output classifier's rubric (prose a
 * second model reads), and in `lint.ts` (patterns a regex engine reads). This
 * module is the single source of truth those three agree on, so a change to
 * the boundary is one edit and the eval suite can assert against the same list.
 *
 * See docs/ai-check-in-architecture.md in the mobile repo for the reasoning.
 */

/* --------------------------- the speech acts ---------------------------- */

/** What Ollie is allowed to do with a sentence. */
export type AllowedAct =
  | "ASK"
  | "REFLECT"
  | "OBSERVE_OWN_DATA"
  | "CITE"
  | "ESCALATE"
  | "ROUTE"
  | "TRACK"
  | "DECLINE";

/** What no answer may ever contain. Each maps to rules in `lint.ts`. */
export type ForbiddenAct =
  | "DIAGNOSE"
  | "TREAT_OR_DOSE"
  | "REASSURE"
  | "TRIAGE_VERDICT"
  | "PROGNOSE"
  | "CLAIM_ACCURACY";

export const ALLOWED_ACTS: Record<AllowedAct, string> = {
  ASK: "A question that moves the conversation forward.",
  REFLECT: "Restates what the user said, adding nothing.",
  OBSERVE_OWN_DATA: "The user's own measured data, with its date, source and the lab's reference range.",
  CITE: "A named source with its scope quoted, no extrapolation beyond it.",
  ESCALATE: "Fixed red-flag copy directing the user to urgent care. Never generated at runtime.",
  ROUTE: "Offers an in-product path to care: summarise for the doctor, message the care team, book a visit.",
  TRACK: "Offers to log, watch or follow up on something.",
  DECLINE: "Says plainly what Ollie cannot do, then offers the useful thing it can.",
};

export const FORBIDDEN_ACTS: Record<ForbiddenAct, { label: string; why: string; example: string }> = {
  DIAGNOSE: {
    label: "diagnosis",
    why: "Analysing patient-specific data into a condition is a device function (FD&C 201(h); the Cures 520(o)(1)(E) decision-support carve-out covers professionals, not patients).",
    example: "\"This looks like prediabetes.\"",
  },
  TREAT_OR_DOSE: {
    label: "treatment or dose",
    why: "Device function, and the one that can harm directly.",
    example: "\"Try 2000 IU of vitamin D3.\"",
  },
  REASSURE: {
    label: "reassurance",
    why: "Escalation is one-way. Absence of a red flag is never evidence of safety, and reassurance is the half of triage that actually hurts people.",
    example: "\"That's probably nothing to worry about.\"",
  },
  TRIAGE_VERDICT: {
    label: "triage verdict",
    why: "Assigning a level of care is triage, which is a medical device under EU MDR Rule 11.",
    example: "\"You can wait until next week to see someone.\"",
  },
  PROGNOSE: {
    label: "prognosis",
    why: "An unsubstantiated claim about the course of an untriaged complaint.",
    example: "\"This usually clears up in a few days.\"",
  },
  CLAIM_ACCURACY: {
    label: "accuracy claim",
    why: "Unsubstantiated performance claims about the product (FTC Act §5).",
    example: "\"I'm 90% sure.\"",
  },
};

/* ------------------------------- rollout -------------------------------- */

/**
 * `enforce` (default) — a lexical finding forces the rewrite → fallback path.
 * `report`  — findings are recorded in the audit log and the verdict, but do
 *             not change the answer. Lets a new rule bake against real traffic
 *             before it can affect a reply. Set AGENT_SAFETY_LINT=report.
 */
export type LintMode = "enforce" | "report";

export const lintMode = (): LintMode =>
  process.env.AGENT_SAFETY_LINT === "report" ? "report" : "enforce";

/* ------------------------------- regions -------------------------------- */

/**
 * Emergency numbers were hardcoded into the red-flag copy. They are data now,
 * so a locale outside the US/EU is a table row rather than a code change.
 */
export type Region = "US" | "EU" | "IT" | "UK" | "AU" | "CA";

export type RegionPolicy = {
  emergencyNumber: string;
  /** Named exactly as the user would dial it, with the service's own name. */
  crisisLine: string;
};

export const REGIONS: Record<Region, RegionPolicy> = {
  US: { emergencyNumber: "911", crisisLine: "988 (Suicide & Crisis Lifeline)" },
  CA: { emergencyNumber: "911", crisisLine: "988 (Suicide Crisis Helpline)" },
  EU: { emergencyNumber: "112", crisisLine: "112" },
  IT: { emergencyNumber: "112", crisisLine: "Telefono Amico 02 2327 2327" },
  UK: { emergencyNumber: "999", crisisLine: "Samaritans 116 123" },
  AU: { emergencyNumber: "000", crisisLine: "Lifeline 13 11 14" },
};

export const DEFAULT_REGION: Region = "US";

/** ISO country codes whose region key differs from the code itself. */
const ALIASES: Record<string, Region> = { GB: "UK", NZ: "AU" };

/** Maps a BCP-47 locale ("it-IT", "en-GB") to the closest region we have copy for. */
export const resolveRegion = (locale?: string | null): Region => {
  const country = (locale ?? "").split(/[-_]/)[1]?.toUpperCase();
  if (!country) return DEFAULT_REGION;
  if (ALIASES[country]) return ALIASES[country];
  if (country in REGIONS) return country as Region;
  const EU_COUNTRIES = ["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE"];
  return EU_COUNTRIES.indexOf(country) >= 0 ? "EU" : DEFAULT_REGION;
};

/**
 * Derives a region from an IANA time zone ("Europe/Rome" → IT), which is what
 * `Patient.timeZone` already holds. Returns null rather than guessing, so the
 * caller falls back to the both-numbers line instead of naming a wrong number.
 */
const ZONE_REGION: Record<string, Region> = {
  "Europe/Rome": "IT",
  "Europe/London": "UK",
  "Australia/Sydney": "AU",
  "Australia/Melbourne": "AU",
  "Australia/Brisbane": "AU",
  "Australia/Perth": "AU",
};

export const regionFromTimeZone = (tz?: string | null): Region | null => {
  if (!tz) return null;
  if (ZONE_REGION[tz]) return ZONE_REGION[tz];
  const area = tz.split("/")[0];
  if (area === "America") return "US"; // US and CA share 911
  if (area === "Europe") return "EU";
  return null;
};

/** "911 in the US, 112 in Europe" — the line used when no region is known. */
export const emergencyNumbersLine = (region?: Region | null): string =>
  region ? REGIONS[region].emergencyNumber : "911 in the US, 112 in Europe";
