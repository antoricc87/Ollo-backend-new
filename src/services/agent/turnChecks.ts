/**
 * End-of-turn checks: the reply is about to be sent — does it claim something
 * the turn did not do? Pure; the loop gathers the facts and applies at most ONE
 * nudge per turn (a bracketed system note, then the model goes again).
 *
 * These used to be inline `if`s in the loop, one per incident. They are one
 * list now because they are one idea: the words and the tool calls must agree.
 * A check belongs here only when it can be decided from facts, not from a
 * reading of the reply's meaning — that is the output guard's job.
 */

export type TurnFacts = {
  text: string;
  /** What the user wrote this turn ("" for a proactive run). */
  userMessage: string;
  proactive: string | null;
  /** Any tool ran this turn. */
  usedTools: boolean;
  /** Names of the tools that ran this turn. */
  toolsCalled: string[];
  /** A write tool produced a proposal card this turn. */
  proposed: boolean;
  /** A write was committed this turn (the voice channel saves meals and workouts at once). */
  saved: boolean;
  /** A generate tool ran this turn (its card is real). */
  generated: boolean;
  /** A finished check-in has a follow-up due that Ollie has not raised yet for this scheduled day (what it is about). */
  followUpToRaise?: string | null;
  checkin: {
    /** A check-in exists in this thread (running, paused or assessed) — before or because of this turn. */
    inThread: boolean;
    /** An interview is running right now, after this turn's tools. */
    active: boolean;
    /** Every required question is covered. */
    historyComplete: boolean;
    /** A published warning sign matched — the turn's job is the escalation, not an assessment. */
    flagged: boolean;
    /** What assess_checkin said when it refused the assessment this turn, if it did. */
    rejected: string | null;
  };
};

export type TurnNudge = { stage: string; message: string };

/** Phrases that only make sense after a write tool produced a proposal card. */
export const CLAIMS_CARD =
  /\b(prepar\w*|ready)\b[^.!?\n]{0,80}\b(card|entry|log|logged|confirm)\b|\bcard\b[^.!?\n]{0,60}\b(confirm|edit|review)\b|\byou'?ll see a card\b|\bconfirm\b[^.!?\n]{0,40}\b(in|on) the app\b|\breview and confirm\b|\btap confirm\b/i;

