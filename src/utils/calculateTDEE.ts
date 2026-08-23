


export function calculateTDEE(weight, height, age, gender, exerciseFrequency) {
    const baseTDEE =
      gender === "male"
        ? 10 * weight + 6.25 * height - 5 * age + 5
        : 10 * weight + 6.25 * height - 5 * age - 161;
  
    const activityFactors = {
      "Never": 1.2,
      "Once a week": 1.375,
      "Twice a week": 1.375,
      "Three times a week": 1.55,
      "Four times a week": 1.55,
      "Five times a week": 1.725,
      "Six times a week": 1.725,
      "Every day": 1.9,
    };
  
    const activityLevel = activityFactors[exerciseFrequency] || 1.2;
  
    return baseTDEE * activityLevel;
  }
  