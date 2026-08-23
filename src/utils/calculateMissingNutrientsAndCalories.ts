export const generateNutrientValues = (scale: number, missingDays: number) => {
  const baseNutrientValues = {
    carbohydrates: 50,
    proteins: 30,
    fats: 20,
    fiber: 25,
    sodium: 1500,
    naturalSugar: 20,
    addedSugar: 15,
    calcium: 800,
    magnesium: 300,
    iron: 18,
    potassium: 4700,
    omega_3: 1.5,
    cholesterol: 300,
    zinc: 11,
    vitaminD: 800,
    vitaminB12: 2.4,
    vitaminC: 90,
    vitaminE: 15,
  };

  const scaleModifiers = {
    1: {
      carbohydrates: 60,
      proteins: 20,
      fats: 30,
      fiber: 10,
      sodium: 4000,
      addedSugar: 40,
      calories: 2500,
    },
    2: {
      carbohydrates: 55,
      proteins: 25,
      fats: 28,
      fiber: 15,
      sodium: 3000,
      addedSugar: 35,
      calories: 2200,
    },
    3: {
      carbohydrates: 50,
      proteins: 30,
      fats: 20,
      fiber: 25,
      sodium: 1500,
      addedSugar: 20,
      calories: 2000,
    },
    4: {
      carbohydrates: 45,
      proteins: 35,
      fats: 15,
      fiber: 30,
      sodium: 1200,
      addedSugar: 10,
      calories: 1800,
    },
    5: {
      carbohydrates: 40,
      proteins: 40,
      fats: 15,
      fiber: 35,
      sodium: 1000,
      addedSugar: 5,
      calories: 1600,
    },
  };

  const selectedModifiers = scaleModifiers[scale];
  const finalValues = { ...baseNutrientValues };

  // Add the scale modifiers to base values
  for (let key in baseNutrientValues) {
    finalValues[key] = baseNutrientValues[key] + (selectedModifiers[key] || 0);
  }

  // Adjust for the missing days: Multiply only the nutrient values
  const adjustedValues = {};
  Object.keys(finalValues).forEach((key) => {
    if (key !== "calories") {
      adjustedValues[key] = finalValues[key] * missingDays;
    }
  });

  // Handle calories separately
  const adjustedCalories = selectedModifiers.calories * missingDays;

  return {
    nutrients: adjustedValues,
    calories: adjustedCalories,
  };
};
