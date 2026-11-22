/**
 * The workout comes first (ruling Nov 22 2026). Pure.
 *
 * A request for a workout or a training week is answered with the workout, even
 * when it mentions pain ("my lower back hurts since soccer yesterday, give me a
 * 30 min home workout"); a check-in is offered after the card, never opened from
 * it. The prompt says so, and the model still opened the check-in on the third
 * turn of the first sim test — so start_checkin asks this before it opens one.
 *
 * The exception is a message that also names a warning sign: then the check-in
 * (and its red-flag rules) comes first, as before. The list is deliberately
 * broad: a false "warning sign" costs a question, a missed one costs screening.
 */

/** Something to design… */
const TRAINING_THING = /\b(work ?outs?|sessions?|training|exercises|routines?|stretches|mobility (work|routine|session)|circuit|programme|program|plan (my|a|the|next) week)\b/i;
/** …that they ask for — "my back hurts after the gym" or "it hurts during exercise" is a symptom, not a request. */
const ASKING = /\b(give|create|make|plan|design|build|suggest|recommend|put together|send|write|show|what|which|i (want|need|would like|'d like)|can you|could you|let'?s do)\b/i;

const WARNING_SIGN =
  /\b(numb\w*|tingl\w*|pins and needles|weak(ness|er)?|can'?t (walk|stand|move|feel|lift)|chest|heart|palpitation\w*|faint\w*|pass(ed)? out|black(ed)? out|dizz\w*|short of breath|breathless\w*|can'?t breathe|bladder|bowels?|incontinen\w*|pee|fever|temperature|chills|weight loss|fell|fall(en)?|accident|crash|hit (by|my)|collision|swollen|swelling|deformed|pop(ped)?|crack(ed)?|bleed\w*|blood|worst (pain|headache)|sudden)\b/i;

/** Pain or a symptom they describe having (not a goal like "long term" or "protect my knees"). */
const PAIN_NOW = /\b(pain(ful|s)?|hurt(s|ing)?|ach(e|es|ing|y)|sore(ness)?|tweak(ed)?|strain(ed)?|injur(y|ed))\b/i;

export type TrainingFirst = { trainingAsk: boolean; warningSign: boolean; designFirst: boolean; painNow: boolean };

/** Should this message get the workout before any check-in? */
export const trainingFirst = (message: string | null | undefined): TrainingFirst => {
  const m = (message ?? "").trim();
  const trainingAsk = TRAINING_THING.test(m) && ASKING.test(m);
  const warningSign = WARNING_SIGN.test(m);
  return { trainingAsk, warningSign, designFirst: trainingAsk && !warningSign, painNow: PAIN_NOW.test(m) };
};
