import moment from "moment";
import { getPatientById } from "../../../patient/model/patient.model";
import { getCurrentWeekRange } from "../../../../utils/formatDate";
import NutritionService from "../../../nutrition/model/nutrition.model";
import CaloriesService from "../../../calories_tracker/model/calories.model";
import WeightServices from "../../../weight_tracker/model/weight.model";
import BFPServices from "../../../bodyFatPercentage/model/bfp.model";
import prisma from "../../../../utility/prismaClient";

// Helper function to get date ranges for past weeks (Monday to Sunday)
const getPastWeekRanges = (timeZone: string) => {
  const ranges = [];
  for (let i = 0; i < 3; i++) {
    // Start from current week's Monday and go backwards
    const endDate = moment
      .tz(timeZone)
      .subtract(i * 7, "days")
      .startOf("isoWeek")
      .add(6, "days");
    const startDate = moment(endDate).subtract(6, "days");
    ranges.push({
      start: startDate.format("YYYY-MM-DD"),
      end: endDate.format("YYYY-MM-DD"),
    });
  }
  return ranges;
};

export const getWeightAndBFPTrackers = async (patientId: string) => {
  try {
    const [weightTracker, bfpTracker] = await Promise.all([
      WeightServices.getWeigthTracker(patientId),
      BFPServices.getBFPTracker(patientId),
    ]);
    const weightEntries = Array.isArray(weightTracker)
      ? []
      : weightTracker.weightEntries.map((entry) => ({
          weight: `${entry.weight}${entry.unit}`,
          createdAt: entry.createdAt,
        }));
    const bfpEntries = Array.isArray(bfpTracker)
      ? []
      : bfpTracker.BFPEntries.map((entry) => ({
          percentage: entry.percentage,
          createdAt: entry.createdAt,
        }));
    return { weightTracker: weightEntries, bfpTracker: bfpEntries };
  } catch (error: unknown) {
    console.error("Error fetching the user trackers", error);
  }
};

// export const getPatientNutritionAndHealthInformation = async (
//   patientId: string
// ) => {
//   try {
//     const patient = await getPatientById(patientId);
//     const todayDate = moment.tz(patient.timeZone).format("YYYY-MM-DD");
//     if (!patient) {
//       console.log("❌ No patient data found.");
//       return "I'm here to assist you with any general health, nutrition, or fitness inquiries. How can I help today?";
//     }
//     // Fetch user's nutrient tracking data
//     const whereClause = { userId: patientId };
//     const { start } = getCurrentWeekRange();

//     const nutrientsTracker = await NutritionService.getNutrientsTracker(
//       whereClause
//     );

//     const caloriesTracker = await CaloriesService.getCaloriesTracker(
//       whereClause
//     );

//     // Handle missing weekly entries safely
//     const weeklyNutrientEntries = nutrientsTracker?.weeklyEntries ?? [];
//     const dailyNutrientEntries = nutrientsTracker?.dailyEntries ?? [];
//     const weeklyCalorieEntries = caloriesTracker?.weeklyEntries ?? [];
//     const dailyCalorieEntries = caloriesTracker.dailyEntries ?? [];

//     // Get past 3 weeks data
//     const pastWeekRanges = getPastWeekRanges(patient.timeZone);

//     // Process weekly data
//     const pastThreeWeeksNutrients = pastWeekRanges.map((weekRange) => {
//       const weekNutrients = weeklyNutrientEntries.filter(
//         (entry: any) =>
//           entry.weekStartDate &&
//           entry.weekStartDate.toISOString().split("T")[0] === weekRange.start
//       );
//       return {
//         weekStart: weekRange.start,
//         weekEnd: weekRange.end,
//         nutrients: weekNutrients ?? "N/A",
//       };
//     });

