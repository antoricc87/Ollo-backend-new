import { Detector, SignalDomain } from "./types";
import { recoveryDip, recoveryRestored, sleepDebt } from "./detectors/vitals";
import { loggingStopped, proteinShort, trainingConsistent, trainingDrifting, trainingStopped, weightOffTrack } from "./detectors/habits";
import { labsReport } from "./detectors/labs";
import { weightChange } from "./detectors/weight";

/** Every detector that runs. Order here is irrelevant — ranking is by
 *  severity × weight (budget.ts), never by declaration order. */
export const DETECTORS: Detector[] = [recoveryDip, sleepDebt, trainingStopped, trainingDrifting, trainingConsistent, loggingStopped, proteinShort, weightOffTrack, weightChange];

/** Event-driven detectors: not run by the daily scan, but their episodes are
 *  folded by it (to close them) and looked up by key like any other. */
export const EVENT_DETECTORS: Detector[] = [labsReport];

/** No longer run, still known: rows they wrote keep their description and
 *  their domain. `recovery.restored` became the dip's own "back to your usual"
 *  follow-up (Nov 16 2026). */
export const RETIRED_DETECTORS: Detector[] = [recoveryRestored];

const ALL = () => [...DETECTORS, ...EVENT_DETECTORS, ...RETIRED_DETECTORS];

/** What a stored finding is about; a key no longer registered counts as a habit (never shown as a health signal by accident). */
export const domainOf = (key: string): SignalDomain => ALL().find((d) => d.key === key)?.domain ?? "habit";

export const detectorBy = (key: string) => ALL().find((d) => d.key === key) ?? null;

export const isEventDetector = (key: string) => EVENT_DETECTORS.some((d) => d.key === key);

/**
 * Pairs where the first firing makes the second meaningless rather than merely
 * lower-ranked. Nutrition rules cannot speak for days nobody logged, so a
 * logging gap silences them outright instead of competing with them.
 */
const SUPPRESSES: Record<string, string[]> = {
  "logging.stopped": ["nutrition.protein_short"],
  "training.stopped": ["training.drifting", "training.consistent"],
};

export const suppressedBy = (firing: string[]): Set<string> => {
  const out = new Set<string>();
  for (const key of firing) for (const victim of SUPPRESSES[key] ?? []) out.add(victim);
  return out;
};
