import { nextAskDay } from "../../encounter/domain/followUp";
import { NightRow } from "../domain/baseline";
import { nightInside, RUN_NIGHTS } from "../domain/detectors/vitals";
import { dayBefore } from "../domain/types";
import { checkinCard, checkinDetail, CheckinRow, dataCard, DataContext, FindingRow, overviewOf } from "../domain/view";

/** The Signals page as the server builds it (Nov 17 2026), one case per card in his mockups. */

const finding = (over: Partial<FindingRow> = {}): FindingRow => ({
  id: "f1",
  detectorKey: "recovery.dip",
  status: "ONGOING",
  direction: "CONCERN",
  severity: 2,
  notifiedSeverity: 2,
  evidence: { vitals: [{ vital: "hrvMs", meanSigma: 2 }, { vital: "sleepingHr", meanSigma: 1.4 }], nights: [{}, {}, {}] },
  baseline: { vital: "hrvMs", n: 30, mean: 58, std: 6 },
  firstDetectedAt: "2026-10-07",
  lastSeenAt: "2026-10-09",
  resolvedAt: null,
  lastDataAt: "2026-10-11",
  notifiedAt: "2026-10-07",
  quietDays: 2,
  closeReason: null,
  threadId: "t1",
  encounterId: null,
  ...over,
});

const usual = (end: string, count = 40): NightRow[] => Array.from({ length: count }, (_, i) => ({ date: dayBefore(end, count - i), hrvMs: 58 + ((i % 5) - 2) * 2, sleepingHr: 52 }));
const run: NightRow[] = [
  ...usual("2026-10-05"),
  { date: "2026-10-05", hrvMs: 40, sleepingHr: 52 },
  { date: "2026-10-06", hrvMs: 38, sleepingHr: 52 },
  { date: "2026-10-07", hrvMs: 41, sleepingHr: 52 },
  { date: "2026-10-08", hrvMs: 40, sleepingHr: 52 },
  { date: "2026-10-09", hrvMs: 39, sleepingHr: 52 },
  { date: "2026-10-10", hrvMs: 58, sleepingHr: 52 },
  { date: "2026-10-11", hrvMs: 59, sleepingHr: 52 },
];

const ctx = (over: Partial<DataContext> = {}, nights = run): DataContext => ({ today: "2026-10-11", runNights: RUN_NIGHTS, nights, inside: (d) => nightInside(nights, d), linked: null, ...over });

const checkin = (over: Partial<CheckinRow> = {}): CheckinRow => ({
  id: "e1",
  title: "Lower back pain",
  unnamed: false,
  complaintText: "Lower back pain after soccer, worse during and after playing.",
  state: "assessed",
  outcome: null,
  threadId: "t9",
  startedOn: "2026-10-04",
  closedOn: null,
  checkIns: [{ day: 3, trend: "BETTER", note: null, on: "2026-10-07" }],
  severity: 7,
  questionsLeft: 0,
  topPossibility: "Muscle strain from play",
  warningSigns: [],
  followUp: { due: false, trajectory: "Since you started this, you've reported better once. Last time you said it was better." },
  nextAskOn: "2026-10-09",
  ...over,
});

describe("C1 · overnight, open, settling", () => {
  const card = dataCard(finding(), ctx());
  it("starts on the first off night and counts nights with data", () => {
    expect(card.meta).toBe("Since 5 Oct · 7 nights");
    // The episode's nights, not the 3-night window the detector last judged.
    expect(card.line).toBe("HRV and sleeping heart rate away from your usual on 5 of 7 nights");
  });
  it("draws each night with the SAME judgement that counts toward the close", () => {
    const e = card.evidence as any;
    expect(e.usual.line).toBe("Your usual · HRV 58 ± 6 ms");
    expect(e.nights.map((n: any) => n.off)).toEqual([true, true, true, true, true, false, false]);
  });
  it("trend counts nights back, concern is Watch, actions tell + note", () => {
    expect(card.trend).toEqual({ key: "settling", label: "Settling", line: "2 of 4 nights back in your usual", progress: { done: 2, of: 4 } });
    expect(card.concern?.label).toBe("Watch");
    expect(card.actions.map((a) => a.kind)).toEqual(["tell_ollie", "view_note"]);
  });
});

describe("C2 · weight, on record only", () => {
  const card = dataCard(
    finding({
      detectorKey: "weight.change",
      notifiedAt: null,
      notifiedSeverity: null,
      threadId: null,
      quietDays: 0,
      evidence: { direction: "down", change: 4.1, changePercent: 5.3, unit: "kg", days: 21, from: { date: "2026-09-14", value: 78 }, to: { date: "2026-10-05", value: 73.9 }, planAimsForLoss: true },
    }),
    ctx()
  );
  it("tags it on record only, two-point strip, Flat, one action", () => {
    expect(card.tags.map((t) => t.key)).toEqual(["source_data", "on_record"]);
    expect(card.meta).toBe("Mon 14 Sep → Mon 5 Oct · 21 days");
    expect((card.evidence as any).to).toMatchObject({ label: "5 Oct", value: 73.9 });
    expect(card.trend?.label).toBe("Flat");
    expect(card.actions.map((a) => a.kind)).toEqual(["tell_ollie"]);
  });
});