//     const pastThreeWeeksCalories = pastWeekRanges.map((weekRange) => {
//       const weekCalories = weeklyCalorieEntries.filter(
//         (entry: any) =>
//           entry.weekStartDate &&
//           moment(weekRange.start).format("YYYY-MM-DDTHH:mm:ss.SSS[+00:00]") ===
//             entry.weekStartDate
//       );
//       return {
//         weekStart: weekRange.start,
//         weekEnd: weekRange.end,
//         calories: weekCalories.length > 0 ? weekCalories[0].totalIntake : "N/A",
//       };
//     });

//     //current week nutrients
//     const currentWeekNutrients =
//       weeklyNutrientEntries.find(
//         (entry: any) =>
//           entry.weekStartDate &&
//           entry.weekStartDate.toISOString().split("T")[0] ===
//             start.split("T")[0]
//       ) ?? "N/A";
//     const todayNutrients =
//       dailyNutrientEntries.find(
//         (entry: any) => entry && entry.date.split("T")[0] === todayDate
//       ) ?? "N/A";
//     //current week calories
//     const currentWeekCaloriesEntry = weeklyCalorieEntries.find(
//       (entry: any) =>
//         entry.weekStartDate &&
//         entry.weekStartDate.split("T")[0] === start.split("T")[0]
//     );
//     const currentWeekCaloriesIntake = currentWeekCaloriesEntry
//       ? currentWeekCaloriesEntry?.totalIntake
//       : "N/A";
//     // today intake calories
//     const todayIntakeCaloriesEntry = dailyCalorieEntries.find(
//       (entry: any) => entry && entry.date.split("T")[0] === todayDate
//     );
//     const todayIntakeCalories = todayIntakeCaloriesEntry
//       ? todayIntakeCaloriesEntry.caloriesIntake
//       : "N/A";

//     // Handle missing trackers by setting default values
//     const carbohydratesLimit = nutrientsTracker?.carbohydratesLimit ?? "N/A";
//     const proteinsLimit = nutrientsTracker?.proteinsLimit ?? "N/A";
//     const fatsLimit = nutrientsTracker?.fatsLimit ?? "N/A";
//     // Extract user-specific data
//     const { conditions, allergies, nutrition, caloricAmount } =
//       patient.patientSummary;

//     // Check if nutrition data is missing
//     const isTodayNutritionMissing = todayIntakeCalories === "N/A";
//     const isWeeklyNutritionMissing = currentWeekCaloriesIntake === "N/A";

//     return {
//       conditions,
//       allergies,
//       caloricAmount,
//       isTodayNutritionMissing,
//       isWeeklyNutritionMissing,
//       todayIntakeCalories,
//       carbohydratesLimit,
//       proteinsLimit,
//       fatsLimit,
//       todayNutrients,
//       currentWeekCaloriesIntake,
//       nutrition,
//       currentWeekNutrients,
//       // Historical data (past 3 weeks)
//       pastThreeWeeksNutrients,
//       pastThreeWeeksCalories,
//     };
//   } catch (error: unknown) {
//     console.error("Error retrieving nutrition data", error);
//   }
// };

// export const getNutritionOverviewPrompt = async (patientId: string) => {
//   try {
//     const patientData: any = await getPatientNutritionAndHealthInformation(
//       patientId
//     );
//     if (!patientData) {
//       console.error("No patient data returned");
//     }
//     const {
//       conditions,
//       allergies,
//       caloricAmount,
//       isTodayNutritionMissing,
//       isWeeklyNutritionMissing,
//       todayIntakeCalories,
//       carbohydratesLimit,
//       proteinsLimit,
//       fatsLimit,
//       todayNutrients,
//       currentWeekCaloriesIntake,
//       nutrition,
//       currentWeekNutrients,
//       pastThreeWeeksNutrients,
//       pastThreeWeeksCalories,
//     } = patientData && patientData;
//     let response = `Here's what I found based on your health and nutrition data:\n`;

//     if (conditions.length > 0) {
//       response += `- **Health Conditions**: ${JSON.stringify(conditions)}\n`;
//     } else {
//       response += `- **Health Conditions**: No conditions recorded.\n`;
//     }

