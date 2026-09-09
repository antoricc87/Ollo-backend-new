import { detectRedFlag } from "../../agent/safety/redFlags";
import { slug } from "./protocols";
import { EncounterState, PanelSource, RedFlagLevel, TrippedFlag } from "./types";

/**
 * The safety net. Deterministic, evaluated on EVERY turn, and one-way: these
 * rules may RAISE concern and nothing anywhere may lower it (Rule 2 in
 * docs/ai-check-in-architecture.md).
 *
 * Two keys, as on the output guard:
 *   1. a raw-text prescan, reusing the agent's existing `detectRedFlag` so the
 *      opening sentence trips before any model is called;
 *   2. these structured rules over answered slots.
 * A model may add a flag the table missed. It may never clear one.
 *
 * Tuned for RECALL, not precision. A false escalation costs an unnecessary
 * phone call; a missed one is the only outcome that actually matters.
 *
 * ⚠ CITATIONS NOT YET VERIFIED. Every `criterion` below is drafted from
 * standard urgent-referral advice and is written in plain language, not quoted
 * from the cited body. Before launch each one must be checked against the
 * source named in `source` and reworded to match it — the whole compliance
 * argument (§3.2 Rule 1) rests on these being the guideline's criteria and not
 * ours. Do the same pass screening.rules.ts documents for its citations.
 */

const NHS: PanelSource = { org: "NHS — when to get urgent help", year: 2025, url: "https://www.nhs.uk/nhs-services/urgent-and-emergency-care-services/" };
const AHA: PanelSource = { org: "American Heart Association — warning signs", year: 2024, url: "https://www.heart.org/en/health-topics/heart-attack/warning-signs-of-a-heart-attack" };
const NICE: PanelSource = { org: "NICE Clinical Knowledge Summaries", year: 2025, url: "https://cks.nice.org.uk/" };

export type RedFlagRule = {
  id: string;
  level: RedFlagLevel;
  /** Which protocol this applies to; null = every protocol. */
  complaint: string | null;
  slotKey: string;
  /** Any one of these option LABELS trips the rule. Matched by slug, so they must exist in the protocol. */
  labels: string[];
  criterion: string;
  source: PanelSource;
};

