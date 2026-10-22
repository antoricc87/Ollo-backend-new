import { decideDelivery, digestPush, inQuietHours, DAILY_CAP, WEEKLY_CAP } from "../../src/services/notifications/gate";
import { rescheduleMissed, overlaps } from "../../src/services/workouts/design/reschedule";
import { lastNightLow } from "../../src/services/signals/domain/lastNight";
import { pickStat, weekStats, statLine } from "../../src/services/review/domain/weekStats";
import { turnEndNudge, TurnFacts } from "../../src/services/agent/turnChecks";
import moment from "moment-timezone";

/** Background tasks + the morning digest (ruling Oct 16 2026). */

const NY = "America/New_York";
const at = (local: string) => moment.tz(local, "YYYY-MM-DD HH:mm", NY).toDate();

describe("the gate", () => {
  const base = { timeZone: NY, pushedToday: 0, pushedThisWeek: 0 };

  it("holds digest work for the morning, whatever the hour", () => {
    expect(decideDelivery({ ...base, mode: "digest", now: at("2026-10-16 14:00") })).toMatchObject({ status: "held", reason: "digest" });
  });

  it("lets a 'now' push through in the day", () => {
    expect(decideDelivery({ ...base, mode: "now", now: at("2026-10-16 14:00") })).toMatchObject({ status: "queued", reason: null });
  });

  it("moves a 'now' push out of quiet hours to 07:30 local", () => {
    const v = decideDelivery({ ...base, mode: "now", now: at("2026-10-18 22:15") });
    expect(v.status).toBe("queued");
    expect(moment(v.scheduledFor).tz(NY).format("YYYY-MM-DD HH:mm")).toBe("2026-10-19 07:30");
    const early = decideDelivery({ ...base, mode: "now", now: at("2026-10-19 06:00") });
    expect(moment(early.scheduledFor).tz(NY).format("YYYY-MM-DD HH:mm")).toBe("2026-10-19 07:30");
  });

  it("quiet hours are 21:30 to 07:30", () => {
    expect(inQuietHours(moment.tz("2026-10-16 21:29", "YYYY-MM-DD HH:mm", NY))).toBe(false);
    expect(inQuietHours(moment.tz("2026-10-16 21:30", "YYYY-MM-DD HH:mm", NY))).toBe(true);
    expect(inQuietHours(moment.tz("2026-10-16 07:29", "YYYY-MM-DD HH:mm", NY))).toBe(true);
    expect(inQuietHours(moment.tz("2026-10-16 07:30", "YYYY-MM-DD HH:mm", NY))).toBe(false);
  });

  it("over a cap, the push waits for the digest instead", () => {
    expect(decideDelivery({ ...base, mode: "now", now: at("2026-10-16 14:00"), pushedToday: DAILY_CAP })).toMatchObject({ status: "held", reason: "daily_cap" });
    expect(decideDelivery({ ...base, mode: "now", now: at("2026-10-16 14:00"), pushedThisWeek: WEEKLY_CAP })).toMatchObject({ status: "held", reason: "weekly_cap" });
  });
});

describe("the digest push", () => {
  it("one item reads as that item and opens its note", () => {
    expect(digestPush([{ kind: "missed_session", threadId: "t1" }])).toEqual({ body: "This week's training is adjusted — take a look", route: "ollie?threadId=t1", threadId: "t1" });
  });

  it("several read as one sentence of work done and open the Ready list", () => {
    expect(digestPush([{ kind: "weekly_review", threadId: "a" }, { kind: "missed_session", threadId: "b" }, { kind: "signal", threadId: "c" }])).toEqual({
      body: "Ready for you: your weekly review, this week's training adjusted and a note on something that changed.",
      route: "ollie/ready",
      threadId: null,
    });
  });

  it("two of a kind are one line, and no line names a finding", () => {
    const p = digestPush([{ kind: "signal", threadId: "a" }, { kind: "signal", threadId: "b" }])!;
    expect(p.body).toBe("Ready for you: a note on something that changed.");
    expect(p.body).not.toMatch(/HRV|sleep|weight|lab|pain/i);
  });

  it("nothing held, nothing sent", () => {
    expect(digestPush([])).toBeNull();
  });
});