//     if (allergies.length > 0) {
//       response += `-**Allergies**: ${JSON.stringify(allergies)}\n`;
//     } else {
//       response += `-**Allergies**: No allergies recorded.\n`;
//     }

//     response += `-**Daily Caloric Goal**: ${caloricAmount ?? "N/A"} kcal\n`;
//     response += `-**Weekly Caloric Goal**: ${caloricAmount * 7} kcal\n`;

//     if (isTodayNutritionMissing) {
//       response += `-**It looks like you haven't logged any food today.** If you need help getting started, let me know!
//         \n`;
//     } else {
//       // response += `-**Today Caloric Intake**: ${todayIntakeCalories} kcal\n`;

//       // Macro recommended
//       response += `-**Daily Macronutrient Recommended**:\n`;
//       response += `- Carbohydrates: ${carbohydratesLimit}g\n`;
//       response += `- Proteins: ${proteinsLimit}g\n`;
//       response += `- Fats: ${fatsLimit}g\n`;
//       // Macro intake
//       response += `-**Today Macronutrient Intake**:\n`;
//       response += `- Carbohydrates: ${
//         todayNutrients !== "N/A" ? todayNutrients.carbohydrates : "N/A"
//       }g\n`;
//       response += `- Proteins: ${
//         todayNutrients !== "N/A" ? todayNutrients.proteins : "N/A"
//       }g\n`;
//       response += `- Fats: ${
//         todayNutrients !== "N/A" ? todayNutrients.fats : "N/A"
//       }g\n`;

//       // Add new nutrition metrics for today
//       response += `-**Today's Additional Nutrition Metrics**:\n`;
//       response += `- Processed Food Items: ${
//         todayNutrients !== "N/A" ? todayNutrients.processedFoodCount : "N/A"
//       }\n`;
//       response += `- Vegetable Servings: ${
//         todayNutrients !== "N/A" ? todayNutrients.vegetableServings : "N/A"
//       }\n`;
//       response += `- Fruit Servings: ${
//         todayNutrients !== "N/A" ? todayNutrients.fruitServings : "N/A"
//       }\n`;
//     }

//     if (isWeeklyNutritionMissing) {
//       response += `-**It looks like you haven't logged any food this week.** If you need help getting started, let me know!
//         \n`;
//     } else {
//       response += `-**Current Weekly Caloric Intake**: ${currentWeekCaloriesIntake} kcal\n`;
//       // Macro recommended
//       response += `- **Weekly Macronutrient Recommended**:\n`;
//       response += `- Carbohydrates: ${
//         carbohydratesLimit !== "N/A" ? carbohydratesLimit * 7 : "N/A"
//       }g\n`;
//       response += `- Proteins: ${
//         proteinsLimit !== "N/A" ? proteinsLimit * 7 : "N/A"
//       }g\n`;
//       response += `   - Fats: ${
//         fatsLimit !== "N/A" ? fatsLimit * 7 : "N/A"
//       }g\n`;
//       // Macro intake
//       response += `-**Current Week Macronutrient Intake**:\n`;
//       response += `- Carbohydrates: ${
//         currentWeekNutrients !== "N/A"
//           ? currentWeekNutrients.carbohydrates
//           : "N/A"
//       }g\n`;
//       response += `-Proteins: ${
//         currentWeekNutrients !== "N/A" ? currentWeekNutrients.proteins : "N/A"
//       }g\n`;
//       response += `- Fats: ${
//         currentWeekNutrients !== "N/A" ? currentWeekNutrients.fats : "N/A"
//       }g\n`;

//       // Add new nutrition metrics for current week
//       response += `-**Current Week Additional Nutrition Metrics**:\n`;
//       response += `- Processed Food Items: ${
//         currentWeekNutrients !== "N/A"
//           ? currentWeekNutrients.processedFoodCount
//           : "N/A"
//       }\n`;
//       response += `- Vegetable Servings: ${
//         currentWeekNutrients !== "N/A"
//           ? currentWeekNutrients.vegetableServings
//           : "N/A"
//       }\n`;
//       response += `- Fruit Servings: ${
//         currentWeekNutrients !== "N/A"
//           ? currentWeekNutrients.fruitServings
//           : "N/A"
//       }\n`;
//     }

