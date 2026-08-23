import moment from "moment";
import NutrientsService from "../../services/nutrition/model/nutrition.model";
import {
  getCurrentWeekRange,
  getPreviousWeekRange,
} from "../../utils/formatDate";

interface NutritionOverview {
  currentWeek: {
    macros: {
      carbohydrates: number;
      proteins: number;
      fats: number;
      calories: number;
    };
    macroPercentages: {
      carbs: number;
      proteins: number;
      fats: number;
    };
    servings: {
      vegetables: number;
      fruits: number;
    };
    processedFoods: number;
    fiber: number;
    sodium: number;
    naturalSugar: number;
    addedSugar: number;
    iron: number;
    zinc: number;
    calcium: number;
  };
  previousWeek: {
    macros: {
      carbohydrates: number;
      proteins: number;
      fats: number;
      calories: number;
    };
    macroPercentages: {
      carbs: number;
      proteins: number;
      fats: number;
    };
    servings: {
      vegetables: number;
      fruits: number;
    };
    processedFoods: number;
    fiber: number;
    sodium: number;
    naturalSugar: number;
    addedSugar: number;
    iron: number;
    zinc: number;
    calcium: number;
  };
  averageWeekly: {
    macros: {
      carbohydrates: number;
      proteins: number;
      fats: number;
      calories: number;
    };
    macroPercentages: {
      carbs: number;
      proteins: number;
      fats: number;
    };
    servings: {
      vegetables: number;
      fruits: number;
    };
    processedFoods: number;
    fiber: number;
    sodium: number;
    naturalSugar: number;
    addedSugar: number;
    iron: number;
    zinc: number;
    calcium: number;
  };
  trends: {
    macroTrends: {
      carbs: "increasing" | "decreasing" | "stable";
      proteins: "increasing" | "decreasing" | "stable";
      fats: "increasing" | "decreasing" | "stable";
    };
    servingTrends: {
      vegetables: "increasing" | "decreasing" | "stable";
      fruits: "increasing" | "decreasing" | "stable";
    };
    processedFoodTrend: "increasing" | "decreasing" | "stable";
  };
  weekRange: {
    current: { start: Date; end: Date };
    previous: { start: Date; end: Date };
  };
  dietBalanceScore: number;
  improvementAreas: string[];
  recommendedValues: {
    fruits: { minimum: number; maximum: number };
    vegetables: { minimum: number; maximum: number };
    processedFoods: { minimum: number; maximum: number };
  };
}

// 🔹 Age-based guidelines (simplified from USDA & AAP)
const guidelines = {
  macros: {
    "1-3": { carbs: [45, 65], protein: [5, 20], fat: [30, 40] },
    "4-18": { carbs: [45, 65], protein: [10, 30], fat: [25, 35] },
  },
  fiber: {
    "1-3": 10, // grams/day
    "4-8": 14,
    "9-13": 19,
    "14-18": 26,
  },
  sodium: {
    "1-3": 1200,
    "4-8": 1500,
    "9-13": 1800,
    "14-18": 2300,
  },
  fruits: {
    "4-8": 1.5,
    "9-13": 2,
    "14-18": 2,
  },
  vegetables: {
    "4-8": 1.5,
    "9-13": 2.5,
    "14-18": 3,
  },
  iron: {
    "1-3": 7, // mg/day
    "4-8": 10,
    "9-13": 8,
    "14-18": 11, // males 11, females 15 (using 11 as average)
  },
  zinc: {
    "1-3": 3, // mg/day
    "4-8": 5,
    "9-13": 8,
    "14-18": 11, // males 11, females 9 (using 10 as average)
  },
  calcium: {
    "1-3": 700, // mg/day
    "4-8": 1000,
    "9-13": 1300,
    "14-18": 1300,
  },
};

// 🔹 Utility: pick age bracket
const getAgeBracket = (age: number): string => {
  if (age <= 3) return "1-3";
  if (age <= 8) return "4-8";
  if (age <= 13) return "9-13";
  return "14-18";
};

