import { warningSignsFor } from "./assessment";
import { EncounterState, Protocol } from "./types";

/**
 * What training help is allowed while a check-in is on record. Pure.
 *
 * Why it exists (ruling Oct 4 2026): the prompt had ONE blanket rule — pain is
 * never worked around with exercise choices, route it to the care team — and
 * the check-in's answers changed nothing about it. Someone who answered "no"
 * to every warning sign got the same outcome as someone who answered "yes":
 * book a doctor, no session. Ten questions that decide nothing.
 *
 * Now the check-in's own answers decide, here, in code:
 *   - HOLD     a published warning sign matched, the interview is not finished
 *              yet, or the complaint is one where exertion itself is the
 *              question (chest, breathing, dizziness). No session is designed.
 *   - GENERAL  assessed, no warning sign, but an answer says to go carefully
 *              (it travels, it has lasted a month, it is getting worse or
 *              constant, 7+ of 10). A clinician is recommended ONCE and Ollie
 *              still helps: a lighter, general session — never one designed
 *              "for" the symptom or a condition the assessment named.
 *   - NORMAL   assessed, no warning sign, none of the above. Ordinary design,
 *              with the symptom passed along in their own words.
 *
 * The line this protects, in every level: exercises aimed at a symptom or a
 * named condition are treatment and are never designed. What GENERAL opens is
 * what any fitness app offers — a general mobility or lighter session.
 *
 * Escalation stays one-way: nothing here can lower a tripped red flag.
 */

export type TrainingLevel = "hold" | "general" | "normal";

export type TrainingGate = {
  level: TrainingLevel;
  checkinId: string;
  /** The protocol title — "Back pain". Never a diagnosis label. */
  about: string;
  /** Why this level, as facts from their own answers. */
  reasons: string[];
  /** HOLD only: the interview is still open, so finishing it is what lifts the hold. */
  pending: boolean;
  /** Possibilities the assessment named. A session may never be designed for, or named after, one of these. */
  conditions: string[];
  /** The protocol's published warning signs, in the words they were asked in — the "stop and get seen" list on the card. */
  stopIf: string[];
};

/** Complaints where exertion is itself the open question. A clear check-in does not open training for these. */
export const EXERTION_PROTOCOLS = ["chest_discomfort", "breathlessness", "dizziness"];

/** At or above this, on the 0–10 "at its worst" answer, the session is kept general. */
export const CAUTION_SEVERITY = 7;

/** How long after its last change a check-in still shapes training. Covers the follow-up loop (days 2, 5, 10). */
export const GATE_DAYS = 14;

const SAFETY_KEYS = ["associated", "safety"];

const RANK: Record<TrainingLevel, number> = { normal: 0, general: 1, hold: 2 };

/** The answers that mean "go carefully", stated as the fact they gave. Only slots that exist on the protocol are read. */
const cautionReasons = (state: EncounterState, protocol: Protocol): string[] => {
  const s = state.slots;
  const out: string[] = [];
  if (s.onset === "it_keeps_coming_back") out.push("it keeps coming back");
  // An answer kept in their own words fits none of the options this rule can read — so it cannot count as "nothing to be careful about".
  const offList = protocol.slots.some((slot) => {
    const v = s[slot.key];
    return slot.kind === "single" && SAFETY_KEYS.indexOf(slot.key) < 0 && typeof v === "string" && !!v && !(slot.options ?? []).some((o) => o.value === v);
  });
  if (offList) out.push("an answer did not fit the listed options");
  if (typeof s.radiates === "string" && s.radiates !== "it_stays_put") out.push("it travels beyond where it starts");
  if (s.onset === "a_month_or_more_ago") out.push("it has been going on for a month or more");
  if (s.pattern === "getting_worse") out.push("it has been getting worse");
  if (s.pattern === "constant") out.push("it is constant");
  if (typeof s.severity === "number" && s.severity >= CAUTION_SEVERITY) out.push(`at its worst it was ${s.severity} out of 10`);
  return out;
};