//     // Add Past Three Weeks Data
//     response += `\n**Past Three Weeks Overview**:\n`;
//     pastThreeWeeksNutrients.forEach((weekData, index) => {
//       response += `\nWeek ${index + 1} (${weekData.weekStart} to ${
//         weekData.weekEnd
//       }):\n`;
//       if (weekData.nutrients !== "N/A" && weekData.nutrients.length > 0) {
//         const nutrients = weekData.nutrients[0];
//         response += `- Carbohydrates: ${nutrients?.carbohydrates ?? "N/A"}g\n`;
//         response += `- Proteins: ${nutrients?.proteins ?? "N/A"}g\n`;
//         response += `- Fats: ${nutrients?.fats ?? "N/A"}g\n`;
//         response += `- Processed Food Items: ${
//           nutrients?.processedFoodCount ?? "N/A"
//         }\n`;
//         response += `- Vegetable Servings: ${
//           nutrients?.vegetableServings ?? "N/A"
//         }\n`;
//         response += `- Fruit Servings: ${nutrients?.fruitServings ?? "N/A"}\n`;
//       } else {
//         response += `- No nutrient data recorded\n`;
//       }

//       const weekCalories = pastThreeWeeksCalories[index];
//       response += `- Total Calories: ${
//         weekCalories.calories !== "N/A"
//           ? `${weekCalories.calories} kcal`
//           : "No data"
//       }\n`;
//     });

//     response += `\nLet me know if you need help with meal planning or any other nutritional guidance.`;

//     return response;
//   } catch (error: unknown) {
//     console.error("Error generating nutrition overview prompt", error);
//   }
// };

const WEEKLY_LOW_CAL_THRESHOLD = 500;

const fmtDate = (m: moment.Moment) => m.format("YYYY-MM-DD");
const dateOnly = (d: any) => {
  try {
    if (!d) return null;
    // Handle Date, ISO string, or plain "YYYY-MM-DD"
    if (d instanceof Date) return d.toISOString().split("T")[0];
    const m = moment(d);
    return m.isValid() ? m.format("YYYY-MM-DD") : null;
  } catch {
    return null;
  }
};

const getISOWeekRange = (when: moment.Moment) => {
  const start = when.clone().startOf("isoWeek"); // Monday 00:00
  const end = when.clone().endOf("isoWeek"); // Sunday 23:59:59
  return { start: fmtDate(start), end: fmtDate(end) };
};

/** Build current week (index 0) + previous 2 (1..2) */
const getLastNWeekRanges = (tz: string, n = 3) => {
  const now = moment().tz(tz);

  const ranges: { start: string; end: string; isCurrent: boolean }[] = [];
  for (let i = 0; i < n; i++) {
    const base = now.clone().subtract(i, "weeks");
    const { start, end } = getISOWeekRange(base);
    ranges.push({ start, end, isCurrent: i === 0 });
  }
  return ranges;
};

const roundPct = (n: number) => Math.round(n * 10) / 10;

function macroPercentsFromGrams(
  carbs?: number,
  protein?: number,
  fat?: number
): { carbsPct: number; proteinPct: number; fatPct: number } | "N/A" {
  const c = Number(carbs ?? 0);
  const p = Number(protein ?? 0);
  const f = Number(fat ?? 0);
  const total = c + p + f;
  if (total <= 0) return "N/A";
  return {
    carbsPct: roundPct((c / total) * 100),
    proteinPct: roundPct((p / total) * 100),
    fatPct: roundPct((f / total) * 100),
  };
}

/** Safely pull the first weekly nutrient entry for a weekStart (YYYY-MM-DD) */
function findWeeklyNutrient(
  weeklyNutrientEntries: any[] = [],
  weekStartYYYYMMDD: string
) {
  return (
    weeklyNutrientEntries.find((e: any) => {
      const wk = dateOnly(e?.weekStartDate);
      return wk === weekStartYYYYMMDD;
    }) ?? null
  );
}