/** The reply says something was saved. Only true after a commit this turn. */
export const CLAIMS_SAVED = /\b(?:i'?ve|i have|i)\s+(?:logged|saved|recorded|added)\b|\b(?:is|was|been|got)\s+(?:logged|saved|recorded)\b|\blogged\s+(?:it|that|your|the)\b/i;

const CHECKIN_TOOLS = ["start_checkin", "record_checkin", "assess_checkin", "resume_checkin"];

/** The reply is talking about what the symptom could be. */
const ABOUT_ASSESSMENT = /\b(could be|possibilit\w+|what (this|it) (could|might)|what fits|most likely|summari[sz]e what)\b/i;

/** The user said something hurts or is wrong. Deliberately narrow: "sore" and "tired" are everyday training talk. */
const USER_SYMPTOM = /\b(pain(ful|s)?|hurt(s|ing)?|ach(e|es|ing|y)|dizz(y|iness)|faint(ed|ing)?|rash|numb(ness)?|swollen|swelling|short of breath|breathless|palpitations?|nause(a|ous)|vomit\w*|fever)\b/i;

const FOLLOWUP_TOOLS = ["ask_followup", "record_followup"];

const CHECKS: ((f: TurnFacts) => TurnNudge | null)[] = [
  // A follow-up is due and this turn would end without raising it (Oct 5 2026).
  // Left to the prompt alone it was skipped whenever the user asked for
  // something else. Not during an interview, and not under a card they have to
  // act on — the question would compete with it. Raised once per scheduled
  // day: ask_followup logs the ask, which clears `followUpToRaise`.
  (f) =>
    f.followUpToRaise && !f.proactive && !f.checkin.active && !f.proposed && !f.generated && !f.toolsCalled.some((t) => FOLLOWUP_TOOLS.includes(t) || CHECKIN_TOOLS.includes(t))
      ? {
          stage: "followup_not_raised",
          message: `[System: the follow-up on their ${f.followUpToRaise.toLowerCase()} check-in is due and has not been raised. Call ask_followup now, then give the same answer you just wrote and end with its one question as the last line.]`,
        }
      : null,
  // Weekly review: the snapshot is THIS week; judging last week without reading
  // it (seen 2026-08-27: this week's numbers quoted as last week's) is wrong.
  (f) =>
    f.proactive === "weekly_review" && !f.usedTools
      ? {
          stage: "weekly_review_without_reads",
          message: "[System: the snapshot describes the CURRENT week, not the week under review. Call get_nutrition_summary, get_activity and get_workouts for the exact range given in the review instruction, then write the review from those results.]",
        }
      : null,

  // A reply that talks about a card or asks for confirmation when no write tool
  // ran is a hallucinated proposal (seen 2026-08-27: "I've prepared a card to
  // log…" with tools=[]). Not after a generate tool: its card is real, and
  // nudging there once turned "give me a workout" into a log_workout proposal.
  (f) =>
    !f.proposed && !f.generated && !f.proactive && CLAIMS_CARD.test(f.text)
      ? {
          stage: "claim_without_proposal",
          message:
            "[System: your reply describes a card or asks the user to confirm, but nothing was prepared for them to confirm this turn. If they asked to log or send something, call the right tool now with their words verbatim (log_meal, log_workout, log_vital, message_care_team, book_appointment, update_plan_targets, save_workout_plan, update_training_profile, move_workout); otherwise answer plainly without claiming anything was prepared.]",
        }
      : null,

  // "I've logged your snack" with no tool call (Oct 7 2026, first seen on the
  // voice channel the moment the prompt said logs are saved at once): nothing
  // was saved. The tool must run, or the reply must not claim it did.
  (f) =>
    !f.saved && !f.proposed && !f.proactive && CLAIMS_SAVED.test(f.text)
      ? {
          stage: "claim_without_save",
          message:
            "[System: your reply says something was logged or saved, but no tool saved anything this turn. If the user asked to log something, call log_meal or log_workout now with their words verbatim and then report what the tool returned; otherwise answer without claiming it was saved.]",
        }
      : null,

  // The interview is covered and the reply ends the turn without the assessment
  // — it announced one ("here's what fits best…") or listed possibilities in its
  // own words, which the card, the record and the training rule never see
  // (Oct 4 2026). Often after assess_checkin refused a phrasing: fix and retry.
  (f) =>
    f.checkin.active &&
    f.checkin.historyComplete &&
    !f.checkin.flagged &&
    !f.proactive &&
    f.toolsCalled.every((t) => CHECKIN_TOOLS.indexOf(t) >= 0) &&
    // Only when the turn was about the check-in — an unrelated question mid-interview is just answered.
    (f.toolsCalled.length > 0 || ABOUT_ASSESSMENT.test(f.text))
      ? {
          stage: "checkin_complete_not_assessed",
          message: `[System: the check-in's history is complete but no assessment was saved, so nothing you wrote about what it could be reaches the user's card or their record. Call assess_checkin now${
            f.checkin.rejected ? ` — it refused the last attempt: ${f.checkin.rejected}` : ""
          }. Do not list possibilities in your own text instead.]`,
        }
      : null,

  // An interview started in the reply's own words — "let's go through a quick
  // check-in", or a question back to someone who just said something hurts —
  // with no check-in opened: the answers are recorded nowhere and no warning
  // sign is screened (Oct 4 2026). A re-think, not a verdict: the model may
  // still decide it was coaching ("sore from Tuesday") and answer as before.
  (f) =>
    !f.checkin.inThread &&
    !f.proactive &&
    f.toolsCalled.length === 0 &&
    (/\bcheck[- ]?in\b/i.test(f.text) || (USER_SYMPTOM.test(f.userMessage) && f.text.indexOf("?") >= 0))
      ? {
          stage: "checkin_not_opened",
          message:
            "[System: no check-in is open. If they described a symptom they are having — something that hurts or is wrong, not ordinary soreness from training and not a condition already on their record — call start_checkin with their own words now and ask the question it returns; the questions must come from it. If it is not that, answer as you were going to, without mentioning a check-in.]",
        }
      : null,
];

/** The first check that fires, or null. */
export const turnEndNudge = (facts: TurnFacts): TurnNudge | null => {
  for (const check of CHECKS) {
    const n = check(facts);
    if (n) return n;
  }
  return null;
};
