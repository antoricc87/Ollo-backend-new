export function calculateCaloricAdjustment(goal, tdee, sex, weight, pace) {
  // ✅ Normalize goal (case-insensitive, trim spaces)
  let normalizedGoal = goal.trim().toLowerCase();

  // ✅ If goal is "Lose X kg" or "Lose X lb", convert to "Lose Weight"
  if (/^Lose \d+\s?(kg|lb)$/i.test(normalizedGoal)) {
    normalizedGoal = "lose weight";
  }

  const weightLossPaces = {
    slow: 250,
    moderate: 500,
    aggressive: 750,
  };

  // Target weekly body fat percentage loss
  const bodyRecompPercentages = {
    slow: 0.0025, // 0.25% per week
    moderate: 0.005, // 0.5% per week
    aggressive: 0.0075, // 0.75% per week
  };

  // Estimated body fat percentages based on sex (using average values)
  const estimatedBodyFat = {
    male: 0.2, // 20% for males
    female: 0.25, // 25% for females
  };

  let weightLossFactor = 1.0;
  if (weight > 100) weightLossFactor = 1.2;
  else if (weight < 60) weightLossFactor = 0.8;

  if (normalizedGoal === "lose weight") {
    const deficit = (weightLossPaces[pace] || 500) * weightLossFactor;
    return Math.round(tdee - deficit);
  } else if (normalizedGoal === "lose fat") {
    const deficit = 300 * weightLossFactor;
    return Math.round(tdee - deficit);
  } else if (normalizedGoal === "body recomposition") {
    // Calculate fat mass based on estimated body fat percentage
    const bodyFatPercentage = estimatedBodyFat[sex.toLowerCase()] || 0.2;
    const fatMass = weight * bodyFatPercentage;

    // Calculate target weekly fat loss in kg
    const targetPercentage = bodyRecompPercentages[pace] || 0.005;
    const weeklyFatLoss = fatMass * targetPercentage;

    // Convert weekly fat loss to daily caloric deficit
    // 1kg of fat ≈ 7700 calories
    const dailyDeficit = Math.round((weeklyFatLoss * 7700) / 7);

    // Apply weight factor and ensure deficit stays within reasonable limits
    const adjustedDeficit = Math.min(
      Math.max(dailyDeficit * weightLossFactor, 150),
      500
    );

    return Math.round(tdee - adjustedDeficit);
  } else if (normalizedGoal === "recomposition (lose fat & gain muscle)") {
    return Math.round(tdee - 100);
  } else if (normalizedGoal === "gain muscle") {
    const surplus = sex === "male" ? 250 : 200;
    return Math.round(tdee + surplus);
  } else if (normalizedGoal === "maintain weight") {
    return Math.round(tdee);
  } else {
    console.error("❌ Invalid goal received:", goal);
    throw new Error("Invalid goal");
  }
}
