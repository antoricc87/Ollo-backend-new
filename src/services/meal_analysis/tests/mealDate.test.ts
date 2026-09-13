import { dayLabel, resolveMealDate } from "../mealDate";

// 2026-08-26 is a Wednesday.
const TODAY = "2026-08-26";
const TZ = "Europe/Rome";
const r = (p: string | null | undefined) => resolveMealDate(p, TODAY, TZ);

describe("resolveMealDate", () => {
  test("empty / today words", () => {
    expect(r(null).date).toBe(TODAY);
    expect(r("today").date).toBe(TODAY);
    expect(r("tonight").date).toBe(TODAY);
    expect(r("this morning").date).toBe(TODAY);
  });
  test("yesterday and variants", () => {
    expect(r("yesterday").date).toBe("2026-08-25");
    expect(r("yesterday morning").date).toBe("2026-08-25");
    expect(r("last night").date).toBe("2026-08-25");
    expect(r("yesterday's lunch").date).toBe("2026-08-25");
    expect(r("the day before yesterday").date).toBe("2026-08-24");
  });
  test("N days ago", () => {
    expect(r("2 days ago").date).toBe("2026-08-24");
    expect(r("three days ago").date).toBe("2026-08-23");
    expect(r("a couple of days ago").date).toBe("2026-08-24");
    expect(r("30 days ago").unresolved).toBe(true);
  });
  test("weekday names resolve to the most recent occurrence", () => {
    expect(r("Monday").date).toBe("2026-08-24");
    expect(r("on Tuesday").date).toBe("2026-08-25");
    expect(r("Wednesday").date).toBe(TODAY);
    expect(r("Thursday").date).toBe("2026-08-20");
    expect(r("last Friday").date).toBe("2026-08-21");
    expect(r("Sat dinner").date).toBe("2026-08-22");
    expect(r("Sunday night").date).toBe("2026-08-23");
  });
  test("'last <today's weekday>' is a week ago, not today", () => {
    expect(r("last Wednesday").date).toBe("2026-08-19");
    expect(r("this Wednesday").date).toBe(TODAY);
  });
  test("ISO dates", () => {
    expect(r("2026-08-20").date).toBe("2026-08-20");
    expect(r("2026-08-20T00:00:00Z").date).toBe("2026-08-20");
    expect(r("2026-09-01").unresolved).toBe(true); // future
  });
  test("calendar dates without a year resolve to the latest past occurrence", () => {
    expect(r("the 20th").date).toBe("2026-08-20");
    expect(r("on the 2nd").date).toBe("2026-08-02");
    expect(r("the 28th").date).toBe("2026-07-28"); // Aug 28 is still ahead
    expect(r("31st").date).toBe("2026-07-31");
    expect(r("Aug 20").date).toBe("2026-08-20");
    expect(r("20 August").date).toBe("2026-08-20");
    expect(r("Thursday the 20th").date).toBe("2026-08-20");
    expect(r("Tue 25 Aug").date).toBe("2026-08-25");
    expect(r("dinner on the 24th of August").date).toBe("2026-08-24");
    expect(r("September 2nd").date).toBe("2025-09-02");
  });
  test("calendar dates that disagree or are really clock times", () => {
    expect(r("Friday the 20th").unresolved).toBe(true);
    expect(r("at 8").unresolved).toBe(true);
    expect(r("the 32nd").unresolved).toBe(true);
  });
  test("vague phrases are held back", () => {
    for (const p of ["the other day", "last week", "the weekend", "a few days ago", "recently", "sometime this week"]) {
      expect(r(p).unresolved).toBe(true);
    }
  });
  test("dayLabel", () => {
    expect(dayLabel(TODAY, TODAY, TZ)).toBe("Today");
    expect(dayLabel("2026-08-25", TODAY, TZ)).toBe("Yesterday");
    expect(dayLabel("2026-08-24", TODAY, TZ)).toBe("Mon 24 Aug");
  });
});