/** Safely pull the weekly calories total for a weekStart (YYYY-MM-DD) */
function findWeeklyCalories(
  weeklyCalorieEntries: any[] = [],
  weekStartYYYYMMDD: string
): number | null {
  // First try exact match
  let match = weeklyCalorieEntries.find((e: any) => {
    const wk = dateOnly(e?.weekStartDate);

    return wk === weekStartYYYYMMDD;
  });

  // If no exact match, try to find the closest week (within 3 days for better accuracy)
  if (!match) {
    console.log("No exact match found, looking for closest week...");
    const targetDate = moment(weekStartYYYYMMDD);
    let bestMatch = null;
    let smallestDiff = Infinity;

    weeklyCalorieEntries.forEach((e: any) => {
      const wk = dateOnly(e?.weekStartDate);
      if (!wk) return;
      const entryDate = moment(wk);
      const daysDiff = Math.abs(targetDate.diff(entryDate, "days"));

      if (daysDiff <= 3 && daysDiff < smallestDiff) {
        bestMatch = e;
        smallestDiff = daysDiff;
      }
    });

    match = bestMatch;
  }

  if (!match) return null;
  const val = Number(
    match?.totalIntake ?? match?.totalCalories ?? match?.calories
  );
  return Number.isFinite(val) ? val : null;
}

/** Assess data quality for a week’s calories, with Monday exception for current week */
function qualityTagForWeek(
  caloriesOrNull: number | null,
  isCurrentWeek: boolean,
  tz: string
): "ok" | "insufficient_logging" | "early_week" | "no_data" {
  if (caloriesOrNull == null) return "no_data";
  if (isCurrentWeek) {
    const dow = moment().tz(tz).isoWeekday(); // 1=Mon
    if (dow === 1) {
      // Don’t penalize low totals on Monday
      return "early_week";
    }
  }
  return caloriesOrNull <= WEEKLY_LOW_CAL_THRESHOLD
    ? "insufficient_logging"
    : "ok";
}

