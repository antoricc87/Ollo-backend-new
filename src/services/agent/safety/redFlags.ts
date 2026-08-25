/**
 * Input-side red-flag detection. Deterministic and conservative: when a
 * message matches, the normal model loop is BYPASSED and a fixed emergency
 * answer is returned. No model creativity on this path. Extend the patterns,
 * never loosen them without the eval suite.
 */

export type RedFlag = { category: string; matched: string };

const P = (category: string, ...res: RegExp[]) => res.map((re) => ({ category, re }));

const PATTERNS = [
  ...P(
    "cardiac",
    /\b(chest|heart)\s+(pain|pressure|tightness|crushing)/i,
    /\b(pain|pressure)\s+in\s+(my\s+)?chest/i,
    /\bdolore\s+(al\s+)?petto/i,
    /\b(arm|jaw)\s+pain\b.*\b(chest|sweat|nause)/i
  ),
  ...P(
    "breathing",
    /\b(can'?t|cannot|can not|hard to|struggling to|unable to)\s+breathe/i,
    /\bshort(ness)?\s+of\s+breath\b.*\b(severe|sudden|rest|worse)/i,
    /\b(throat|airway)\s+(is\s+)?(closing|swelling|tight)/i,
    /\b(tongue|lips?|face)\s+(is\s+|are\s+)?swelling/i,
    /\bnon\s+riesco\s+a\s+respirare/i
  ),
  ...P(
    "stroke",
    /\b(face|mouth)\s+(is\s+)?(drooping|droop|numb)/i,
    /\bslurr(ed|ing)\s+(my\s+)?(speech|words)/i,
    /\b(one|left|right)\s+side\b.*\b(numb|weak|can'?t move|paralys)/i,
    /\b(sudden|worst)\s+(headache|head ache)\b.*\b(life|ever|sudden)/i,
    /\bworst\s+headache\s+of\s+my\s+life/i
  ),
  ...P(
    "self_harm",
    /\b(kill|hurt|harm)\s+(myself|me)\b/i,
    /\b(end|take)\s+(my\s+)?(own\s+)?life\b/i,
    /\bsuicid(e|al)\b/i,
    /\b(don'?t|do not)\s+want\s+to\s+(live|be alive|wake up)/i,
    /\bno\s+reason\s+to\s+live\b/i,
    /\b(farla\s+finita|togliermi\s+la\s+vita|uccidermi)\b/i
  ),
  ...P(
    "overdose_poisoning",
    /\b(overdos(e|ed|ing)|took\s+too\s+many\s+(pills|tablets))/i,
    /\b(swallowed|drank|ingested)\s+(bleach|poison|antifreeze|detergent)/i
  ),
  ...P(
    "bleeding_trauma",
    /\b(bleeding|blood)\b.*\b(won'?t\s+stop|heavily|a\s+lot|gushing|soak)/i,
    /\b(coughing|vomiting|throwing)\s+(up\s+)?blood\b/i,
    /\bblood\s+in\s+(my\s+)?(vomit|stool)\b.*\b(a lot|lots|heavy)/i
  ),
  ...P(
    "neuro",
    /\b(seizure|convulsion|fitting)\b/i,
    /\b(passed\s+out|fainted|unconscious|blacked\s+out)\b/i,
    /\b(confus(ed|ion))\b.*\b(sudden|suddenly)/i
  ),
  ...P(
    "glucose_extreme",
    /\b(glucose|sugar|bg)\b[^.\n]{0,30}\b([0-4]\d|5[0-3])\b\s*(mg)?/i,
    /\b(glucose|sugar|bg)\b[^.\n]{0,30}\b([4-9]\d{2}|\d{4})\b\s*(mg)?/i,
    /\b(dka|ketoacidosis)\b/i
  ),
  ...P(
    "bp_crisis",
    /\b(1[89]\d|2\d\d)\s*\/\s*(1[2-9]\d|2\d\d)\b/,
    /\b(bp|blood\s+pressure)\b[^.\n]{0,30}\b(1[89]\d|2\d\d)\b/i
  ),
  ...P(
    "pregnancy_emergency",
    /\bpregnan\w*\b.*\b(bleeding|severe\s+pain|no\s+movement|contractions?)\b/i
  ),
];

/** Phrases that look alarming but are clearly about someone else / hypothetical / past. */
const NEGATE = /\b(what\s+(are|is)\s+the\s+(signs|symptoms)|in\s+case|if\s+(i|someone)\s+ever|years?\s+ago|last\s+year|my\s+(dad|mom|mother|father|friend|uncle|aunt)\s+(had|died)|history\s+of)\b/i;

export const detectRedFlag = (message: string): RedFlag | null => {
  const text = message.replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (NEGATE.test(text) && !/\b(now|right now|currently|today|tonight|at the moment|i am|i'm)\b/i.test(text)) return null;
  for (const { category, re } of PATTERNS) {
    const m = text.match(re);
    if (m) return { category, matched: m[0] };
  }
  return null;
};

export const emergencyAnswer = (flag: RedFlag, firstName?: string | null) => {
  const name = firstName ? `${firstName}, ` : "";
  const lines: string[] = [];
  if (flag.category === "self_harm") {
    lines.push(
      `${name}I'm really glad you told me, and I want you to get support from a person right now.`,
      "",
      "**If you're in immediate danger, call your local emergency number (911 in the US, 112 in Europe).**",
      "In the US you can also call or text **988** (Suicide & Crisis Lifeline) any time. In Italy: **Telefono Amico 02 2327 2327**.",
      "",
      "I'm not able to help with this the way a trained person can, but I can send a note to your care team so they reach out. Would you like me to do that?"
    );
  } else {
    lines.push(
      `${name}what you're describing can be a medical emergency and it isn't something I can assess.`,
      "",
      "**Please call your local emergency number now (911 in the US, 112 in Europe) or get to the nearest emergency department.** Don't drive yourself if you feel faint.",
      "",
      "If you want, I can also notify your care team on Ollo. But please make the call first."
    );
  }
  return lines.join("\n");
};