describe("where a missed session goes", () => {
  const upper = (date: string) => ({ date, muscleGroups: ["upper body"], focus: "strength" });
  const legs = (date: string) => ({ date, muscleGroups: ["legs"], focus: "strength" });
  // Week Mon 12 → Sun 18 Oct. Missed: Tue 13 upper. Today Wed 14.
  const week = { missed: upper("2026-10-13"), today: "2026-10-14", weekEnd: "2026-10-18" };

  it("prefers a free day with rest on both sides", () => {
    // Mon 12 legs, Sat 17 legs → Wed 14 has free days on both sides (Tue 13 is the missed day itself).
    expect(rescheduleMissed({ ...week, others: [legs("2026-10-12"), legs("2026-10-17")] })).toEqual({ to: "2026-10-14", why: "free_with_rest_either_side" });
  });

  it("otherwise picks a free day whose neighbours train different muscles", () => {
    // Free: Wed 14 (next to Thu legs), Fri 16 (Thu legs, Sat upper), Sun 18 (Sat upper).
    expect(rescheduleMissed({ ...week, others: [legs("2026-10-15"), upper("2026-10-17")] })).toEqual({ to: "2026-10-14", why: "free_next_to_different_muscles" });
    // Wed taken by upper: Fri sits next to Sat upper — no; Sun next to Sat upper — no.
    expect(rescheduleMissed({ ...week, others: [upper("2026-10-14"), legs("2026-10-15"), upper("2026-10-17")] })).toBeNull();
  });

  it("never the past, never past the end of the week, never a day already taken", () => {
    const full = ["2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"].map(legs);
    expect(rescheduleMissed({ ...week, others: full })).toBeNull();
    expect(rescheduleMissed({ ...week, today: "2026-10-19", others: [] })).toBeNull();
  });

  it("muscle overlap reads words, and an untagged session overlaps everything", () => {
    expect(overlaps(upper("a"), { date: "b", muscleGroups: ["chest and back"], focus: null })).toBe(false);
    expect(overlaps({ date: "a", muscleGroups: ["back"], focus: null }, { date: "b", muscleGroups: ["chest and back"], focus: null })).toBe(true);
    expect(overlaps(upper("a"), { date: "b", muscleGroups: [], focus: null })).toBe(true);
  });
});

describe("last night against your usual", () => {
  const usual = Array.from({ length: 20 }, (_, i) => ({ date: `2026-09-${String(i + 10).padStart(2, "0")}`, hrvMs: 50 + (i % 2 ? 4 : -4), sleepingHr: 55 + (i % 2 ? 1 : -1) }));

  // The usual spreads at least 5 ms (the app's floor), so 10 ms under reads as 2 SD.
  it("is low when HRV is one SD or more below their usual", () => {
    const r = lastNightLow([...usual, { date: "2026-10-16", hrvMs: 40, sleepingHr: 55 }], "2026-10-16");
    expect(r?.low).toEqual([{ vital: "hrvMs", value: 40, usual: 50, sigma: 2 }]);
  });

  it("is low when sleeping heart rate is one SD or more above", () => {
    expect(lastNightLow([...usual, { date: "2026-10-16", hrvMs: 50, sleepingHr: 60 }], "2026-10-16")?.low.map((l) => l.vital)).toEqual(["sleepingHr"]);
  });

  it("is quiet inside the usual, without last night, or without enough nights to know the usual", () => {
    expect(lastNightLow([...usual, { date: "2026-10-16", hrvMs: 48, sleepingHr: 55.5 }], "2026-10-16")).toBeNull();
    expect(lastNightLow(usual, "2026-10-16")).toBeNull();
    expect(lastNightLow([...usual.slice(0, 3), { date: "2026-10-16", hrvMs: 20, sleepingHr: 70 }], "2026-10-16")).toBeNull();
  });
});