/** ===== Main data fetcher & aggregator ===== */
export const getPatientNutritionAndHealthInformation = async (
  patientId: string
) => {
  try {
    const patient = await getPatientById(patientId);
    if (!patient) {
      console.log("❌ No patient data found.");
      return "I'm here to assist you with any general health, nutrition, or fitness inquiries. How can I help today?";
    }

    const tz: string = patient.timeZone || "UTC";
    const todayDate = moment().tz(tz).format("YYYY-MM-DD");

    const whereClause = { userId: patientId };

    const nutrientsTracker = await NutritionService.getNutrientsTracker(
      whereClause
    );
    const caloriesTracker = await CaloriesService.getCaloriesTracker(
      whereClause
    );

    const weeklyNutrientEntries: any[] = nutrientsTracker?.weeklyEntries ?? [];
    const dailyNutrientEntries: any[] = nutrientsTracker?.dailyEntries ?? [];
    const weeklyCalorieEntries: any[] = caloriesTracker?.weeklyEntries ?? [];
    const dailyCalorieEntries: any[] = caloriesTracker?.dailyEntries ?? [];

    // Calculate average from most recent 2 weeks of actual logged data
    const recentWeeks = weeklyCalorieEntries
      .filter((entry: any) => entry.totalIntake > 0) // Only weeks with actual data
      .sort(
        (a: any, b: any) =>
          new Date(b.weekStartDate).getTime() -
          new Date(a.weekStartDate).getTime()
      )
      .slice(0, 2);

    const averageCalories =
      recentWeeks.length > 0
        ? Math.round(
            recentWeeks.reduce(
              (sum: number, entry: any) => sum + entry.totalIntake,
              0
            ) / recentWeeks.length
          )
        : null;

    // Calculate average from last 2 week ranges from today
    const last2WeekRanges = getLastNWeekRanges(tz, 2);
    const weekRangeCalories = last2WeekRanges
      .map((range) => {
        const match = weeklyCalorieEntries.find((entry) => {
          const entryWeekStart = dateOnly(entry.weekStartDate);
          return entryWeekStart === range.start;
        });
        return match ? match.totalIntake : null;
      })
      .filter((calories) => calories !== null && calories > 0);

    const weekRangeAverage =
      weekRangeCalories.length > 0
        ? Math.round(
            weekRangeCalories.reduce((sum, cal) => sum + cal, 0) /
              weekRangeCalories.length
          )
        : null;

    // Build current + previous week (Mon–Sun)
    const weekRanges = getLastNWeekRanges(tz, 2);

    // Collect per-week snapshots
    const weeks = weekRanges.map(({ start, end, isCurrent }) => {
      const nutrient = findWeeklyNutrient(weeklyNutrientEntries, start);
      const calories = findWeeklyCalories(weeklyCalorieEntries, start);
      const macroPct = nutrient
        ? macroPercentsFromGrams(
            nutrient?.carbohydrates,
            nutrient?.proteins,
            nutrient?.fats
          )
        : "N/A";

      const quality = qualityTagForWeek(calories, isCurrent, tz);

      return {
        weekStart: start,
        weekEnd: end,
        isCurrentWeek: isCurrent,
        caloriesTotal: calories, // numeric or null
        macroPercentages: macroPct, // {carbsPct, proteinPct, fatPct} | "N/A"
        qualityTag: quality, // "ok" | "insufficient_logging" | "early_week" | "no_data"
      };
    });

    // Combine macro grams across all available weeks (only those with nutrient data)
    const combined = weeks.reduce(
      (acc, w) => {
        if (w.macroPercentages === "N/A") return acc;
        const nutrient = findWeeklyNutrient(weeklyNutrientEntries, w.weekStart);
        const c = Number(nutrient?.carbohydrates ?? 0);
        const p = Number(nutrient?.proteins ?? 0);
        const f = Number(nutrient?.fats ?? 0);
        return {
          carbs: acc.carbs + c,
          protein: acc.protein + p,
          fat: acc.fat + f,
        };
      },
      { carbs: 0, protein: 0, fat: 0 }
    );

    const combinedMacroPercentages =
      combined.carbs + combined.protein + combined.fat > 0
        ? {
            carbsPct: roundPct(
              (combined.carbs /
                (combined.carbs + combined.protein + combined.fat)) *
                100
            ),
            proteinPct: roundPct(
              (combined.protein /
                (combined.carbs + combined.protein + combined.fat)) *
                100
            ),
            fatPct: roundPct(
              (combined.fat /
                (combined.carbs + combined.protein + combined.fat)) *
                100
            ),
          }
        : "N/A";

    // Extract essentials the prompt might still want
    const {
      conditions = [],
      allergies = [],
      nutrition = {},
      caloricAmount,
    } = patient?.patientSummary ?? {};

    // "Today" info (kept in case you still use it elsewhere)

    const todayIntakeCaloriesEntry = dailyCalorieEntries.find(
      (e: any) => e.date.split("T")[0] === todayDate
    );
    const todayIntakeCalories =
      todayIntakeCaloriesEntry?.caloriesIntake ?? null;

    // Today's nutrients
    const todayNutrients =
      dailyNutrientEntries.find(
        (entry: any) => entry.date.split("T")[0] === todayDate
      ) ?? "N/A";

    // Current week nutrients
    const { start } = getCurrentWeekRange();
    const currentWeekNutrients =
      weeklyNutrientEntries.find(
        (entry: any) =>
          entry.weekStartDate &&
          dateOnly(entry.weekStartDate) === start.split("T")[0]
      ) ?? "N/A";

    // Macro limits from nutrientsTracker
    const carbohydratesLimit = nutrientsTracker?.carbohydratesLimit ?? "N/A";
    const proteinsLimit = nutrientsTracker?.proteinsLimit ?? "N/A";
    const fatsLimit = nutrientsTracker?.fatsLimit ?? "N/A";

    // Missing data flags
    const isTodayNutritionMissing = todayIntakeCalories === null;
    const isWeeklyNutritionMissing = currentWeekNutrients === "N/A";

    // Past three weeks data (for historical analysis)
    const pastWeekRanges = getPastWeekRanges(tz);
    const pastThreeWeeksNutrients = pastWeekRanges.map((weekRange) => {
      const weekNutrients = weeklyNutrientEntries.filter(
        (entry: any) =>
          entry.weekStartDate &&
          dateOnly(entry.weekStartDate) === weekRange.start
      );
      return {
        weekStart: weekRange.start,
        weekEnd: weekRange.end,
        nutrients: weekNutrients.length > 0 ? weekNutrients[0] : "N/A",
      };
    });

    const pastThreeWeeksCalories = pastWeekRanges.map((weekRange) => {
      const weekCalories = weeklyCalorieEntries.filter(
        (entry: any) =>
          entry.weekStartDate &&
          dateOnly(entry.weekStartDate) === weekRange.start
      );
      return {
        weekStart: weekRange.start,
        weekEnd: weekRange.end,
        calories: weekCalories.length > 0 ? weekCalories[0].totalIntake : "N/A",
      };
    });

    return {
      timezone: tz,
      conditions,
      allergies,
      caloricAmount: caloricAmount ?? null,
      // New weekly snapshots (up to 3, current first)
      weeks, // [{ weekStart, weekEnd, isCurrentWeek, caloriesTotal, macroPercentages, qualityTag }]
      // Combined 3-week macro split
      combinedMacroPercentages, // {carbsPct, proteinPct, fatPct} | "N/A"
      // Convenience flags
      isCurrentWeekMonday: moment().tz(tz).isoWeekday() === 1,
      todayIntakeCalories,
      // Metadata
      computedAt: moment().tz(tz).toISOString(),
      // Missing data from commented function
      isTodayNutritionMissing,
      isWeeklyNutritionMissing,
      todayNutrients,
      currentWeekNutrients,
      carbohydratesLimit,
      proteinsLimit,
      fatsLimit,
      pastThreeWeeksNutrients,
      pastThreeWeeksCalories,
      nutrition,
    };
  } catch (error: unknown) {
    console.error("Error retrieving nutrition data", error);
  }
};

