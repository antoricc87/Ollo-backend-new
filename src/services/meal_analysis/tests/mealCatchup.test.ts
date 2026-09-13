import { buildMealPreview, entrySource, fillDates, FILL_MAX_DAYS, MEAL_ORDER, planFills, type BatchMeal, type UsualDay } from "../mealBatch";
import { computeLoggingGaps } from "../loggingGaps";

// 2026-09-12 is a Saturday.
const TODAY = "2026-09-12";
const TZ = "Europe/Rome";

const ing = (name: string, grams: number, kcal: number) =>
  ({ name, quantity: 1, unit: "g", grams, gramsBase: grams, gramsLow: grams * 0.8, gramsHigh: grams * 1.3, calories: kcal, nutrients: { proteins: 10, carbohydrates: 20, fats: 5 }, portionSource: "standard_serving" } as any);

const analysed = (mealType: string, name: string, kcal: number) =>
  ({ mealName: name, mealType, mealDate: "today", glycemicLoad: 0, ingredients: [ing(name, 200, kcal)] } as any);

const usual = (on: UsualDay["on"], meals = [analysed("BREAKFAST", "Oats", 350), analysed("LUNCH", "Sandwich", 600), analysed("DINNER", "Pasta", 750)]): UsualDay => ({
  on,
  portion: "normal",
  meals,
});

const described = (date: string, mealType: string): BatchMeal =>
  ({ ...analysed(mealType, "Sushi", 900), date, datePhrase: date, included: true, duplicateOf: null, portion: "normal" } as BatchMeal);

describe("fillDates", () => {
  test("every day in the window, inclusive", () => {
    expect(fillDates("2026-09-01", "2026-09-03", TODAY)).toEqual(["2026-09-01", "2026-09-02", "2026-09-03"]);
  });
  test("never today or later, never longer than the cap", () => {
    expect(fillDates("2026-09-11", "2026-09-20", TODAY)).toEqual(["2026-09-11"]);
    expect(fillDates("2026-09-12", "2026-09-12", TODAY)).toEqual([]);
    const long = fillDates("2026-07-01", "2026-09-11", TODAY);
    expect(long).toHaveLength(FILL_MAX_DAYS);
    expect(long[long.length - 1]).toBe("2026-09-11");
  });
});

describe("planFills", () => {
  const dates = fillDates("2026-09-07", "2026-09-09", TODAY); // Mon–Wed

  test("fills every empty slot with the usual day, tagged usual_day", () => {
    const fills = planFills([usual("all")], dates, {}, []);
    expect(fills).toHaveLength(9);
    expect(fills.every((f) => f.source === "usual_day" && f.included)).toBe(true);
    expect(fills.filter((f) => f.date === "2026-09-08").map((f) => f.mealType)).toEqual(["BREAKFAST", "LUNCH", "DINNER"]);
  });

  test("described meals and logged meals keep their slots", () => {
    const fills = planFills([usual("all")], dates, { "2026-09-07": [{ mealType: "BREAKFAST", description: "Eggs", calories: 300 }] }, [described("2026-09-08", "DINNER")]);
    expect(fills.filter((f) => f.date === "2026-09-07").map((f) => f.mealType)).toEqual(["LUNCH", "DINNER"]);
    expect(fills.filter((f) => f.date === "2026-09-08").map((f) => f.mealType)).toEqual(["BREAKFAST", "LUNCH"]);
    expect(fills.filter((f) => f.date === "2026-09-09")).toHaveLength(3);
  });

  test("a day with an untyped legacy entry is left alone", () => {
    const fills = planFills([usual("all")], dates, { "2026-09-07": [{ mealType: null, description: "Food", calories: 1800 }] }, []);
    expect(fills.some((f) => f.date === "2026-09-07")).toBe(false);
  });

  test("a weekend pattern beats all on Sat/Sun only", () => {
    const weekend = usual("weekends", [analysed("LUNCH", "Pizza", 1100)]);
    const fills = planFills([usual("all"), weekend], fillDates("2026-09-05", "2026-09-07", TODAY), {}, []); // Sat, Sun, Mon
    expect(fills.filter((f) => f.date === "2026-09-05").map((f) => f.mealName)).toEqual(["Pizza"]);
    expect(fills.filter((f) => f.date === "2026-09-06").map((f) => f.mealName)).toEqual(["Pizza"]);
    expect(fills.filter((f) => f.date === "2026-09-07").map((f) => f.mealName)).toEqual(["Oats", "Sandwich", "Pasta"]);
  });

  test("weekday pattern alone leaves weekends empty", () => {
    const fills = planFills([usual("weekdays")], fillDates("2026-09-05", "2026-09-07", TODAY), {}, []);
    expect([...new Set(fills.map((f) => f.date))]).toEqual(["2026-09-07"]);
  });

  test("copies do not share ingredient objects", () => {
    const fills = planFills([usual("all")], dates, {}, []);
    fills[0].ingredients[0].nutrients.proteins = 999;
    fills[0].ingredients[0].grams = 1;
    expect(fills[3].ingredients[0].nutrients.proteins).toBe(10);
    expect(fills[3].ingredients[0].grams).toBe(200);
  });

  test("the preview folds whole usual days and flags their rows", () => {
    const fills = planFills([usual("all")], dates, {}, [described("2026-09-08", "DINNER")]);
    // Sorted the way log_meal sorts before building the preview.
    const meals = [described("2026-09-08", "DINNER"), ...fills].sort((a, b) => (a.date === b.date ? MEAL_ORDER[a.mealType] - MEAL_ORDER[b.mealType] : a.date < b.date ? -1 : 1));
    const preview = buildMealPreview(meals, { today: TODAY, timeZone: TZ, subject: "you", subjectId: "p1", model: "t", heldBack: [] });
    expect(preview.days.map((d) => d.usual)).toEqual([true, false, true]);
    expect(preview.days[1].meals.map((m) => m.usual)).toEqual([true, true, false]);
  });
});

