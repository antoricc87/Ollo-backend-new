import { EncounterState } from "./types";

/**
 * OLLIE'S OWN FOLLOW-UPS (user ruling Oct 9 2026): once the protocol's standard
 * questions are covered, the model asks a few of its own — the ones a careful
 * clinician would ask given where it is, how it is behaving and what is on
 * this person's record — and their answers count toward the assessment.
 *
 * The protocol still decides the MINIMUM (warning signs first, then where,
 * when, how it behaves, how bad). This only adds to it, and only a few: an
 * interview that keeps going is how people stop answering.
 *
 * Kept on the record as question + answer in the person's own words. Pure.
 */

export const OWN_QUESTIONS_KEY = "own_questions";
export const MAX_OWN_QUESTIONS = 4;
const SEP = "\n";
const clip = (s: unknown, n: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

export type OwnQuestion = { question: string; answer: string };

export const ownQuestions = (state: Pick<EncounterState, "slots">): OwnQuestion[] => {
  const raw = state.slots[OWN_QUESTIONS_KEY];
  return (Array.isArray(raw) ? raw : [])
    .map((line) => {
      const [question, ...rest] = String(line).split(SEP);
      return { question, answer: rest.join(" ") };
    })
    .filter((q) => q.question && q.answer);
};

export const ownQuestionsLeft = (state: Pick<EncounterState, "slots">) => Math.max(0, MAX_OWN_QUESTIONS - ownQuestions(state).length);

/**
 * The question a message asked: its last sentence ending in a question mark,
 * markdown stripped. The record takes the QUESTION from what Ollie actually
 * sent and the ANSWER from what the person then said — the model is not asked
 * to pair them, because it paired the question it was about to ask with the
 * answer to the one before (first run, Oct 9 2026).
 */
export const questionAsked = (message: string | null | undefined): string | null => {
  const plain = String(message ?? "").replace(/[*_`#>]/g, "").replace(/\s+/g, " ").trim();
  const sentences = plain.match(/[^.!?\n]*\?/g) ?? [];
  const last = sentences[sentences.length - 1]?.trim();
  return last && last.length > 8 ? clip(last, 200) : null;
};

/** Adds what fits under the cap; a question already on the record is not stored twice. */
export const addOwnQuestions = <S extends Pick<EncounterState, "slots">>(state: S, items: OwnQuestion[]): { state: S; added: OwnQuestion[] } => {
  const have = ownQuestions(state);
  const added: OwnQuestion[] = [];
  for (const item of items) {
    const q = { question: clip(item?.question, 200), answer: clip(item?.answer, 400) };
    if (!q.question || !q.answer) continue;
    if (have.length + added.length >= MAX_OWN_QUESTIONS) break;
    if ([...have, ...added].some((h) => h.question.toLowerCase() === q.question.toLowerCase())) continue;
    added.push(q);
  }
  if (!added.length) return { state, added };
  const lines = [...have, ...added].map((q) => `${q.question}${SEP}${q.answer}`);
  return { state: { ...state, slots: { ...state.slots, [OWN_QUESTIONS_KEY]: lines } }, added };
};
