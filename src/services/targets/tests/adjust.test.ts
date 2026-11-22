import { checkAdjusted, flagsFrom, prepareBase } from "../domain/adjust";
import { TARGET_KEYS, type TargetKey, type Targets } from "../domain/targets";

const base: Targets = { calories: 2400, proteinG: 115, sleepMinutes: 420, sessionsPerWeek: 3, activeMinutesWeek: 150 };
const why = Object.fromEntries(TARGET_KEYS.map((k) => [k, `base ${k}`])) as Record<TargetKey, string>;
const none = { kidney: false, pregnant: false, eatingDisorder: false };
const p = (o: Partial<Record<TargetKey, number>>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { value: v, why: `model ${k}` }]));

describe("the code checks on Ollie's targets", () => {
  it("reads the risky cases from the record, not from the model", () => {
    expect(flagsFrom("Chronic kidney disease stage 3")).toMatchObject({ kidney: true });
    expect(flagsFrom("Pregnant, 22 weeks")).toMatchObject({ pregnant: true });
    expect(flagsFrom("She is not pregnant")).toMatchObject({ pregnant: false });
    expect(flagsFrom("History of anorexia in her teens")).toMatchObject({ eatingDisorder: true });
  });

  it("keeps a sensible adjustment and its reason", () => {
    const r = checkAdjusted(base, p({ calories: 2000 }), why, { weightKg: 92, heightCm: 175 }, none); // BMI 30
    expect(r.targets.calories).toBe(2000);
    expect(r.why.calories).toBe("model calories");
    expect(r.violations).toEqual([]);
  });

  it("pulls a crash diet back to 75% of the estimate and never under 1,200", () => {
    const r = checkAdjusted(base, p({ calories: 1000 }), why, { weightKg: 92, heightCm: 175 }, none);
    expect(r.targets.calories).toBe(1800);
    expect(r.violations[0]).toMatchObject({ key: "calories", rule: "±25% of the estimate" });
  });

  it("kidney disease caps protein at 0.8 g/kg; pregnancy and eating-disorder history forbid a deficit", () => {
    const ckd = checkAdjusted(base, p({ proteinG: 115 }), why, { weightKg: 72, heightCm: 175 }, { ...none, kidney: true });
    expect(ckd.targets.proteinG).toBe(55);
    expect(ckd.why.proteinG).toBe("Kidney disease: at most 0.8 g per kg");
    expect(checkAdjusted(base, p({ calories: 2100 }), why, { weightKg: 72, heightCm: 175 }, { ...none, pregnant: true }).targets.calories).toBe(2400);
    expect(checkAdjusted(base, p({ calories: 2100 }), why, { weightKg: 72, heightCm: 175 }, { ...none, eatingDisorder: true }).targets.calories).toBe(2400);
  });

  it("BMI under 22: no deficit; 22–25: at most 250 under; pregnancy weeks add energy before Ollie sees it", () => {
    expect(checkAdjusted(base, p({ calories: 2000 }), why, { weightKg: 55, heightCm: 166 }, none).targets.calories).toBe(2400);
    expect(checkAdjusted(base, p({ calories: 2000 }), why, { weightKg: 72, heightCm: 175 }, none).targets.calories).toBe(2150);
    expect(prepareBase(base, why, flagsFrom("Pregnant, 31 weeks")).base.calories).toBe(2850);
    expect(prepareBase(base, why, flagsFrom("pregnant, second trimester")).base.calories).toBe(2740);
    expect(prepareBase(base, why, flagsFrom("pregnant, 8 weeks")).base.calories).toBe(2400);
  });

  it("workouts never below what they already do", () => {
    expect(checkAdjusted(base, p({ sessionsPerWeek: 1 }), why, { weightKg: 72, heightCm: 175 }, none).targets.sessionsPerWeek).toBe(3);
  });

  it("sleep never under 7 h; nothing invented where the formula had no number", () => {
    expect(checkAdjusted(base, p({ sleepMinutes: 360 }), why, { weightKg: 72, heightCm: 175 }, none).targets.sleepMinutes).toBe(420);
    expect(checkAdjusted({ ...base, proteinG: null }, p({ proteinG: 120 }), why, { weightKg: null, heightCm: null }, none).targets.proteinG).toBeNull();
  });
});
