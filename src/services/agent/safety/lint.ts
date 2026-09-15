import { ForbiddenAct, FORBIDDEN_ACTS } from "./policy";

/**
 * Deterministic output linter — the second key on the output side.
 *
 * `outputCheck.ts` asks a model whether an answer broke the boundary. That
 * catches paraphrase and implication, but it is itself a model: it can be
 * wrong, and it fails open on a bad judgement (the pipeline only fails closed
 * when the call itself throws). This pass is regexes over the draft. It cannot
 * be argued with, costs nothing, runs offline, and is unit-tested against a
 * fixed corpus — so the highest-signal phrasings are caught even when the
 * classifier waves them through.
 *
 * Direction of travel matters: the linter may only RAISE a concern. It never
 * clears one the classifier raised.
 *
 * FALSE POSITIVES ARE EXPENSIVE HERE. A finding sends a good answer through a
 * rewrite. Every rule therefore needs a frame AND a subject (a diagnosis frame
 * next to a condition name, a recommendation frame next to a drug or a dose) —
 * never a bare keyword — and refusals are exempt, because "I can't recommend a
 * statin" contains every word that "take a statin" does.
 */

export type LintFinding = {
  act: ForbiddenAct;
  ruleId: string;
  /** The sentence as it appeared, trimmed for the audit log. */
  sentence: string;
  matched: string;
};

/* ------------------------------ vocabulary ------------------------------ */

