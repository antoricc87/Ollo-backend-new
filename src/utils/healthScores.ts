type Metrics = {
  hrv: { date: string; hrv: number }[];
  hrv_baseline: number;
  heart_rate: { date: string; heartRate: number }[];
  heart_rate_baseline: number;
  resting_heart_rate: { date: string; restingHeartRate: number }[];
  resting_heart_rate_baseline: number;
  workouts: {
    activityName: string;
    calories: number;
    distance: number;
    duration: number;
  }[];
  sleep: {
    date: string;
    awakeTime: number;
    coreSleep: number;
    deepSleep: number;
    remSleep: number;
    totalSleep: number;
  }[];
  steps: { date: string; totalSteps: number }[];
  minutes_exercising: { date: string; totalMinutes: number }[];
  totalCaloriesBurned: number;
  totalCaloriesIntake: number;
};

const calculateHealthScore = (
  nutritionScore: number,
  exerciseScore: number,
  sleepScore: number,
  stressScore: number
) => {
  return (
    0.3 * nutritionScore +
    0.3 * exerciseScore +
    0.3 * sleepScore +
    0.1 * stressScore
  );
};

const calculateNutritionScore = (
  macronutrientBalanceScore: number,
  caloricIntakeScore: number,
  dietQualityScore: number
) => {
  return (
    (macronutrientBalanceScore + caloricIntakeScore + dietQualityScore) / 3
  );
};

const calculateExerciseScore = (
  consistencyScore: number,
  weeklyActivityScore: number
) => {
  return (consistencyScore + weeklyActivityScore) / 2;
};

const calculateSleepScore = (
  durationScore: number,
  qualityScore: number,
  consistencyScore: number
) => {
  return 0.4 * durationScore + 0.4 * qualityScore + 0.2 * consistencyScore;
};

const calculateStressScore = (hrvScore: number, restingHRScore: number) => {
  return 0.6 * hrvScore + 0.4 * restingHRScore;
};

// Helper Functions for Nutrition Scores
const calculateMacronutrientBalanceScore = (
  actualCarbPercentage: number,
  targetCarbPercentage: number,
  actualProteinPercentage: number,
  targetProteinPercentage: number,
  actualFatPercentage: number,
  targetFatPercentage: number
) => {
  // Calculate absolute differences
  const carbDiff = Math.abs(actualCarbPercentage - targetCarbPercentage);
  const proteinDiff = Math.abs(
    actualProteinPercentage - targetProteinPercentage
  );
  const fatDiff = Math.abs(actualFatPercentage - targetFatPercentage);

  // Calculate the score based on the average of the differences
  return Math.max(
    0,
    Math.min(100, 100 - (carbDiff + proteinDiff + fatDiff) / 3)
  );
};

const calculateCaloricIntakeScore = (
  actualCalories: number,
  targetCalories: number
) => {
  return Math.max(
    0,
    Math.min(
      100,
      100 - Math.abs((actualCalories - targetCalories) / targetCalories) * 100
    )
  );
};

const calculateDietQualityScore = (
  addedSugarPenalty: number,
  sodiumPenalty: number,
  cholesterolPenalty: number,
  fiberReward: number,
  micronutrientReward: number
) => {
  return Math.max(
    0,
    Math.min(
      100,
      Math.max(
        0,
        Math.min(
          100,
          100 -
            (addedSugarPenalty + sodiumPenalty + cholesterolPenalty) +
            (fiberReward + micronutrientReward)
        )
      )
    )
  );
};

// Function to calculate standard deviation
const stdDev = (values: number[]) => {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(
    values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length
  );
};

export const calculateScores = (
  metrics: Metrics,
  targetCarbPercentage: number,
  targetProteinPercentage: number,
  targetFatPercentage: number,
  actualCarbPercentage: number,
  actualProteinPercentage: number,
  actualFatPercentage: number
) => {
  // Nutrition Score Calculations

  const macronutrientBalanceScore = calculateMacronutrientBalanceScore(
    actualCarbPercentage,
    targetCarbPercentage,
    actualProteinPercentage,
    targetProteinPercentage,
    actualFatPercentage,
    targetFatPercentage
  );

  const caloricIntakeScore = calculateCaloricIntakeScore(
    metrics.totalCaloriesIntake,
    metrics.totalCaloriesBurned
  );

  // Example values for diet quality penalties and rewards
  const addedSugarPenalty = 10;
  const sodiumPenalty = 15;
  const cholesterolPenalty = 5;
  const fiberReward = 10;
  const micronutrientReward = 20;
  const dietQualityScore = calculateDietQualityScore(
    addedSugarPenalty,
    sodiumPenalty,
    cholesterolPenalty,
    fiberReward,
    micronutrientReward
  );

  const nutritionScore = Math.max(
    0,
    Math.min(
      100,
      calculateNutritionScore(
        macronutrientBalanceScore,
        caloricIntakeScore,
        dietQualityScore
      )
    )
  );

  // Exercise Score Calculations
  const consistencyScore =
    (metrics.steps.filter((step) => step.totalSteps >= 10000).length / 7) * 100;
  const weeklyActivityScore = Math.min(
    (metrics.minutes_exercising.reduce(
      (total, item) => total + item.totalMinutes,
      0
    ) /
      150) *
      100,
    100
  );
  const exerciseScore = Math.max(
    0,
    Math.min(100, calculateExerciseScore(consistencyScore, weeklyActivityScore))
  );

  // Sleep Score Calculations
  const averageSleepHours =
    metrics.sleep.reduce((total, sleep) => total + sleep.totalSleep, 0) /
    metrics.sleep.length /
    60;
  const durationScore = 100 - Math.abs((averageSleepHours - 8) / 8) * 100;
  const qualityScore =
    (metrics.sleep.reduce(
      (total, sleep) =>
        total + (sleep.remSleep + sleep.deepSleep) / sleep.totalSleep,
      0
    ) /
      metrics.sleep.length) *
    100;
  const consistencyScoreSleep =
    100 - stdDev(metrics.sleep.map((sleep) => sleep.totalSleep)); // Use the custom stdDev function
  const sleepScore = Math.max(
    0,
    Math.min(
      100,
      calculateSleepScore(durationScore, qualityScore, consistencyScoreSleep)
    )
  );

  // Stress Score Calculations
  const hrvScore =
    (metrics.hrv
      .map((entry) => entry.hrv)
      .reduce((total, hrv) => total + hrv, 0) /
      metrics.hrv.length /
      metrics.hrv_baseline) *
    100;
  const restingHRScore =
    100 -
    (Math.abs(
      metrics.resting_heart_rate
        .map((entry) => entry.restingHeartRate)
        .reduce((total, hr) => total + hr, 0) /
        metrics.resting_heart_rate.length -
        metrics.resting_heart_rate_baseline
    ) /
      metrics.resting_heart_rate_baseline) *
      100;
  const stressScore = Math.max(
    0,
    Math.min(100, calculateStressScore(hrvScore, restingHRScore))
  );

  // Health Score Calculation
  const healthScore = Math.max(
    0,
    Math.min(
      100,
      calculateHealthScore(
        nutritionScore,
        exerciseScore,
        sleepScore,
        stressScore
      )
    )
  );

  return {
    healthScore,
    nutritionScore,
    exerciseScore,
    sleepScore,
    stressScore,
    macronutrientBalanceScore,
    caloricIntakeScore,
    dietQualityScore,
    consistencyScore,
    weeklyActivityScore,
    durationScore,
    qualityScore,
    consistencyScoreSleep,
    hrvScore,
    restingHRScore,
  };
};
