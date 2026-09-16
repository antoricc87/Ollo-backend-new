/**
 * Which check-in mode a chat turn is in. Pure — the agent loop reads the rows,
 * this decides.
 *
 * Why it exists (Sep 16 2026): the first version keyed the mode on the
 * encounter being OPEN. But an encounter stays OPEN after its assessment — on
 * purpose, the follow-up loop needs it — and after a crisis halt. So every
 * later message in that thread kept the widened guard: ask about your labs an
 * hour after a headache check-in and the model could still name conditions.
 *
 * Now the mode has three states:
 *   - ACTIVE: an interview is in progress. The check-in prompt applies and
 *     candidate conditions may be named.
 *   - ASSESSED: it has finished with an assessment. The ordinary boundary is
 *     back, with one allowance — the possibilities that assessment named may be
 *     EXPLAINED ("what is medication-overuse headache?"), never asserted.
 *   - OFF: no check-in, or one that halted without an assessment.
 *
 * Recording a new answer after an assessment moves the phase back into the
 * interview (stateMachine.applyAnswer), so the mode reopens by itself when
 * someone adds something new. A crisis halt cannot reopen: shouldHalt pins the
 * phase to ROUTE.
 */

/** Phases after which the interview is over. */
const FINISHED = ["ROUTE", "CLOSED"];

export type CheckinMode = {
  /** An interview is in progress in this thread. */
  active: boolean;
  /** Possibilities an earlier assessment in this thread named. Explainable, never assertable. Empty while active. */
  assessedConditions: string[];
};

export const checkinModeFor = (
  encounter: { status: string; phase: string } | null,
  lastAssessment: { possibilities?: { condition?: string | null }[] } | null = null
): CheckinMode => {
  const active = !!encounter && encounter.status === "OPEN" && FINISHED.indexOf(encounter.phase) < 0;
  const assessedConditions =
    !active && lastAssessment
      ? (lastAssessment.possibilities ?? []).map((p) => (p?.condition ?? "").trim()).filter(Boolean)
      : [];
  return { active, assessedConditions };
};