describe("entrySource", () => {
  test("usual days stay usual; described meals are recall from two days back", () => {
    expect(entrySource({ date: "2026-09-12", source: "usual_day" }, TODAY)).toBe("usual_day");
    expect(entrySource({ date: "2026-09-12", source: null }, TODAY)).toBeNull();
    expect(entrySource({ date: "2026-09-11" }, TODAY)).toBeNull();
    expect(entrySource({ date: "2026-09-10" }, TODAY)).toBe("recall");
  });
});

describe("computeLoggingGaps", () => {
  test("empty runs, part-logged days and the fill window", () => {
    const gaps = computeLoggingGaps(
      [
        { date: "2026-09-01", mealTypes: ["BREAKFAST", "LUNCH", "DINNER"] },
        { date: "2026-09-04", mealTypes: ["LUNCH"] },
        { date: "2026-09-05", mealTypes: [] },
        { date: "2026-09-08", mealTypes: ["BREAKFAST", "DINNER"] },
      ],
      "2026-09-01",
      "2026-09-11",
      TODAY,
      TZ
    );
    expect(gaps.loggedDays).toBe(3);
    expect(gaps.empty.map((e) => e.date)).toEqual(["2026-09-02", "2026-09-03", "2026-09-05", "2026-09-06", "2026-09-07", "2026-09-09", "2026-09-10", "2026-09-11"]);
    expect(gaps.emptyRuns.map((r) => r.text)).toEqual(["Wed 2 Sep → Thu 3 Sep (2 days)", "Sat 5 Sep → Mon 7 Sep (3 days)", "Wed 9 Sep → Yesterday (3 days)"]);
    expect(gaps.partial).toEqual([{ date: "2026-09-04", label: "Fri 4 Sep", logged: ["lunch"], missing: ["breakfast", "dinner"] }]);
    expect(gaps.fillWindow).toEqual({ from: "2026-09-02", to: "2026-09-11" });
  });

  test("nothing missing → no fill window", () => {
    const gaps = computeLoggingGaps([{ date: "2026-09-10", mealTypes: ["LUNCH", "DINNER"] }, { date: "2026-09-11", mealTypes: ["BREAKFAST", "LUNCH"] }], "2026-09-10", "2026-09-11", TODAY, TZ);
    expect(gaps.fillWindow).toBeNull();
    expect(gaps.emptyRuns).toEqual([]);
  });
});
