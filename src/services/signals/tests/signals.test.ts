import moment from "moment-timezone";
import { decide, ESCALATION_STEP, WEEKLY_BUDGET } from "../domain/budget";
import { loggingStopped } from "../domain/detectors/habits";
import { applyDay } from "../domain/episodes";
import { Candidate, SignalInput } from "../domain/types";
import { replay } from "../replay/replay";
import { synthetic } from "../replay/synthetic";

const candidate = (detectorKey: string, severity: number, direction: Candidate["direction"] = "CONCERN"): Candidate => ({
  detectorKey,
  detectorVersion: 1,
  direction,
  severity,
  evidence: {},
  baseline: null,
  label: `${detectorKey} @ ${severity}`,
});

const noState = { sentThisWeek: [], lastNotifiedAt: {}, lastNotifiedSeverity: {}, today: "2026-09-24" };

describe("budget", () => {
  it("sends the top-ranked candidate and holds the rest to the weekly cap", () => {
    const decisions = decide([candidate("sleep.debt", 1.2), candidate("recovery.dip", 3), candidate("logging.stopped", 2)], noState);
    const sent = decisions.filter((d) => d.notify);
    expect(sent).toHaveLength(WEEKLY_BUDGET);
    expect(sent[0].candidate.detectorKey).toBe("recovery.dip");
    expect(decisions.find((d) => !d.notify)?.reason).toBe("weekly budget spent");
  });

  it("stays silent when a week's budget is already spent", () => {
    const decisions = decide([candidate("recovery.dip", 3)], { ...noState, sentThisWeek: [{ detectorKey: "sleep.debt", direction: "CONCERN" }, { detectorKey: "logging.stopped", direction: "CONCERN" }] });
    expect(decisions.every((d) => !d.notify)).toBe(true);
  });

  it("holds good news to a higher bar", () => {
    expect(decide([candidate("recovery.restored", 1.2, "POSITIVE")], noState)[0].notify).toBe(false);
    expect(decide([candidate("recovery.restored", 2, "POSITIVE")], noState)[0].notify).toBe(true);
  });

  it("silences a detector its higher-order partner makes meaningless", () => {
    const decisions = decide([candidate("logging.stopped", 2), candidate("nutrition.protein_short", 3)], noState);
    expect(decisions.find((d) => d.candidate.detectorKey === "nutrition.protein_short")?.reason).toBe("suppressed by a higher-order signal");
  });

  it("repeats nothing within the cooldown", () => {
    const decisions = decide([candidate("recovery.dip", 1.4)], { ...noState, lastNotifiedAt: { "recovery.dip": "2026-09-20" }, lastNotifiedSeverity: { "recovery.dip": 1.3 } });
    expect(decisions[0].notify).toBe(false);
    expect(decisions[0].reason).toMatch(/cooldown/);
  });

  /** The bug the replay harness found on its first run: a marginal episode
   *  must not be able to hide a far worse one inside its cooldown. */
  it("lets a materially worse episode through its own cooldown", () => {
    const decisions = decide([candidate("recovery.dip", 1.3 + ESCALATION_STEP)], { ...noState, lastNotifiedAt: { "recovery.dip": "2026-09-20" }, lastNotifiedSeverity: { "recovery.dip": 1.3 } });
    expect(decisions[0].notify).toBe(true);
  });
});

describe("severity stays on a shared scale", () => {
  const dayRange = (n: number, logged: boolean) =>
    Array.from({ length: n }, (_, i) => ({ date: moment("2026-09-25").subtract(n - 1 - i, "days").format("YYYY-MM-DD"), logged, calories: null, proteinG: null }));

  const input = (days: ReturnType<typeof dayRange>): SignalInput => ({
    patientId: "t",
    today: "2026-09-25",
    timeZone: "UTC",
    nights: [],
    days,
    workouts: [],
    weights: [],
    plan: null,
    openFindings: [],
  });

  /** The second bug the smoke test found: an unbounded score let a month of
   *  silence outrank every real clinical signal on the shared scale forever. */
  it("caps a long logging gap instead of letting it grow without limit", () => {
    const short = loggingStopped.run(input(dayRange(4, false)));
    const endless = loggingStopped.run(input(dayRange(200, false)));
    expect(short?.severity).toBeCloseTo(4 / 3, 2);
    expect(endless?.severity).toBe(4);
  });

  it("says nothing before the gap reaches its bar", () => {
    expect(loggingStopped.run(input(dayRange(2, false)))).toBeNull();
  });
});

describe("episodes", () => {
  it("keeps one run of firings as a single episode and dates it from the start", () => {
    let state = applyDay([], [candidate("recovery.dip", 2)], "2026-09-01");
    expect(state.opened).toHaveLength(1);
    state = applyDay(state.episodes, [candidate("recovery.dip", 3)], "2026-09-02");
    expect(state.opened).toHaveLength(0);
    expect(state.episodes[0].firstDetectedAt).toBe("2026-09-01");
    expect(state.episodes[0].peakSeverity).toBe(3);
    expect(state.episodes[0].status).toBe("ONGOING");
  });

  it("resolves after the detector's quiet window and opens a fresh episode if it returns", () => {
    let state = applyDay([], [candidate("recovery.dip", 2)], "2026-09-01");
    state = applyDay(state.episodes, [], "2026-09-05"); // quiet longer than resolveAfterDays
    expect(state.resolved).toHaveLength(1);
    expect(state.episodes[0].resolvedAt).toBe("2026-09-05");
    const again = applyDay(state.episodes.filter((e) => e.status !== "RESOLVED"), [candidate("recovery.dip", 2)], "2026-09-20");
    expect(again.opened).toHaveLength(1);
    expect(again.opened[0].firstDetectedAt).toBe("2026-09-20");
  });
});

describe("replay", () => {
  const result = replay(synthetic());

  it("finds the three events planted in the demo history", () => {
    const keys = Object.keys(result.byDetector);
    expect(keys).toEqual(expect.arrayContaining(["recovery.dip", "training.drifting", "logging.stopped"]));
  });

  /** The number the whole design exists to control. If a change to any
   *  detector pushes this up, that is the change to argue about. */
  it("stays well inside the weekly budget over ninety ordinary days", () => {
    expect(result.perWeek).toBeLessThanOrEqual(WEEKLY_BUDGET);
    expect(result.totals.notifications).toBeGreaterThan(0);
  });
});