export const RULES: RedFlagRule[] = [
  {
    id: "cardiac.radiating",
    level: "EMERGENCY",
    complaint: "chest_discomfort",
    slotKey: "associated",
    labels: ["Spreading to my arm, jaw, neck or back", "Cold sweat", "Short of breath"],
    criterion: "Chest discomfort with pain spreading to the arm, jaw, neck or back, a cold sweat, or breathlessness is treated as a possible heart attack and is a reason to call emergency services.",
    source: AHA,
  },
  {
    id: "cardiac.at_rest",
    level: "SEEK_CARE_NOW",
    complaint: "chest_discomfort",
    slotKey: "trigger",
    labels: ["At rest"],
    criterion: "Chest discomfort that comes on at rest is a reason to be seen the same day rather than waiting.",
    source: AHA,
  },
  {
    id: "breath.sudden",
    level: "EMERGENCY",
    complaint: "breathlessness",
    slotKey: "speed",
    labels: ["Suddenly, within minutes"],
    criterion: "Breathlessness that comes on suddenly, within minutes, is a reason to call emergency services.",
    source: NHS,
  },
  {
    id: "breath.haemoptysis",
    level: "EMERGENCY",
    complaint: "breathlessness",
    slotKey: "associated",
    labels: ["Coughing up blood", "Chest pain"],
    criterion: "Breathlessness with chest pain or coughing up blood is a reason to call emergency services.",
    source: NHS,
  },
  {
    id: "head.thunderclap",
    level: "EMERGENCY",
    complaint: "headache",
    slotKey: "associated",
    labels: ["Came on like a thunderclap", "Weakness or numbness on one side", "Confusion", "Rash that doesn't fade when pressed"],
    criterion: "A headache that peaks within seconds, or comes with one-sided weakness, confusion, or a rash that does not fade under pressure, is a reason to call emergency services.",
    source: NHS,
  },
  {
    id: "head.meningism",
    level: "SEEK_CARE_NOW",
    complaint: "headache",
    slotKey: "associated",
    labels: ["Fever and a stiff neck", "Change in my vision"],
    criterion: "A headache with fever and a stiff neck, or with a change in vision, needs to be assessed the same day.",
    source: NICE,
  },
  {
    id: "abdo.bleeding",
    level: "EMERGENCY",
    complaint: "abdominal_pain",
    slotKey: "associated",
    labels: ["Vomiting blood", "Black or bloody stools", "Belly is rigid to touch"],
    criterion: "Abdominal pain with vomited blood, black or bloody stools, or a rigid abdomen is a reason to call emergency services.",
    source: NHS,
  },
  {
    id: "abdo.systemic",
    level: "SEEK_CARE_NOW",
    complaint: "abdominal_pain",
    slotKey: "associated",
    labels: ["Fever", "Can't keep fluids down", "Yellow skin or eyes"],
    criterion: "Abdominal pain with fever, an inability to keep fluids down, or yellowing of the skin or eyes needs to be assessed the same day.",
    source: NICE,
  },
  {
    id: "back.cauda_equina",
    level: "EMERGENCY",
    complaint: "back_pain",
    slotKey: "associated",
    labels: ["Numbness around the groin or inner thighs", "Trouble controlling my bladder or bowels", "Weakness in a leg"],
    criterion: "Back pain with numbness around the groin, loss of bladder or bowel control, or leg weakness is treated as a possible spinal-cord emergency and is a reason to be seen immediately.",
    source: NICE,
  },
  {
    id: "back.systemic",
    level: "SEEK_CARE_NOW",
    complaint: "back_pain",
    slotKey: "associated",
    labels: ["Fever", "Unexplained weight loss", "It followed a fall or an accident"],
    criterion: "Back pain with fever, unexplained weight loss, or a recent fall or accident needs to be assessed rather than managed at home.",
    source: NICE,
  },
  {
    id: "cough.severe",
    level: "EMERGENCY",
    complaint: "cough_fever",
    slotKey: "associated",
    labels: ["Coughing up blood", "Short of breath at rest", "Confusion"],
    criterion: "A cough or fever with coughing up blood, breathlessness at rest, or confusion is a reason to call emergency services.",
    source: NHS,
  },
  {
    id: "dizzy.stroke",
    level: "EMERGENCY",
    complaint: "dizziness",
    slotKey: "associated",
    labels: ["Slurred speech", "Weakness on one side", "Double vision"],
    criterion: "Dizziness with slurred speech, one-sided weakness or double vision is treated as a possible stroke and is a reason to call emergency services.",
    source: NHS,
  },
  {
    id: "dizzy.cardiac",
    level: "SEEK_CARE_NOW",
    complaint: "dizziness",
    slotKey: "associated",
    labels: ["Fainted or nearly fainted", "Chest pain", "A very fast or irregular heartbeat"],
    criterion: "Dizziness with fainting, chest pain, or a very fast or irregular heartbeat needs to be assessed the same day.",
    source: NICE,
  },
  {
    id: "rash.anaphylaxis",
    level: "EMERGENCY",
    complaint: "rash",
    slotKey: "associated",
    labels: ["Swelling of my lips, tongue or face", "Trouble breathing", "Doesn't fade when pressed with a glass"],
    criterion: "A rash with swelling of the lips, tongue or face, with difficulty breathing, or that does not fade when pressed with a glass is a reason to call emergency services.",
    source: NHS,
  },
  {
    id: "joint.septic",
    level: "SEEK_CARE_NOW",
    complaint: "joint_pain",
    slotKey: "associated",
    labels: ["The joint is hot and red", "Fever", "I can't put weight on it"],
    criterion: "A joint that is hot and red, with fever or an inability to bear weight, needs to be assessed the same day.",
    source: NICE,
  },
  {
    id: "mood.self_harm",
    level: "EMERGENCY",
    complaint: "low_mood",
    slotKey: "safety",
    labels: ["Yes, right now", "Yes, recently"],
    criterion: "Thoughts of harming yourself are a reason to talk to a person now, not to keep working through a form.",
    source: NHS,
  },
];

const asArray = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v === null || v === undefined ? [] : [String(v)]);

const toFlag = (r: RedFlagRule): TrippedFlag => ({ ruleId: r.id, level: r.level, criterion: r.criterion, source: r.source });

/** Structured pass: which rules the currently answered slots trip. */
export const evaluateSlots = (state: EncounterState): TrippedFlag[] => {
  const out: TrippedFlag[] = [];
  for (const rule of RULES) {
    if (rule.complaint && rule.complaint !== state.complaintKey) continue;
    const answered = asArray(state.slots[rule.slotKey]);
    if (!answered.length) continue;
    const wanted = rule.labels.map(slug);
    if (answered.some((a) => wanted.indexOf(a) >= 0)) out.push(toFlag(rule));
  }
  return out;
};

/** Text pass: reuses the agent's gate so the opening sentence trips before any model runs. */
export const evaluateText = (text: string): TrippedFlag | null => {
  const hit = detectRedFlag(text);
  if (!hit) return null;
  return {
    ruleId: `text.${hit.category}`,
    level: "EMERGENCY",
    criterion: "What you described is on the list of things that are treated as an emergency.",
    source: NHS,
  };
};

/**
 * Both passes, merged into the flags already stuck to the encounter.
 * Never removes a flag — acknowledging one does not clear it.
 */
export const evaluate = (state: EncounterState, newText?: string): TrippedFlag[] => {
  const found = [...state.redFlags, ...evaluateSlots(state)];
  const fromText = newText ? evaluateText(newText) : null;
  if (fromText) found.push(fromText);
  const seen: Record<string, true> = {};
  return found.filter((f) => (seen[f.ruleId] ? false : (seen[f.ruleId] = true)));
};

export const highestLevel = (flags: TrippedFlag[]): RedFlagLevel | null =>
  flags.some((f) => f.level === "EMERGENCY") ? "EMERGENCY" : flags.length ? "SEEK_CARE_NOW" : null;
