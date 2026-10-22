import { buildWeekReview, WeekData, WeekDay, WeekReviewInput } from "../domain/weekReview";

const FROM = "2026-09-21";
const dates = (from: string) => Array.from({ length: 7 }, (_, i) => new Date(Date.parse(`${from}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10));

const full = (date: string, calories = 2240, proteinG = 118): WeekDay => ({ date, mealTypes: ["BREAKFAST", "LUNCH", "DINNER"], calories, proteinG });
const empty = (date: string): WeekDay => ({ date, mealTypes: [], calories: 0, proteinG: 0 });
const part = (date: string): WeekDay => ({ date, mealTypes: ["BREAKFAST"], calories: 350, proteinG: 20 });

/** A week with `logged` full food days and `nights` recorded nights. */
const week = (from: string, o: { logged?: number; nights?: number; sleep?: number; hrv?: number; sessions?: number; planned?: number; weights?: number[]; kcal?: number; protein?: number } = {}): WeekData => {
  const ds = dates(from);
  return {
    days: ds.map((d, i) => (i < (o.logged ?? 7) ? full(d, o.kcal, o.protein) : empty(d))),
    nights: ds.slice(0, o.nights ?? 7).map((date) => ({ date, asleepMinutes: o.sleep ?? 438, hrvMs: o.hrv ?? 61 })),
    sessions: ds.slice(0, o.sessions ?? 4).map((date) => ({ date, minutes: 47.5 })),
    planned: o.planned ?? 4,
    weights: (o.weights ?? []).map((value, i) => ({ date: ds[i], value })),
  };
};

const input = (o: Partial<WeekReviewInput> = {}): WeekReviewInput => ({
  from: FROM,
  to: "2026-09-27",
  week: week(FROM, { weights: [74.4, 74.2, 74.2, 74.0] }),
  previous: week("2026-09-14", { sleep: 426, hrv: 57, sessions: 3, kcal: 2300, protein: 132, weights: [74.6] }),
  targets: { calories: { min: 2300, max: 2300 }, proteinG: { min: 140, max: null }, sleepMinutes: 420, sessionsPerWeek: 4 },
  hrvBaseline: { n: 40, mean: 60, std: 6 },
  hasNights: true,
  weightUnit: "kg",
  ...o,
});

const row = (r: ReturnType<typeof buildWeekReview>, key: string) => r.rows.find((x) => x.key === key);

describe("weekly review card", () => {
  it("reproduces the mockup when the whole week is recorded", () => {
    const r = buildWeekReview(input());
    expect(r.range).toBe("Mon 21–Sun 27 Sep");
    expect(r.logged).toEqual({ days: 7, of: 7, partDays: 0 });
    expect(r.rows.map((x) => x.key)).toEqual(["sleep", "hrv", "train", "kcal", "protein", "weight"]);
    expect(row(r, "sleep")).toMatchObject({ value: "7:18", delta: "+12m", deltaTone: "good", sub: "7 nights over 7 h" });
    expect(row(r, "hrv")).toMatchObject({ value: "61 ms", delta: "+4", sub: "Inside your usual band" });
    expect(row(r, "train")).toMatchObject({ value: "4 / 4", delta: "+1", sub: "3 h 10 m total", flagged: false });
    expect(row(r, "kcal")).toMatchObject({ value: "2,240", delta: "−60", sub: "Target 2,300", flagged: false });
    expect(row(r, "protein")).toMatchObject({ value: "118 g", delta: "−14 g", sub: "Target 140 g", flagged: true, deltaTone: "flag" });
    expect(row(r, "weight")).toMatchObject({ value: "74.2 kg", delta: "−0.4", sub: "4 weigh-ins", deltaTone: "neutral" });
    expect(r.flags).toEqual([{ key: "protein", text: "PROTEIN LOW" }]);
    expect(r.title).toBe("A steady week, mostly on plan");
    expect(r.strip.every((d) => d.state === "off")).toBe(true); // every day short on protein
  });

  it("prints no average, flag or delta for food logged on too few days", () => {
    const r = buildWeekReview(input({ week: week(FROM, { logged: 2, protein: 60 }) }));
    expect(row(r, "kcal")).toBeUndefined();
    expect(row(r, "protein")).toBeUndefined();
    expect(row(r, "food")).toMatchObject({ value: null, delta: null, flagged: false, sub: "2 of 7 days logged, too few to average", coverage: "thin" });
    expect(r.flags).toEqual([]); // 60 g against 140 would be "low" — but two days prove nothing
    expect(r.title).toBe("On plan where it was recorded");
    expect(r.notJudged[0]).toContain("Food log");
    expect(r.strip.map((d) => d.state)).toEqual(["off", "off", "none", "none", "none", "none", "none"]);
  });

  it("says nothing was logged rather than showing zeros", () => {
    const r = buildWeekReview(input({ week: week(FROM, { logged: 0 }) }));
    expect(row(r, "food")).toMatchObject({ value: null, sub: "Nothing logged this week" });
    expect(JSON.stringify(r.rows)).not.toMatch(/"value":"0( g)?"/);
  });

  it("averages only full days, says how many, and leaves part-logged days out", () => {
    const w = week(FROM, { logged: 5 });
    w.days[5] = part(w.days[5].date);
    const r = buildWeekReview(input({ week: w }));
    expect(r.logged).toEqual({ days: 5, of: 7, partDays: 1 });
    expect(row(r, "kcal")).toMatchObject({ value: "2,240", sub: "5 of 7 days · target 2,300", coverage: "partial" });
    expect(r.strip[5].state).toBe("part");
    expect(r.strip[6].state).toBe("none");
  });

  it("gives no 'vs last' when last week was thin", () => {
    const r = buildWeekReview(input({ previous: week("2026-09-14", { logged: 2, nights: 1 }) }));
    expect(row(r, "kcal")).toMatchObject({ value: "2,240", delta: null });
    expect(row(r, "protein")?.delta).toBeNull();
    expect(row(r, "sleep")).toMatchObject({ value: "7:18", delta: null });
    expect(row(r, "hrv")?.delta).toBeNull();
  });

  it("keeps a sleep row with a dash when the watch was worn too few nights", () => {
    const r = buildWeekReview(input({ week: week(FROM, { nights: 2, sleep: 300 }) }));
    expect(row(r, "sleep")).toMatchObject({ value: null, delta: null, flagged: false, sub: "2 of 7 nights recorded" });
    expect(row(r, "hrv")).toMatchObject({ value: null, sub: "2 of 7 nights recorded" });
    expect(r.flags.map((f) => f.key)).not.toContain("sleep");
  });

  it("drops the sleep rows entirely for someone with no nights on record", () => {
    const none = { ...week(FROM), nights: [] };
    const r = buildWeekReview(input({ week: none, previous: { ...week("2026-09-14"), nights: [] }, hasNights: false }));
    expect(row(r, "sleep")).toBeUndefined();
    expect(row(r, "hrv")).toBeUndefined();
    expect(r.notJudged.join(" ")).toContain("no nights on record");
  });

  it("shows body weight only when they weighed in, and no delta without a previous weigh-in", () => {
    expect(row(buildWeekReview(input({ week: week(FROM) })), "weight")).toBeUndefined();
    const r = buildWeekReview(input({ week: week(FROM, { weights: [163.2] }), previous: week("2026-09-14"), weightUnit: "lb" }));
    expect(row(r, "weight")).toMatchObject({ value: "163.2 lb", delta: null, sub: "1 weigh-in" });
  });

  it("flags short sleep and missed sessions only from recorded data", () => {
    const r = buildWeekReview(input({ week: week(FROM, { sleep: 370, sessions: 2, protein: 150 }) }));
    expect(r.flags).toEqual([
      { key: "sleep", text: "SLEEP SHORT" },
      { key: "train", text: "SESSIONS MISSED" },
    ]);
    expect(row(r, "train")).toMatchObject({ value: "2 / 4", flagged: true });
    expect(row(r, "sleep")?.sub).toBe("0 nights over 7 h");
  });

  it("gives no whole-week verdict off training alone when the food log is missing", () => {
    const r = buildWeekReview(input({ week: week(FROM, { logged: 0, sessions: 1 }) }));
    expect(r.title).toBe("Too little logged to judge the week");
    expect(r.flags.map((f) => f.text)).toContain("SESSIONS MISSED"); // the recorded fact still shows
  });

  it("refuses a title when nothing can be judged", () => {
    const r = buildWeekReview(
      input({
        week: { ...week(FROM, { logged: 1, nights: 0, sessions: 0, planned: 0 }) },
        targets: { calories: { min: 2300, max: 2300 }, proteinG: { min: 140, max: null }, sleepMinutes: 420, sessionsPerWeek: null },
      })
    );
    expect(r.title).toBe("Not enough recorded to judge the week");
    expect(row(r, "train")).toMatchObject({ value: "0", sub: "None recorded", flagged: false });
  });

  it("does not grade days when there are no food targets", () => {
    const r = buildWeekReview(input({ targets: { calories: null, proteinG: null, sleepMinutes: null, sessionsPerWeek: null } }));
    expect(r.strip.every((d) => d.state === "on")).toBe(true);
    expect(r.flags).toEqual([]);
    expect(row(r, "protein")).toMatchObject({ sub: "No protein target set", flagged: false });
    expect(r.stripMeans).toContain("no daily food targets");
  });
});