describe("C3/C4 · lab reports", () => {
  const ev = {
    collectedAt: ["2026-10-06"],
    valuesOnReport: 40,
    newlyFlagged: [{ key: "ldl", testType: "LDL cholesterol", result: "162", units: "mg/dL", referenceRange: "<130", previous: { result: "128" } }],
    changed: [],
    backInRange: [{ key: "Ferritin", result: "88", units: "ng/mL", referenceRange: "30-400", previous: { result: "19" } }],
    stillFlagged: [{ key: "Vitamin D" }],
  };
  it("open: counts changed of the whole report, no trend, Explain my report", () => {
    const card = dataCard(finding({ detectorKey: "labs.report", evidence: ev, quietDays: 0, status: "OPEN" }), ctx());
    expect(card.meta).toBe("Report of Tue 6 Oct · 2 changed of 40");
    expect((card.evidence as any).values[0].name).toBe("LDL cholesterol");
    expect(card.trend).toBeNull();
    expect(card.actions[0]).toMatchObject({ kind: "explain_report", prompt: "Explain my lab report from 6 Oct 2026." });
    expect((card.evidence as any).line).toBe("1 other value still outside the range, about where it was");
  });
  it("resolved next morning: no meter, never 'back to your usual'", () => {
    const card = dataCard(finding({ detectorKey: "labs.report", evidence: ev, status: "RESOLVED", resolvedAt: "2026-10-07", closeReason: "quiet" }), ctx());
    expect(card.concern).toBeNull();
    expect(card.closeLabel).toBe("Report of 6 Oct · 1 newly outside, 1 back inside");
  });
  it("good news reads Low with a Good news tag", () => {
    const card = dataCard(finding({ detectorKey: "labs.report", direction: "POSITIVE", status: "OPEN", evidence: { ...ev, newlyFlagged: [] } }), ctx());
    expect(card.tags.map((t) => t.key)).toContain("good_news");
    expect(card.concern?.label).toBe("Low");
    expect(card.actions.map((a) => a.kind)).toEqual(["view_note"]);
  });
});

describe("C5 · closed for lack of data", () => {
  const card = dataCard(finding({ status: "RESOLVED", resolvedAt: "2026-10-29", lastDataAt: "2026-10-07", closeReason: "no_data", quietDays: 0 }), ctx({ today: "2026-11-01" }));
  it("says it can't tell, trims the gap, Low", () => {
    expect(card.tags.map((t) => t.key)).toContain("cant_tell");
    expect(card.line).toBe("No data since Wed 7 Oct, so there is no way to tell how it went.");
    expect((card.evidence as any).gapNights).toBe(19);
    expect(card.trend?.label).toBe("No new data");
    expect(card.concern?.label).toBe("Low");
    expect(card.closeLabel).toBe("No data since 7 Oct · can't tell");
  });
});

describe("C6 · linked to a check-in, getting worse", () => {
  const c = checkin({ followUp: { due: true, trajectory: null } });
  const card = dataCard(finding({ quietDays: 0, severity: 2.8, encounterId: "e1" }), ctx({ linked: { card: checkinCard(c), due: true, threadId: "t9", complaintText: "Sleeping badly and tired all week.", checkIns: 2 } }));
  it("both sources, the data's trend, the follow-up as the action", () => {
    expect(card.tags.map((t) => t.key)).toEqual(["source_data", "source_reported"]);
    expect(card.meta).toMatch(/· 2 check-ins$/);
    expect(card.you).toBe("Sleeping badly and tired all week.");
    expect(card.trend?.label).toBe("Getting worse");
    expect(card.actions[0].kind).toBe("answer_followup");
  });
  it("a warning sign in the check-in makes the signal Act", () => {
    const flagged = checkin({ warningSigns: ["New weakness in a leg"] });
    const card2 = dataCard(finding({ encounterId: "e1" }), ctx({ linked: { card: checkinCard(flagged), due: false, threadId: "t9", complaintText: "x", checkIns: 1 } }));
    expect(card2.concern?.label).toBe("Act");
  });
  it("a finding that closed stays an OPEN signal while its check-in is followed, and Watch", () => {
    const followed = checkin();
    const c = dataCard(finding({ status: "RESOLVED", resolvedAt: "2026-10-11", closeReason: "quiet", encounterId: "e1" }), ctx({ linked: { card: checkinCard(followed), due: false, threadId: "t9", complaintText: "x", checkIns: 2 } }));
    expect(c.status).toBe("open");
    expect(c.trend?.label).toBe("Back to usual");
    expect(c.concern?.label).toBe("Watch");
    const closed = dataCard(finding({ status: "RESOLVED", resolvedAt: "2026-10-11", closeReason: "quiet", encounterId: "e1" }), ctx({ linked: { card: checkinCard(checkin({ state: "closed", outcome: "resolved", closedOn: "2026-10-12" })), due: false, threadId: "t9", complaintText: "x", checkIns: 2 } }));
    expect(closed.status).toBe("resolved");
    expect(closed.concern?.label).toBe("Low");
  });

  it("the linked check-in is not listed again", () => {
    const o = overviewOf([card, checkinCard(c)], new Set(["e1"]));
    expect(o.open).toHaveLength(1);
    expect(o.meta).toBe("1 open · 0 resolved");
  });
});