export const trainingGateFor = (
  input: { id: string; status: string; state: EncounterState; protocol: Protocol },
  /** The latest assessment of THIS check-in, or null. An ended check-in may carry one too (ended after assessing). */
  lastAssessment: { possibilities?: { condition?: string | null }[] } | null = null
): TrainingGate => {
  const { state, protocol } = input;
  const base = {
    checkinId: input.id,
    about: protocol.title,
    conditions: (lastAssessment?.possibilities ?? []).map((p) => (p?.condition ?? "").trim()).filter(Boolean),
    stopIf: warningSignsFor(protocol),
  };
  if (state.redFlags.length)
    return { ...base, level: "hold", pending: false, reasons: state.redFlags.map((f) => f.criterion) };
  if (EXERTION_PROTOCOLS.indexOf(protocol.key) >= 0)
    return { ...base, level: "hold", pending: false, reasons: [`${protocol.title.toLowerCase()} and exertion is a question for a clinician`] };
  // Ended before it finished (End tapped, or "I don't want a check-in"): they declined the screening, so go
  // carefully — a lighter general session, not a hold. Ruling Oct 8 2026, after an accidental second check-in
  // the user ended by hand still blocked every session for a day.
  if (input.status === "ABANDONED") return { ...base, level: "general", pending: false, reasons: ["the check-in was ended before it finished"] };
  // Mid-interview: the next turn or two finish it, and the training question is answered right after.
  if (!lastAssessment || input.status !== "OPEN" || state.phase !== "ROUTE")
    return { ...base, level: "hold", pending: true, reasons: ["the check-in is not finished"] };
  const reasons = cautionReasons(state, protocol);
  return reasons.length ? { ...base, level: "general", pending: false, reasons } : { ...base, level: "normal", pending: false, reasons: [] };
};

/** Several check-ins on record: the strictest one decides. */
export const strictestGate = (gates: TrainingGate[]): TrainingGate | null =>
  gates.reduce<TrainingGate | null>((worst, g) => (!worst || RANK[g.level] > RANK[worst.level] ? g : worst), null);

/* ------------------------------ wording checks ----------------------------- */

/**
 * A session designed while a check-in is on record may not present itself as
 * treatment. Frame + subject, like safety/lint.ts: "recovery" or "mobility" on
 * their own are ordinary training words and must stay clean.
 */
const TREATMENT =
  /\b(rehab(ilitation)?|physio(therapy)?|therap(y|eutic)|treat(s|ment|ing)?|cure[sd]?|heal(s|ing)?|fix(es|ing)?|reliev(e|es|ing)|eas(e|es|ing) (the|your) (pain|ache)|pain[- ]relief|decompress(ion|es|ing)?|nerve (glide|floss)\w*|corrective)\b/i;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The first treatment framing or named condition in the session's own text, or null. */
export const treatmentWording = (texts: (string | null | undefined)[], gate: Pick<TrainingGate, "conditions">): string | null => {
  // "Sciatica (nerve irritation)" → also match its head word alone.
  const names = gate.conditions.flatMap((c) => [c, c.split(/[(,/]| or /i)[0]]).map((c) => c.trim()).filter((c) => c.length >= 4);
  const named = names.length ? new RegExp(`\\b(${names.map(escapeRe).join("|")})\\b`, "i") : null;
  for (const t of texts) {
    if (!t) continue;
    const m = t.match(TREATMENT) ?? (named ? t.match(named) : null);
    if (m) return m[0];
  }
  return null;
};

/** The card line that says what this session is and is not. Code-built: it must be right on an off day. */
export const generalSessionLine = (gate: Pick<TrainingGate, "about">, what: "session" | "week" = "session") =>
  `A general, lighter ${what} — not treatment for your ${gate.about.toLowerCase()}. Exercises aimed at it are for a clinician or physiotherapist to choose.`;

export const stopLine = (gate: Pick<TrainingGate, "stopIf">) =>
  gate.stopIf.length ? `Stop and get seen if any of these appear: ${gate.stopIf.map((s) => s.charAt(0).toLowerCase() + s.slice(1)).join("; ")}.` : null;
