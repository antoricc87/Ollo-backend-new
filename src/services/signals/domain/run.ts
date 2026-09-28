import { decide, Decision, NotifyState } from "./budget";
import { applyDay, Episode, stillOpen } from "./episodes";
import { DETECTORS } from "./registry";
import { Candidate, SignalInput } from "./types";

/**
 * ONE DAY of the signal engine, start to finish and side-effect free: run every
 * detector, fold the results into the running episodes, then ask the budget
 * what — if anything — is worth a notification.
 *
 * The live worker and the replay harness both call exactly this, which is the
 * only reason calibrating on history means anything: tune the harness and you
 * have tuned production.
 */
export type DayRun = {
  candidates: Candidate[];
  episodes: Episode[];
  opened: Episode[];
  resolved: Episode[];
  decisions: Decision[];
};

export const runDay = (input: SignalInput, open: Episode[], notify: Omit<NotifyState, "today">): DayRun => {
  const candidates: Candidate[] = [];
  for (const detector of DETECTORS) {
    let candidate: Candidate | null = null;
    try {
      candidate = detector.run(input);
    } catch (e) {
      // A detector that throws must never take the day's other signals with
      // it — this loop runs unattended for every patient, every morning.
      console.error(`signal detector ${detector.key} threw`, e);
    }
    if (candidate && candidate.severity >= 1) candidates.push(candidate);
  }

  const folded = applyDay(open, candidates, input.today);
  /**
   * Only candidates whose episode is OPEN or newly worse are put to the
   * budget — an episode already running quietly should not spend attention
   * again every morning just for still being true.
   */
  const decisions = decide(candidates, { ...notify, today: input.today });
  return { candidates, episodes: folded.episodes, opened: folded.opened, resolved: folded.resolved, decisions };
};

export const carryOpen = (run: DayRun) => stillOpen(run.episodes);