// 🔹 Diet scoring + improvements
const calculateDietScoreAndImprovements = (
  overview: NutritionOverview["currentWeek"],
  age: number
) => {
  const improvements: string[] = [];
  let score = 0;
  const bracket = getAgeBracket(age);

  // Check if there's no nutrition data logged for the week
  const hasNoData =
    overview.macros.calories === 0 &&
    overview.macros.carbohydrates === 0 &&
    overview.macros.proteins === 0 &&
    overview.macros.fats === 0;

  if (hasNoData) {
    improvements.push(
      "Hi there! 👋 It looks like you haven't logged any meals for your child this week yet. Start tracking your child's nutrition with Ollie to get personalized insights and recommendations! Just tell Ollie what your child ate and we'll help you keep track of their healthy eating journey. 🥗✨"
    );
    return { score: 0, improvements };
  }

  // Helper function to calculate tiered score (0-8.33 points per category for 100 total)
  const calculateTieredScore = (
    value: number,
    optimalMin: number,
    optimalMax: number,
    categoryName: string,
    unit: string = ""
  ): number => {
    const range = optimalMax - optimalMin;

    // Handle edge case where range is 0 (e.g., when calories are 0)
    if (range === 0) {
      if (value === optimalMin) {
        return 100 / 12; // Optimal (exact match)
      } else {
        improvements.push(
          `${categoryName} is very low (${value}${unit}). Target: ${optimalMin.toFixed(
            1
          )}-${optimalMax.toFixed(1)}${unit}.`
        );
        return 50 / 12; // Very low (any deviation from 0 range)
      }
    }

    const lowThreshold = optimalMin - range * 0.5;
    const veryLowThreshold = optimalMin - range;
    const highThreshold = optimalMax + range * 0.5;
    const veryHighThreshold = optimalMax + range;

    if (value >= optimalMin && value <= optimalMax) {
      return 100 / 12; // Optimal range
    } else if (value >= lowThreshold && value < optimalMin) {
      improvements.push(
        `Great start with ${categoryName.toLowerCase()}! You're at ${value}${unit} - let's aim for ${optimalMin.toFixed(
          1
        )}-${optimalMax.toFixed(
          1
        )}${unit} to give your child the best nutrition.`
      );
      return 75 / 12; // Low
    } else if (value < veryLowThreshold) {
      improvements.push(
        `Let's boost those ${categoryName.toLowerCase()}! Currently at ${value}${unit} - reaching ${optimalMin.toFixed(
          1
        )}-${optimalMax.toFixed(1)}${unit} will help your child thrive.`
      );
      return 50 / 12; // Very low
    } else if (value > optimalMax && value <= highThreshold) {
      improvements.push(
        `Nice work on ${categoryName.toLowerCase()}! You're at ${value}${unit} - a little adjustment to ${optimalMin.toFixed(
          1
        )}-${optimalMax.toFixed(1)}${unit} would be perfect.`
      );
      return 75 / 12; // High
    } else {
      improvements.push(
        `You're doing great with ${categoryName.toLowerCase()}! At ${value}${unit}, consider balancing towards ${optimalMin.toFixed(
          1
        )}-${optimalMax.toFixed(1)}${unit} for optimal nutrition.`
      );
      return 50 / 12; // Very high
    }
  };

  // Macros balance (3 categories × 8.33 points each = 25 points)
  const macroRanges =
    age <= 3 ? guidelines.macros["1-3"] : guidelines.macros["4-18"];
  const { carbs, proteins, fats } = overview.macroPercentages;

  score += calculateTieredScore(
    carbs,
    macroRanges.carbs[0],
    macroRanges.carbs[1],
    "Carbohydrates",
    "%"
  );
  score += calculateTieredScore(
    proteins,
    macroRanges.protein[0],
    macroRanges.protein[1],
    "Protein",
    "%"
  );
  score += calculateTieredScore(
    fats,
    macroRanges.fat[0],
    macroRanges.fat[1],
    "Fat",
    "%"
  );

  // Added sugar (8.33 points)
  const sugarLimit = (overview.macros.calories * 0.1) / 4; // grams
  const sugarOptimal = sugarLimit * 0.5; // 5% of calories
  score += calculateTieredScore(
    overview.addedSugar,
    0,
    sugarOptimal,
    "Added sugar",
    "g"
  );

  // Sodium (8.33 points) - lower is better
  const dailySodiumLimit =
    guidelines.sodium[bracket as keyof typeof guidelines.sodium];
  const sodiumLimit = dailySodiumLimit * 7; // Convert daily to weekly
  const sodiumOptimal = sodiumLimit * 0.7; // 70% of weekly limit
  if (overview.sodium <= sodiumOptimal) {
    score += 100 / 12; // Optimal
  } else if (overview.sodium <= sodiumLimit) {
    improvements.push(
      `You're doing well with sodium! At ${overview.sodium.toFixed(
        1
      )}mg this week, you're close to the ideal range of below ${sodiumOptimal.toFixed(
        1
      )}mg per week (below ${(dailySodiumLimit * 0.7).toFixed(1)}mg daily).`
    );
    score += 75 / 12; // High but acceptable
  } else {
    improvements.push(
      `Let's work together on sodium! Currently at ${overview.sodium.toFixed(
        1
      )}mg this week - aiming for below ${sodiumLimit}mg per week (below ${dailySodiumLimit}mg daily) will help your child's health.`
    );
    score += 50 / 12; // Very high
  }

  // Fiber (8.33 points) - higher is better
  const dailyFiberTarget =
    guidelines.fiber[bracket as keyof typeof guidelines.fiber];
  const fiberTarget = dailyFiberTarget * 7; // Convert daily to weekly
  const fiberOptimal = fiberTarget * 1.2; // 120% of weekly target
  if (overview.fiber >= fiberTarget) {
    score += 100 / 12; // Optimal or better
  } else if (overview.fiber >= fiberTarget * 0.7) {
    improvements.push(
      `Great progress with fiber! You're at ${overview.fiber.toFixed(
        1
      )}g this week - let's aim for ${fiberTarget}g per week (${dailyFiberTarget}g daily) to keep your child's digestion healthy.`
    );
    score += 75 / 12; // Low
  } else {
    improvements.push(
      `Let's boost that fiber! Currently at ${overview.fiber.toFixed(
        1
      )}g this week - reaching ${fiberTarget}g per week (${dailyFiberTarget}g daily) will help your child's digestive health.`
    );
    score += 50 / 12; // Very low
  }

  // Fruits (8.33 points) - higher is better
  const dailyFruitTarget =
    guidelines.fruits[bracket as keyof typeof guidelines.fruits] || 1.5;
  const fruitTarget = dailyFruitTarget * 7; // Convert daily to weekly
  const fruitOptimal = fruitTarget * 1.2; // 120% of weekly target
  if (overview.servings.fruits >= fruitTarget) {
    score += 100 / 12; // Optimal or better
  } else if (overview.servings.fruits >= fruitTarget * 0.5) {
    improvements.push(
      `Nice work with fruits! You're at ${overview.servings.fruits.toFixed(
        1
      )} cups this week - let's aim for ${fruitTarget} cups per week (${dailyFruitTarget} cups daily) to give your child those important vitamins.`
    );
    score += 75 / 12; // Low
  } else {
    improvements.push(
      `Let's add more colorful fruits! Currently at ${overview.servings.fruits.toFixed(
        1
      )} cups this week - reaching ${fruitTarget} cups per week (${dailyFruitTarget} cups daily) will boost your child's nutrition.`
    );
    score += 50 / 12; // Very low
  }

  // Vegetables (8.33 points) - higher is better
  const dailyVegTarget =
    guidelines.vegetables[bracket as keyof typeof guidelines.vegetables] || 1.5;
  const vegTarget = dailyVegTarget * 7; // Convert daily to weekly
  const vegOptimal = vegTarget * 1.2; // 120% of weekly target
  if (overview.servings.vegetables >= vegTarget) {
    score += 100 / 12; // Optimal or better
  } else if (overview.servings.vegetables >= vegTarget * 0.5) {
    improvements.push(
      `Great start with vegetables! You're at ${overview.servings.vegetables.toFixed(
        1
      )} cups this week - let's aim for ${vegTarget} cups per week (${dailyVegTarget} cups daily) to fuel your child's growth.`
    );
    score += 75 / 12; // Low
  } else {
    improvements.push(
      `Let's add more veggies to the mix! Currently at ${overview.servings.vegetables.toFixed(
        1
      )} cups this week - reaching ${vegTarget} cups per week (${dailyVegTarget} cups daily) will help your child grow strong and healthy.`
    );
    score += 50 / 12; // Very low
  }

  // Processed foods (8.33 points) - lower is better
  const weeklyProcessedTarget = 14; // 2 servings per day × 7 days
  if (overview.processedFoods <= 14) {
    score += 100 / 12; // Optimal
  } else if (overview.processedFoods <= 28) {
    improvements.push(
      `You're doing well with processed foods! At ${overview.processedFoods} servings this week, you're close to the ideal range of ≤${weeklyProcessedTarget} servings per week (≤2 servings daily).`
    );
    score += 75 / 12; // High but acceptable
  } else {
    improvements.push(
      `Let's work together on processed foods! Currently at ${overview.processedFoods} servings this week - aiming for ≤${weeklyProcessedTarget} servings per week (≤2 servings daily) will help your child's overall health.`
    );
    score += 50 / 12; // Very high
  }

  // Iron (8.33 points) - higher is better
  const dailyIronTarget =
    guidelines.iron[bracket as keyof typeof guidelines.iron];
  const ironTarget = dailyIronTarget * 7; // Convert daily to weekly
  const ironOptimal = ironTarget * 1.2; // 120% of weekly target
  if (overview.iron >= ironTarget) {
    score += 100 / 12; // Optimal or better
  } else if (overview.iron >= ironTarget * 0.7) {
    improvements.push(
      `Great progress with iron! You're at ${overview.iron.toFixed(
        1
      )}mg this week - let's aim for ${ironTarget}mg per week (${dailyIronTarget}mg daily) to keep your child's energy up.`
    );
    score += 75 / 12; // Low
  } else {
    improvements.push(
      `Let's boost that iron! Currently at ${overview.iron.toFixed(
        1
      )}mg this week - reaching ${ironTarget}mg per week (${dailyIronTarget}mg daily) will help your child stay strong and energetic.`
    );
    score += 50 / 12; // Very low
  }

  // Zinc (8.33 points) - higher is better
  const dailyZincTarget =
    guidelines.zinc[bracket as keyof typeof guidelines.zinc];
  const zincTarget = dailyZincTarget * 7; // Convert daily to weekly
  const zincOptimal = zincTarget * 1.2; // 120% of weekly target
  if (overview.zinc >= zincTarget) {
    score += 100 / 12; // Optimal or better
  } else if (overview.zinc >= zincTarget * 0.7) {
    improvements.push(
      `Nice work with zinc! You're at ${overview.zinc.toFixed(
        1
      )}mg this week - let's aim for ${zincTarget}mg per week (${dailyZincTarget}mg daily) to support your child's immune system.`
    );
    score += 75 / 12; // Low
  } else {
    improvements.push(
      `Let's boost that zinc! Currently at ${overview.zinc.toFixed(
        1
      )}mg this week - reaching ${zincTarget}mg per week (${dailyZincTarget}mg daily) will help your child's immune system stay strong.`
    );
    score += 50 / 12; // Very low
  }

  // Calcium (8.33 points) - higher is better
  const dailyCalciumTarget =
    guidelines.calcium[bracket as keyof typeof guidelines.calcium];
  const calciumTarget = dailyCalciumTarget * 7; // Convert daily to weekly
  const calciumOptimal = calciumTarget * 1.2; // 120% of weekly target
  if (overview.calcium >= calciumTarget) {
    score += 100 / 12; // Optimal or better
  } else if (overview.calcium >= calciumTarget * 0.7) {
    improvements.push(
      `Great progress with calcium! You're at ${overview.calcium.toFixed(
        1
      )}mg this week - let's aim for ${calciumTarget}mg per week (${dailyCalciumTarget}mg daily) to build strong bones and teeth.`
    );
    score += 75 / 12; // Low
  } else {
    improvements.push(
      `Let's boost that calcium! Currently at ${overview.calcium.toFixed(
        1
      )}mg this week - reaching ${calciumTarget}mg per week (${dailyCalciumTarget}mg daily) will help your child build strong bones and teeth.`
    );
    score += 50 / 12; // Very low
  }

  return { score, improvements };
};

