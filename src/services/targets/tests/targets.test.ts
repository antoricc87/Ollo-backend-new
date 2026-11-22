import { computeTargets, inBounds, resolveTarget, sessionsFromFrequency } from "../domain/targets";

describe("profile targets (Nov 22 2026)", () => {
  it("reads how often they train from what onboarding saved", () => {
    expect(sessionsFromFrequency("Moderate exercise 2-3 times/week")).toBe(3);
    expect(sessionsFromFrequency("Hard exercise 3-5 times/week")).toBe(5);
    expect(sessionsFromFrequency("Twice a week")).toBe(2);
    expect(sessionsFromFrequency("Every day")).toBe(7);
    expect(sessionsFromFrequency("Little/no exercise")).toBe(0);
    expect(sessionsFromFrequency("")).toBeNull();
  });

  it("someone who trains 4 days: 1.6 g/kg protein, 7 h sleep, 150 active minutes", () => {
    const t = computeTargets({ weightKg: 76, calories: 2312, trainingDays: 4, exerciseFrequency: null });
    expect(t).toEqual({ calories: 2300, proteinG: 120, sleepMinutes: 420, sessionsPerWeek: 4, activeMinutesWeek: 150 });
  });

  it("someone who barely trains gets 1.2 g/kg, and 3 sessions only when nothing was said", () => {
    expect(computeTargets({ weightKg: 70, calories: 1900, trainingDays: null, exerciseFrequency: "Light exercise 1-2 times/week" })).toMatchObject({ proteinG: 85, sessionsPerWeek: 2 });
    expect(computeTargets({ weightKg: 70, calories: 1900, trainingDays: null, exerciseFrequency: null })).toMatchObject({ proteinG: 110, sessionsPerWeek: 3 });
  });

  it("no weight or no energy estimate → that target is left empty, never guessed", () => {
    expect(computeTargets({ weightKg: null, calories: null, trainingDays: 3, exerciseFrequency: null })).toMatchObject({ calories: null, proteinG: null });
  });

  it("an active plan's target wins; otherwise theirs or the profile's", () => {
    expect(resolveTarget(140, 120, false)).toEqual({ value: 140, from: "plan" });
    expect(resolveTarget(null, 120, true)).toEqual({ value: 120, from: "you" });
    expect(resolveTarget(undefined, 120, false)).toEqual({ value: 120, from: "profile" });
  });

  it("a typo never becomes a target", () => {
    expect(inBounds("calories", 23000)).toBe(false);
    expect(inBounds("sleepMinutes", 480)).toBe(true);
    expect(inBounds("proteinG", Number("abc"))).toBe(false);
  });
});
