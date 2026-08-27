/**
 * Mifflin-St Jeor TDEE. `exerciseFrequency` is the free-text value stored in
 * ExerciseSummary.frequency; three vocabularies exist in the data (legacy
 * onboarding, the "Your body" editor, onboarding Set 02) so all are mapped.
 */
export function calculateTDEE(weight, height, age, gender, exerciseFrequency) {
  const baseTDEE =
    (gender || "").toLowerCase() === "male"
      ? 10 * weight + 6.25 * height - 5 * age + 5
      : 10 * weight + 6.25 * height - 5 * age - 161;

  const activityFactors = {
    // legacy onboarding (patientexercise)
    Never: 1.2,
    "Once a week": 1.375,
    "Twice a week": 1.375,
    "Three times a week": 1.55,
    "Four times a week": 1.55,
    "Five times a week": 1.725,
    "Six times a week": 1.725,
    "Every day": 1.9,
    // "Your body" editor + onboarding Set 02 (canonical going forward)
    "Little/no exercise": 1.2,
    "Light exercise 1-2 times/week": 1.375,
    "Moderate exercise 2-3 times/week": 1.55,
    "Hard exercise 3-5 times/week": 1.725,
    "Hard exercise 6-7 times/week": 1.9,
    "Professional athlete": 2.1,
    // Set 02 labels written before Aug 27 2026
    "Mostly sedentary": 1.2,
    "Lightly active": 1.375,
    Active: 1.55,
    "Very active": 1.725,
  };

  const activityLevel = activityFactors[exerciseFrequency] || 1.2;

  return baseTDEE * activityLevel;
}
