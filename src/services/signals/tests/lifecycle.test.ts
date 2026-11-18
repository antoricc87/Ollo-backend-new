import { nightInside, recoveryDip, recentRun } from "../domain/detectors/vitals";
import { applyDay, Episode, NO_DATA_CLOSE_DAYS } from "../domain/episodes";
import { followUpsFor, STILL_GOING_DAYS } from "../domain/followups";
import { NightRow } from "../domain/baseline";
import { Candidate, dayBefore, SignalInput } from "../domain/types";

/**
 * The signal lifecycle (Nov 16 2026): opened → told → followed → closed, with
 * missing data never read as "back to normal".
 */

const dip = (severity = 2): Candidate => ({ detectorKey: "recovery.dip", detectorVersion: 1, direction: "CONCERN", severity, evidence: {}, baseline: null, label: "dip" });

const day = (offset: number) => new Date(Date.parse("2026-11-01") + offset * 86_400_000).toISOString().slice(0, 10);

/** `count` ordinary nights ending the day before `end`, HRV ~55 with a little spread. */
const usualNights = (end: string, count = 30): NightRow[] =>
  Array.from({ length: count }, (_, i) => ({ date: dayBefore(end, count - i), hrvMs: 55 + ((i % 5) - 2) * 2, sleepingHr: 52 }));

const input = (nights: NightRow[], today: string): SignalInput => ({ patientId: "p", today, timeZone: "UTC", nights, days: [], workouts: [], weights: [], plan: null, openFindings: [] });

describe("overnight runs are consecutive and recent", () => {
  const today = "2026-11-20";
  const bad = (date: string): NightRow => ({ date, hrvMs: 30, sleepingHr: 52 });

  it("fires on three bad nights in a row ending last night", () => {
    const nights = [...usualNights(dayBefore(today, 2)), bad(dayBefore(today, 2)), bad(dayBefore(today, 1)), bad(today)];
    expect(recoveryDip.run(input(nights, today))).not.toBeNull();
  });

  it("does not call nights with a gap between them 'three nights running'", () => {
    const nights = [...usualNights(dayBefore(today, 5)), bad(dayBefore(today, 5)), bad(dayBefore(today, 2)), bad(today)];
    expect(recentRun(nights, today)).toBeNull();
    expect(recoveryDip.run(input(nights, today))).toBeNull();
  });

  /** Before: with no new uploads, lastN kept re-judging the same old nights every morning. */
  it("does not keep firing on old nights when nothing new has arrived", () => {
    const end = dayBefore(today, 6);
    const nights = [...usualNights(dayBefore(end, 2)), bad(dayBefore(end, 2)), bad(dayBefore(end, 1)), bad(end)];
    expect(recoveryDip.run(input(nights, today))).toBeNull();
    expect(recoveryDip.dataAsOf!(input(nights, today))).toBeNull();
  });
});

describe("quiet days count only on new data", () => {
  it("a morning with no new night moves nothing", () => {
    let s = applyDay([], [dip()], day(0), { "recovery.dip": day(0) });
    for (let i = 1; i <= 10; i++) s = applyDay(s.episodes, [], day(i), { "recovery.dip": null });
    expect(s.episodes[0].status).toBe("OPEN");
    expect(s.episodes[0].quietDays).toBe(0);
  });

  it("closes after enough fresh quiet nights, as 'quiet'", () => {
    let s = applyDay([], [dip()], day(0), { "recovery.dip": day(0) });
    for (let i = 1; i <= 4; i++) s = applyDay(s.episodes, [], day(i), { "recovery.dip": day(i) });
    expect(s.episodes[0].status).toBe("RESOLVED");
    expect(s.episodes[0].closeReason).toBe("quiet");
  });

  it("the same night seen twice counts once", () => {
    let s = applyDay([], [dip()], day(0), { "recovery.dip": day(0) });
    s = applyDay(s.episodes, [], day(1), { "recovery.dip": day(1) });
    s = applyDay(s.episodes, [], day(2), { "recovery.dip": day(1) });
    expect(s.episodes[0].quietDays).toBe(1);
  });

  it("with no data for too long it closes as 'no_data' — never as back to normal", () => {
    let s = applyDay([], [dip()], day(0), { "recovery.dip": day(0) });
    s = applyDay(s.episodes, [], day(NO_DATA_CLOSE_DAYS + 1), { "recovery.dip": null });
    expect(s.resolved[0].closeReason).toBe("no_data");
  });
});