export const getWeeklyNutritionOverview = async (
  patientId: string,
  age: number // 🔹 need age for scoring
): Promise<NutritionOverview> => {
  try {
    // Get current and previous week ranges
    const { start: currentWeekStart, end: currentWeekEnd } =
      getCurrentWeekRange();
    const previousWeekRange = getPreviousWeekRange();

    // Fetch nutrition data
    const currentWeekData =
      await NutrientsService.getWeeklyNutrientsForInterval({
        userId: patientId,
        start: moment(currentWeekStart).toDate(),
        end: moment(currentWeekEnd).toDate(),
      });

    const previousWeekData =
      await NutrientsService.getWeeklyNutrientsForInterval({
        userId: patientId,
        start: moment(previousWeekRange.start).toDate(),
        end: moment(previousWeekRange.end).toDate(),
      });

    const currentWeek = currentWeekData[0] || null;
    const allWeeksData = [...currentWeekData, ...previousWeekData];

    // Helpers
    const calculateMacroPercentages = (
      carbs: number,
      proteins: number,
      fats: number
    ) => {
      const totalCalories = carbs * 4 + proteins * 4 + fats * 9;
      if (totalCalories === 0) return { carbs: 0, proteins: 0, fats: 0 };
      return {
        carbs: Math.round(((carbs * 4) / totalCalories) * 100),
        proteins: Math.round(((proteins * 4) / totalCalories) * 100),
        fats: Math.round(((fats * 9) / totalCalories) * 100),
      };
    };

    const calculateTrend = (
      current: number,
      previous: number
    ): "increasing" | "decreasing" | "stable" => {
      const change = ((current - previous) / (previous || 1)) * 100;
      if (Math.abs(change) < 5) return "stable";
      return change > 0 ? "increasing" : "decreasing";
    };

    // Current week overview
    const currentWeekOverview = currentWeek
      ? {
          macros: {
            carbohydrates: currentWeek.carbohydrates || 0,
            proteins: currentWeek.proteins || 0,
            fats: currentWeek.fats || 0,
            calories:
              (currentWeek.carbohydrates || 0) * 4 +
              (currentWeek.proteins || 0) * 4 +
              (currentWeek.fats || 0) * 9,
          },
          macroPercentages: calculateMacroPercentages(
            currentWeek.carbohydrates || 0,
            currentWeek.proteins || 0,
            currentWeek.fats || 0
          ),
          servings: {
            vegetables: currentWeek.vegetableServings || 0,
            fruits: currentWeek.fruitServings || 0,
          },
          processedFoods: currentWeek.processedFoodCount || 0,
          fiber: currentWeek.fiber || 0,
          sodium: currentWeek.sodium || 0,
          naturalSugar: currentWeek.naturalSugar || 0,
          addedSugar: currentWeek.addedSugar || 0,
          iron: currentWeek.iron || 0,
          zinc: currentWeek.zinc || 0,
          calcium: currentWeek.calcium || 0,
        }
      : {
          macros: { carbohydrates: 0, proteins: 0, fats: 0, calories: 0 },
          macroPercentages: { carbs: 0, proteins: 0, fats: 0 },
          servings: { vegetables: 0, fruits: 0 },
          processedFoods: 0,
          fiber: 0,
          sodium: 0,
          naturalSugar: 0,
          addedSugar: 0,
          iron: 0,
          zinc: 0,
          calcium: 0,
        };

    // Previous week overview
    const previousWeek = previousWeekData[0] || null;
    const previousWeekOverview = previousWeek
      ? {
          macros: {
            carbohydrates: previousWeek.carbohydrates || 0,
            proteins: previousWeek.proteins || 0,
            fats: previousWeek.fats || 0,
            calories:
              (previousWeek.carbohydrates || 0) * 4 +
              (previousWeek.proteins || 0) * 4 +
              (previousWeek.fats || 0) * 9,
          },
          macroPercentages: calculateMacroPercentages(
            previousWeek.carbohydrates || 0,
            previousWeek.proteins || 0,
            previousWeek.fats || 0
          ),
          servings: {
            vegetables: previousWeek.vegetableServings || 0,
            fruits: previousWeek.fruitServings || 0,
          },
          processedFoods: previousWeek.processedFoodCount || 0,
          fiber: previousWeek.fiber || 0,
          sodium: previousWeek.sodium || 0,
          naturalSugar: previousWeek.naturalSugar || 0,
          addedSugar: previousWeek.addedSugar || 0,
          iron: previousWeek.iron || 0,
          zinc: previousWeek.zinc || 0,
          calcium: previousWeek.calcium || 0,
        }
      : {
          macros: { carbohydrates: 0, proteins: 0, fats: 0, calories: 0 },
          macroPercentages: { carbs: 0, proteins: 0, fats: 0 },
          servings: { vegetables: 0, fruits: 0 },
          processedFoods: 0,
          fiber: 0,
          sodium: 0,
          naturalSugar: 0,
          addedSugar: 0,
          iron: 0,
          zinc: 0,
          calcium: 0,
        };

    // Average weekly
    const averageWeekly =
      allWeeksData.length > 0
        ? {
            macros: {
              carbohydrates:
                allWeeksData.reduce(
                  (sum, week) => sum + (week.carbohydrates || 0),
                  0
                ) / allWeeksData.length,
              proteins:
                allWeeksData.reduce(
                  (sum, week) => sum + (week.proteins || 0),
                  0
                ) / allWeeksData.length,
              fats:
                allWeeksData.reduce((sum, week) => sum + (week.fats || 0), 0) /
                allWeeksData.length,
              calories:
                allWeeksData.reduce((sum, week) => {
                  const calories =
                    (week.carbohydrates || 0) * 4 +
                    (week.proteins || 0) * 4 +
                    (week.fats || 0) * 9;
                  return sum + calories;
                }, 0) / allWeeksData.length,
            },
            macroPercentages: calculateMacroPercentages(
              allWeeksData.reduce(
                (sum, week) => sum + (week.carbohydrates || 0),
                0
              ) / allWeeksData.length,
              allWeeksData.reduce(
                (sum, week) => sum + (week.proteins || 0),
                0
              ) / allWeeksData.length,
              allWeeksData.reduce((sum, week) => sum + (week.fats || 0), 0) /
                allWeeksData.length
            ),
            servings: {
              vegetables:
                allWeeksData.reduce(
                  (sum, week) => sum + (week.vegetableServings || 0),
                  0
                ) / allWeeksData.length,
              fruits:
                allWeeksData.reduce(
                  (sum, week) => sum + (week.fruitServings || 0),
                  0
                ) / allWeeksData.length,
            },
            processedFoods:
              allWeeksData.reduce(
                (sum, week) => sum + (week.processedFoodCount || 0),
                0
              ) / allWeeksData.length,
            fiber:
              allWeeksData.reduce((sum, week) => sum + (week.fiber || 0), 0) /
              allWeeksData.length,
            sodium:
              allWeeksData.reduce((sum, week) => sum + (week.sodium || 0), 0) /
              allWeeksData.length,
            naturalSugar:
              allWeeksData.reduce(
                (sum, week) => sum + (week.naturalSugar || 0),
                0
              ) / allWeeksData.length,
            addedSugar:
              allWeeksData.reduce(
                (sum, week) => sum + (week.addedSugar || 0),
                0
              ) / allWeeksData.length,
            iron:
              allWeeksData.reduce((sum, week) => sum + (week.iron || 0), 0) /
              allWeeksData.length,
            zinc:
              allWeeksData.reduce((sum, week) => sum + (week.zinc || 0), 0) /
              allWeeksData.length,
            calcium:
              allWeeksData.reduce((sum, week) => sum + (week.calcium || 0), 0) /
              allWeeksData.length,
          }
        : {
            macros: { carbohydrates: 0, proteins: 0, fats: 0, calories: 0 },
            macroPercentages: { carbs: 0, proteins: 0, fats: 0 },
            servings: { vegetables: 0, fruits: 0 },
            processedFoods: 0,
            fiber: 0,
            sodium: 0,
            naturalSugar: 0,
            addedSugar: 0,
            iron: 0,
            zinc: 0,
            calcium: 0,
          };

    // Trends
    const trends = {
      macroTrends: {
        carbs: previousWeek
          ? calculateTrend(
              currentWeekOverview.macros.carbohydrates,
              previousWeekOverview.macros.carbohydrates
            )
          : "stable",
        proteins: previousWeek
          ? calculateTrend(
              currentWeekOverview.macros.proteins,
              previousWeekOverview.macros.proteins
            )
          : "stable",
        fats: previousWeek
          ? calculateTrend(
              currentWeekOverview.macros.fats,
              previousWeekOverview.macros.fats
            )
          : "stable",
      },
      servingTrends: {
        vegetables: previousWeek
          ? calculateTrend(
              currentWeekOverview.servings.vegetables,
              previousWeekOverview.servings.vegetables
            )
          : "stable",
        fruits: previousWeek
          ? calculateTrend(
              currentWeekOverview.servings.fruits,
              previousWeekOverview.servings.fruits
            )
          : "stable",
      },
      processedFoodTrend: previousWeek
        ? calculateTrend(
            currentWeekOverview.processedFoods,
            previousWeekOverview.processedFoods
          )
        : "stable",
    };

    // 🔹 Balanced diet scoring + improvements
    const { score: dietBalanceScore, improvements: improvementAreas } =
      calculateDietScoreAndImprovements(currentWeekOverview, age);

    // 🔹 Calculate recommended values for comparison
    const bracket = getAgeBracket(age);
    const fruitTarget =
      guidelines.fruits[bracket as keyof typeof guidelines.fruits] || 1.5;
    const vegTarget =
      guidelines.vegetables[bracket as keyof typeof guidelines.vegetables] ||
      1.5;

    const recommendedValues = {
      fruits: {
        minimum: fruitTarget * 7, // Daily target × 7 days
        maximum: fruitTarget * 1.5 * 7, // 150% of daily target × 7 days
      },
      vegetables: {
        minimum: vegTarget * 7, // Daily target × 7 days
        maximum: vegTarget * 1.5 * 7, // 150% of daily target × 7 days
      },
      processedFoods: {
        minimum: 0, // No processed foods is ideal
        maximum: 14, // Max 2 servings per day × 7 days
      },
    };

    return {
      currentWeek: currentWeekOverview,
      previousWeek: previousWeekOverview,
      averageWeekly,
      trends,
      weekRange: {
        current: {
          start: new Date(currentWeekStart),
          end: new Date(currentWeekEnd),
        },
        previous: {
          start: new Date(previousWeekRange.start),
          end: new Date(previousWeekRange.end),
        },
      },
      dietBalanceScore,
      improvementAreas,
      recommendedValues,
    };
  } catch (error: unknown) {
    console.error("Failed to generate nutrition overview", error);
    throw error;
  }
};