/** Conditions a sentence could assert. Not exhaustive — the classifier covers the tail. */
const CONDITION =
  /\b(pre[- ]?diabetes|diabetes|insulin resistance|metabolic syndrome|hypertension|high blood pressure|an?[ae]mia|an?emic|hypothyroid(ism)?|hyperthyroid(ism)?|thyroid disease|ibs|irritable bowel|crohn'?s|celiac|coeliac|gerd|acid reflux|ulcer|gallstones?|kidney stones?|uti|urinary tract infection|pneumonia|bronchitis|sinusitis|asthma|copd|sleep apn(o?ea|ea)|pcos|endometriosis|gout|arthritis|osteoporosis|angina|arrhythmia|afib|atrial fibrillation|heart (disease|failure)|fatty liver|nafld|migraine|depression|anxiety disorder|adhd|long covid|covid|the flu|influenza|mono(nucleosis)?|shingles|deficiency|infection)\b/i;

/**
 * Pharmaceuticals. Naming one is fine; recommending one is not, so a
 * recommendation frame beside one of these is enough on its own.
 */
const DRUG =
  /\b(statins?|metformin|ozempic|semaglutide|levothyroxine|sertraline|omeprazole|ibuprofen|paracetamol|acetaminophen|aspirin|antibiotics?|antihistamines?|melatonin|supplements?|medications?|prescriptions?)\b/i;

/**
 * Nutrients. These are also food, and naming food sources is explicitly
 * allowed ("salmon, eggs and fortified dairy"), so a frame is NOT enough —
 * the sentence must also be about taking one in supplement form. Without this
 * split, "add iron-rich foods" reads as a prescription.
 */
const NUTRIENT =
  /\b(magnesium|creatine|berberine|ashwagandha|zinc|iron|omega[- ]?3|fish oil|probiotics?|vitamin [abcdek]\d*|multivitamins?)\b/i;

const SUPPLEMENT_FORM = /\b(supplements?|capsules?|tablets?|pills?|dose|dosage|drops|sachets?|\d+\s?(mg|mcg|iu|ui)\b)/i;

/**
 * A pharmaceutical dose. Deliberately excludes grams — this app talks about
 * grams of protein all day — and mg/dL, which is a lab unit, not a dose.
 */
const DOSE = /\b\d+(\.\d+)?\s?(mg|mcg|µg|ug|iu|ui)\b(?!\s*\/)/i;

/**
 * Anything that turns the sentence into a refusal, a question, or a quote of
 * the user. Checked BEFORE the match position: "I can't recommend a statin" is
 * exempt, "nothing to worry about, though I can't be certain" is not.
 */
const EXEMPT =
  /\b(can'?t|cannot|can not|won'?t|will not|not able to|unable to|i'?m not|i am not|not going to|never|rather not|no way for me|you asked|whether|instead of|not the same as|isn'?t|is not|doesn'?t|does not|don'?t|do not)\b/i;

/* -------------------------------- rules --------------------------------- */

type Rule = {
  id: string;
  act: ForbiddenAct;
  /** Fires when `frame` matches; if `near` is set it must match the same sentence too. */
  frame: RegExp;
  near?: RegExp;
};

const RULES: Rule[] = [
  /* DIAGNOSE — an assertion frame sitting next to a condition name. */
  { id: "dx.have", act: "DIAGNOSE", frame: /\byou (probably |likely |may |might |could )?have\b/i, near: CONDITION },
  { id: "dx.is", act: "DIAGNOSE", frame: /\b(this|that|it|which|these|those)\b[^.]{0,24}?\b(is|was|means|indicates?|suggests?|points to|reflects)\b/i, near: CONDITION },
  { id: "dx.soundslike", act: "DIAGNOSE", frame: /\b(sounds?|looks?|seems?) like\b/i, near: CONDITION },
  { id: "dx.consistent", act: "DIAGNOSE", frame: /\b(consistent with|typical of|classic (for|sign of)|diagnos(is|tic) of|a case of)\b/i, near: CONDITION },
  { id: "dx.youre", act: "DIAGNOSE", frame: /\byou'?re\b/i, near: /\b(pre[- ]?diabetic|diabetic|an?emic|hypertensive|hypothyroid|insulin resistant|deficient)\b/i },

  /* TREAT_OR_DOSE — a recommendation frame next to a drug, a supplement form, or a dose. */
  { id: "rx.recommend", act: "TREAT_OR_DOSE", frame: /\b(recommend|advise|prescribe|endorse)\b/i, near: DRUG },
  { id: "rx.imperative", act: "TREAT_OR_DOSE", frame: /\b(take|start|stop|switch to|try|consider|increase|decrease|double|halve)\b/i, near: DRUG },
  { id: "rx.modal", act: "TREAT_OR_DOSE", frame: /\byou (should|could|might want to|ought to|may want to)\b/i, near: DRUG },
  { id: "rx.ask", act: "TREAT_OR_DOSE", frame: /\bask (your |the )?(doctor|gp|clinician|pharmacist) (about|for|to)\b/i, near: DRUG },
  { id: "rx.nutrient", act: "TREAT_OR_DOSE", frame: NUTRIENT, near: SUPPLEMENT_FORM },
  { id: "rx.dose", act: "TREAT_OR_DOSE", frame: DOSE, near: /\b(take|taking|start|daily|per day|a day|twice|dose|dosage|supplement)\b/i },

  /* REASSURE — Rule 2. Escalation is one-way. */
  { id: "re.worry", act: "REASSURE", frame: /\b(nothing to worry about|no need to worry|don'?t worry|not worth worrying|no cause for concern|nothing alarming|nothing serious)\b/i },
  { id: "re.probably", act: "REASSURE", frame: /\b(probably (just|nothing|fine)|most likely (just|nothing|fine)|it'?s fine|you'?re fine|perfectly (normal|fine)|totally (normal|fine)|not serious|harmless)\b/i },

  /* TRIAGE_VERDICT — assigning a level of care. */
  { id: "tr.wait", act: "TRIAGE_VERDICT", frame: /\b(can wait|no rush|not urgent|no need to (see|call|go)|you don'?t need (to see|a doctor|urgent|medical)|not an emergency|doesn'?t (need|warrant) (a doctor|urgent|medical|emergency))\b/i },
  { id: "tr.window", act: "TRIAGE_VERDICT", frame: /\b(within|in) (the next )?(24|48|72) hours\b/i, near: /\b(see|call|book|visit|doctor|clinician|appointment)\b/i },

  /* PROGNOSE — the course of an untriaged complaint. */
  { id: "pg.resolve", act: "PROGNOSE", frame: /\b(should|will|usually|typically|normally) (clear up|resolve|go away|settle|pass|improve on its own|sort itself)\b/i },
  { id: "pg.duration", act: "PROGNOSE", frame: /\b(lasts?|goes away|clears up) (in|within|after) (a few|\d+) (days?|weeks?)\b/i },

  /* CLAIM_ACCURACY — performance claims. */
  { id: "ac.percent", act: "CLAIM_ACCURACY", frame: /\bi'?m \d+ ?% (sure|certain|confident)\b/i },
  { id: "ac.proven", act: "CLAIM_ACCURACY", frame: /\b(clinically|medically|scientifically) (validated|proven)\b/i },
  { id: "ac.guarantee", act: "CLAIM_ACCURACY", frame: /\bi (can )?guarantee\b/i },
];

/* -------------------------------- engine -------------------------------- */

/** Sentence split that keeps bullets and line breaks apart from prose. */
const sentences = (text: string): string[] =>
  text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?;:])\s+|\s+[—–-]\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

export type LintContext = {
  /** Conditions already on the patient's record — restating one is allowed. */
  onRecordConditions?: string[];
};

/**
 * Returns every forbidden act found in `text`. Empty array means the
 * deterministic pass had no objection — NOT that the answer is safe.
 */
export const lintOutput = (text: string, ctx: LintContext = {}): LintFinding[] => {
  const findings: LintFinding[] = [];
  const onRecord = (ctx.onRecordConditions ?? []).map((c) => c.toLowerCase().trim()).filter(Boolean);

  for (const sentence of sentences(text)) {
    for (const rule of RULES) {
      const m = sentence.match(rule.frame);
      if (!m) continue;

      // A refusal or a question that uses the same words is not the act.
      const exempt = sentence.match(EXEMPT);
      if (exempt && (exempt.index ?? 0) < (m.index ?? 0)) continue;

      if (rule.near) {
        const n = sentence.match(rule.near);
        if (!n) continue;
        // Restating a condition the patient already carries is allowed.
        if (rule.act === "DIAGNOSE" && onRecord.some((c) => c.indexOf(n[0].toLowerCase()) >= 0 || n[0].toLowerCase().indexOf(c) >= 0)) continue;
      }

      findings.push({ act: rule.act, ruleId: rule.id, sentence: sentence.slice(0, 240), matched: m[0] });
      break; // one finding per sentence is enough to send it back
    }
  }
  return findings;
};

/** "diagnosis (dx.have), reassurance (re.worry)" — for the rewrite instruction. */
export const describeFindings = (findings: LintFinding[]): string =>
  findings.map((f) => `${FORBIDDEN_ACTS[f.act].label} ("${f.matched}")`).join("; ");