describe("back to your usual = nights inside it, in a row (Nov 17 2026)", () => {
  const today = "2026-11-20";
  const usual = usualNights(dayBefore(today, 6));
  const off = (date: string): NightRow => ({ date, hrvMs: 30, sleepingHr: 52 });
  const ok = (date: string): NightRow => ({ date, hrvMs: 55, sleepingHr: 52 });

  it("judges a night by the dip's own cut-off", () => {
    expect(nightInside([...usual, off(today)], today)).toBe(false);
    expect(nightInside([...usual, ok(today)], today)).toBe(true);
    expect(nightInside(usual, today)).toBeNull();
  });

  it("an off night that breaks no 3-night run does not count as back, and starts the count again", () => {
    let s = applyDay([], [dip()], day(0), { "recovery.dip": day(0) });
    const pattern = [true, false, false, true, true, true]; // good, off, off, good, good, good
    pattern.forEach((inside, i) => {
      s = applyDay(s.episodes, [], day(i + 1), { "recovery.dip": day(i + 1) }, { "recovery.dip": inside });
    });
    // Before: 4 mornings without the 3-in-a-row firing closed it by day 4.
    expect(s.episodes[0].status).not.toBe("RESOLVED");
    expect(s.episodes[0].quietDays).toBe(3);
    s = applyDay(s.episodes, [], day(7), { "recovery.dip": day(7) }, { "recovery.dip": true });
    expect(s.episodes[0].status).toBe("RESOLVED");
    expect(s.episodes[0].closeReason).toBe("quiet");
  });
});

describe("follow-ups on a signal already told", () => {
  const told = (over: Partial<Episode> = {}): Episode => ({
    detectorKey: "recovery.dip",
    detectorVersion: 1,
    direction: "CONCERN",
    status: "ONGOING",
    severity: 2,
    peakSeverity: 2,
    evidence: {},
    baseline: null,
    firstDetectedAt: day(0),
    lastSeenAt: day(STILL_GOING_DAYS),
    resolvedAt: null,
    notifiedAt: day(0),
    notifiedSeverity: 2,
    quietDays: 0,
    lastDataAt: day(STILL_GOING_DAYS),
    closeReason: null,
    followUps: {},
    ...over,
  });
  const today = day(STILL_GOING_DAYS);

  it("a week on and still firing → one 'still going' note", () => {
    expect(followUpsFor([told()], [], today).map((f) => f.kind)).toEqual(["still_going"]);
    expect(followUpsFor([told({ followUps: { stillGoing: "x" } })], [], today)).toEqual([]);
  });

  it("not before a week, not when it was never told, not when it already led to a check-in", () => {
    expect(followUpsFor([told({ firstDetectedAt: day(2) })], [], today)).toEqual([]);
    expect(followUpsFor([told({ notifiedAt: null })], [], today)).toEqual([]);
    expect(followUpsFor([told({ encounterId: "e1" })], [], today)).toEqual([]);
  });

  it("open only for want of data is not 'still going'", () => {
    expect(followUpsFor([told({ lastSeenAt: day(2) })], [], today)).toEqual([]);
  });

  it("closed on fresh quiet data → one 'back to your usual' note; closed for no data → nothing", () => {
    const quiet = told({ status: "RESOLVED", closeReason: "quiet", resolvedAt: today });
    expect(followUpsFor([quiet], [quiet], today).map((f) => f.kind)).toEqual(["back_to_usual"]);
    const silent = told({ status: "RESOLVED", closeReason: "no_data", resolvedAt: today });
    expect(followUpsFor([silent], [silent], today)).toEqual([]);
  });

  it("never for a habit, never for a lab report", () => {
    expect(followUpsFor([told({ detectorKey: "training.stopped" })], [], today)).toEqual([]);
    const lab = told({ detectorKey: "labs.report", status: "RESOLVED", closeReason: "quiet" });
    expect(followUpsFor([lab], [lab], today)).toEqual([]);
  });
});