describe("check-in card and page", () => {
  it("paused: tag, continue with the resume words, what is left", () => {
    const c = checkin({ state: "paused", questionsLeft: 2, checkIns: [], followUp: null, nextAskOn: null, topPossibility: null });
    const card = checkinCard(c);
    expect(card.tags[0]).toEqual({ key: "paused", text: "Check-in paused" });
    expect(card.meta).toBe("Since Sun 4 Oct · 1 check-in");
    expect(card.actions[0]).toMatchObject({ kind: "continue_checkin", prompt: "Let's pick the check-in back up." });
    const d = checkinDetail(c, "disclaimer");
    expect(d.timeline[0].tag?.text).toBe("Paused");
    expect(d.timeline[0].rows.find((r) => r.key === "LEFT")?.text).toBe("2 questions left");
  });
  it("assessed: the chart is direction only and the OLLIE line quotes the assessment", () => {
    const d = checkinDetail(checkin(), "disclaimer");
    expect(d.chart?.points.map((p) => p.step)).toEqual([0, -1]);
    expect(d.trend?.label).toBe("Easing");
    expect(d.concern?.line).toBe("No warning signs so far");
    expect(d.timeline[1].rows.find((r) => r.key === "OLLIE")?.text).toBe("Most consistent with muscle strain from play. No warning signs.");
    expect(d.timeline[1].rows.find((r) => r.key === "FELT")?.text).toBe("7 out of 10 at its worst");
    expect(d.nextFollowUp?.label).toBe("Fri 9 Oct");
  });
  it("closed: Low, outcome line", () => {
    const card = checkinCard(checkin({ state: "closed", outcome: "resolved", closedOn: "2026-10-09" }));
    expect(card.status).toBe("resolved");
    expect(card.concern?.label).toBe("Low");
    expect(card.closeLabel).toBe("Closed after you said it was better · 4–9 Oct");
  });
});

describe("trend words fit one line", () => {
  it("every label is 14 characters or fewer; the detail is in the line", () => {
    const cards = [
      dataCard(finding(), ctx()),
      dataCard(finding({ quietDays: 0 }), ctx()),
      dataCard(finding({ quietDays: 0, severity: 3 }), ctx()),
      dataCard(finding({ lastDataAt: "2026-10-05" }), ctx()),
      dataCard(finding({ status: "RESOLVED", resolvedAt: "2026-10-11", closeReason: "quiet" }), ctx()),
      dataCard(finding({ detectorKey: "weight.change", status: "RESOLVED", resolvedAt: "2026-10-11", closeReason: "quiet" }), ctx()),
      dataCard(finding({ status: "RESOLVED", resolvedAt: "2026-10-29", closeReason: "no_data" }), ctx()),
      ...(["BETTER", "SAME", "WORSE"] as const).map((t) => checkinCard(checkin({ checkIns: [{ day: 3, trend: t, note: null, on: "2026-10-07" }] }))),
    ];
    for (const c of cards) {
      expect(c.trend).not.toBeNull();
      expect(c.trend!.label.length).toBeLessThanOrEqual(14);
      expect(c.trend!.line).toBeTruthy();
    }
  });
});

describe("next ask day", () => {
  const start = new Date("2026-10-04T10:00:00Z");
  const now = (d: number) => new Date(start.getTime() + d * 86_400_000 + 3600_000);
  it("the next scheduled day, today when due, tomorrow after worse", () => {
    expect(nextAskDay(start, [], now(1))).toBe(2);
    expect(nextAskDay(start, [], now(2))).toBe(2);
    expect(nextAskDay(start, [{ day: 2, trend: "SAME", createdAt: now(2) }], now(3))).toBe(5);
    expect(nextAskDay(start, [{ day: 3, trend: "WORSE", createdAt: now(3) }], now(3))).toBe(4);
    expect(nextAskDay(start, [{ day: 10, trend: "SAME", createdAt: now(10) }], now(11))).toBeNull();
  });
});
