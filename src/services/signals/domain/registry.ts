import { Detector } from "./types";
import { recoveryDip, recoveryRestored, sleepDebt } from "./detectors/vitals";
import { loggingStopped, proteinShort, trainingConsistent, trainingDrifting, trainingStopped, weightOffTrack } from "./detectors/habits";

/** Every detector that runs. Order here is irrelevant — ranking is by
 *  severity × weight (budget.ts), never by declaration order. */
export const DETECTORS: Detector[] = [recoveryDip, recoveryRestored, sleepDebt, trainingStopped, trainingDrifting, trainingConsistent, loggingStopped, proteinShort, weightOffTrack];

export const detectorBy = (key: string) => DETECTORS.find((d) => d.key === key) ?? null;

/**
 * Pairs where the first firing makes the second meaningless rather than merely
 * lower-ranked. Nutrition rules cannot speak for days nobody logged, so a
 * logging gap silences them outright instead of competing with them.
 */
const SUPPRESSES: Record<string, string[]> = {
  "logging.stopped": ["nutrition.protein_short"],
  "recovery.dip": ["recovery.restored"],
  "training.stopped": ["training.drifting", "training.consistent"],
};

export const suppressedBy = (firing: string[]): Set<string> => {
  const out = new Set<string>();
  for (const key of firing) for (const victim of SUPPRESSES[key] ?? []) out.add(victim);
  return out;
};