/** ===== Detailed data provider for LLM analysis ===== */
export const getNutritionOverviewPrompt = async (patientId: string) => {
  try {
    const data: any = await getPatientNutritionAndHealthInformation(patientId);
    if (!data || typeof data === "string") {
      console.error("No patient data returned or fallback string received");
      return typeof data === "string"
        ? data
        : "I couldn't load your data just now.";
    }

    const {
      conditions,
      allergies,
      caloricAmount,
      weeks = [],
      combinedMacroPercentages,
      isCurrentWeekMonday,
      timezone,
      todayIntakeCalories,
      // Additional fields from commented function
      isTodayNutritionMissing,
      isWeeklyNutritionMissing,
      todayNutrients,
      currentWeekNutrients,
      carbohydratesLimit,
      proteinsLimit,
      fatsLimit,
      pastThreeWeeksNutrients,
      pastThreeWeeksCalories,
      nutrition,
    } = data;

    // Calculate patterns and insights for LLM analysis
    // Only consider the last 2 weeks (which is what 'weeks' array contains)
    const completeWeeks = weeks.filter((w: any) => w.qualityTag === "ok");
    const incompleteWeeks = weeks.filter(
      (w: any) =>
        w.qualityTag === "insufficient_logging" || w.qualityTag === "no_data"
    );
    const currentWeek = weeks.find((w: any) => w.isCurrentWeek);

    const totalCaloriesComplete = completeWeeks.reduce(
      (sum: number, w: any) => sum + (w.caloriesTotal || 0),
      0
    );
    const avgCaloriesComplete =
      completeWeeks.length > 0
        ? Math.round(totalCaloriesComplete / completeWeeks.length)
        : null;

    // Use the week range calculation
    const finalAverage = avgCaloriesComplete;

    // Calculate macro trends (last 2 weeks only)
    const macroTrends = {
      carbs: completeWeeks
        .map((w: any) =>
          w.macroPercentages !== "N/A" ? w.macroPercentages.carbsPct : null
        )
        .filter(Boolean),
      protein: completeWeeks
        .map((w: any) =>
          w.macroPercentages !== "N/A" ? w.macroPercentages.proteinPct : null
        )
        .filter(Boolean),
      fat: completeWeeks
        .map((w: any) =>
          w.macroPercentages !== "N/A" ? w.macroPercentages.fatPct : null
        )
        .filter(Boolean),
    };

    // Calculate average macros for complete weeks (last 2 weeks only)
    const avgMacros = {
      carbs:
        macroTrends.carbs.length > 0
          ? Math.round(
              macroTrends.carbs.reduce((a: number, b: number) => a + b, 0) /
                macroTrends.carbs.length
            )
          : null,
      protein:
        macroTrends.protein.length > 0
          ? Math.round(
              macroTrends.protein.reduce((a: number, b: number) => a + b, 0) /
                macroTrends.protein.length
            )
          : null,
      fat:
        macroTrends.fat.length > 0
          ? Math.round(
              macroTrends.fat.reduce((a: number, b: number) => a + b, 0) /
                macroTrends.fat.length
            )
          : null,
    };

    // Build detailed data structure for LLM
    const detailedData = {
      patientContext: {
        conditions: conditions?.map((c: any) => c?.condition?.name ?? c) || [],
        allergies: allergies?.map((a: any) => a?.allergy?.substance ?? a) || [],
        dailyCalorieGoal: caloricAmount,
        timezone,
        isCurrentWeekMonday,
      },
      weeklyData: {
        totalWeeks: weeks.length,
        completeWeeks: completeWeeks.length,
        incompleteWeeks: incompleteWeeks.length,
        averageCaloriesComplete: finalAverage,
        currentWeekData: currentWeek,
      },
      macroAnalysis: {
        threeWeekAverage: combinedMacroPercentages,
        completeWeeksAverage: avgMacros,
        trends: {
          carbs: macroTrends.carbs,
          protein: macroTrends.protein,
          fat: macroTrends.fat,
        },
        // Macro limits
        recommendedMacros: {
          carbohydrates: carbohydratesLimit,
          proteins: proteinsLimit,
          fats: fatsLimit,
        },
      },
      weeklyBreakdown: weeks.map((w: any) => ({
        period: w.isCurrentWeek
          ? "This week"
          : `${w.weekStart} to ${w.weekEnd}`,
        calories: w.caloriesTotal,
        macros: w.macroPercentages,
        quality: w.qualityTag,
        isCurrent: w.isCurrentWeek,
      })),
      todayData: {
        calories: todayIntakeCalories,
        nutrients: todayNutrients,
        isMissing: isTodayNutritionMissing,
      },
      currentWeekData: {
        nutrients: currentWeekNutrients,
        isMissing: isWeeklyNutritionMissing,
      },
      historicalData: {
        pastThreeWeeksNutrients,
        pastThreeWeeksCalories,
      },
      nutritionProfile: nutrition,
    };

    return JSON.stringify(detailedData, null, 2);
  } catch (error: unknown) {
    console.error("Error generating nutrition overview prompt", error);
  }
};

// ** ===== Previous Patient SOAP Notes ===== *
export const getPatientSoapNotes = async (patientId: string) => {
  try {
    return await prisma.visit.findMany({
      where: {
        OR: [{ patientId: patientId }, { fhirPatientId: patientId }],
      },
      select: {
        visitType: true,
        visitTime: true,
        postVisitNote: true,
      },
    });
  } catch (error: unknown) {
    console.error("Error fetching the soap notes", error);
    throw error;
  }
};