describe("one number worth knowing", () => {
  // 28 days ending Sun 2026-10-11. Training on Mon/Wed/Fri.
  const dates = Array.from({ length: 28 }, (_, i) => moment.utc("2026-09-14").add(i, "days").format("YYYY-MM-DD"));
  const trainingDays = dates.filter((d) => [1, 3, 5].includes(moment.utc(d).day()));
  const workouts = trainingDays.map((date) => ({ date, status: "COMPLETED" as const, minutes: 50 }));
  const afterTraining = (d: string) => trainingDays.includes(moment.utc(d).subtract(1, "day").format("YYYY-MM-DD"));
  const range = { from: "2026-09-14", to: "2026-10-11" };

  it("finds a real gap between two groups of their own days", () => {
    const nights = dates.map((date) => ({ date, asleepMinutes: afterTraining(date) ? 470 : 430, hrvMs: 50 }));
    const stats = weekStats({ nights, days: [], workouts, ...range });
    expect(stats[0]).toMatchObject({ key: "sleep_after_training", diff: 40, a: { mean: 470, n: 12 }, b: { mean: 430, n: 16 } });
    expect(statLine(stats[0])).toBe("time asleep: 470 min on nights after a training day (12) vs 430 min on nights after a rest day (16), 2026-09-14 → 2026-10-11");
  });

  it("says nothing when the gap is under its bar or a group is too small", () => {
    const close = dates.map((date) => ({ date, asleepMinutes: afterTraining(date) ? 445 : 430, hrvMs: 50 }));
    expect(weekStats({ nights: close, days: [], workouts, ...range })).toEqual([]);
    const thin = dates.slice(0, 6).map((date) => ({ date, asleepMinutes: afterTraining(date) ? 500 : 400, hrvMs: null }));
    expect(weekStats({ nights: thin, days: [], workouts, ...range })).toEqual([]);
  });

  it("never repeats last week's", () => {
    const nights = dates.map((date) => ({ date, asleepMinutes: afterTraining(date) ? 470 : 430, hrvMs: afterTraining(date) ? 44 : 52 }));
    const stats = weekStats({ nights, days: [], workouts, ...range });
    expect(stats.map((s) => s.key)).toEqual(["sleep_after_training", "hrv_after_training"]);
    expect(pickStat(stats, "sleep_after_training")?.key).toBe("hrv_after_training");
    expect(pickStat(stats.slice(0, 1), "sleep_after_training")).toBeNull();
  });
});

describe("a background note carries its work", () => {
  const facts = (over: Partial<TurnFacts>): TurnFacts =>
    ({ text: "", userMessage: "", proactive: null, usedTools: false, toolsCalled: [], proposed: false, saved: false, generated: false, checkin: { inThread: false, active: false, historyComplete: false, ownQuestionsLeft: 0, flagged: false, rejected: null }, ...over }) as TurnFacts;

  it("a missed-session note must prepare the move", () => {
    expect(turnEndNudge(facts({ proactive: "missed_session", text: "I've lined Tuesday's session up for Thursday." }))?.stage).toBe("missed_session_without_move");
    expect(turnEndNudge(facts({ proactive: "missed_session", text: "Lined up for Thursday.", usedTools: true, proposed: true, toolsCalled: ["move_workout"] }))).toBeNull();
  });

  it("a lighter-option note must design the session", () => {
    expect(turnEndNudge(facts({ proactive: "lighter_today", text: "A lighter version is ready." }))?.stage).toBe("lighter_today_without_card");
    expect(turnEndNudge(facts({ proactive: "lighter_today", text: "A lighter version is on the card.", usedTools: true, generated: true, toolsCalled: ["generate_workout"] }))).toBeNull();
  });
});
