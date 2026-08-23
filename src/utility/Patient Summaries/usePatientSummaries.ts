import moment from "moment";
import BloodPressureService from "../../services/bp_tracker/model/bloodpressure.model";
import CaloriesService from "../../services/calories_tracker/model/calories.model";
import ExercisesService from "../../services/exercises_tracker/model/exercises.model";
import GlucoseService from "../../services/glucose_tracker/model/glucose.model";
import HealthGoalService from "../../services/healthgoal/model/healthGoals.model";
import NutrientsService from "../../services/nutrition/model/nutrition.model";
import { getPatientById } from "../../services/patient/model/patient.model";
import WeightService from "../../services/weight_tracker/model/weight.model";
import { getWeekRange } from "../../utils/formatDate";
export const createSummaryToAnalyze = async (
  patientId: string,
  timeFrame: number
) => {
  try {
    const whereId = { userId: patientId };
    const patient = await getPatientById(patientId);
    const [
      exercisesTracker,
      caloriesTracker,
      nutrientsTracker,
      glucoseTracker,
      bloodPressureTracker,
    ] = await Promise.all([
      ExercisesService.getWeeklyExercisesTracker(whereId),
      CaloriesService.getCaloriesTracker(whereId),
      NutrientsService.getNutrientsTracker(whereId),
      GlucoseService.fetchSpecificNumberOfWeeks(patientId, timeFrame),
      BloodPressureService.fetchSpecificNumberOfWeeks(patientId, timeFrame),
    ]);

    const summary = {
      minutesExercising: 0,
      totalCaloriesIntake: 0,
      totalCaloriesBurned: 0,
      glucoseTracker: glucoseTracker,
      bloodPressureTracker: bloodPressureTracker,
      weightTracker: await WeightService.getWeigthTracker(patientId),
      macroNutrients: {},
      patientVitals: patient.patientSummary.vitals,
      patientConditions: patient.patientSummary.conditions,
      patientMedications: patient.patientSummary.medications,
      patientAllergies: patient.patientSummary.allergies,
      patientProcedures: patient.patientSummary.procedures,
      patientLabs: patient.patientSummary.labResults,
      patientNutritionPreferences: patient.patientSummary.nutrition,
      patientExercisePreferences: patient.patientSummary.exercise,
      patientFamilyHistory: patient.patientSummary.familyHistory,
      patientTargetCalories: patient.patientSummary.caloricAmount,
      healthGoals: [],
      actualCarbsPercentage: 0,
      actualFatsPercentage: 0,
      actualProteinsPercentage: 0,
      targetCarbsPercentage: 0,
      targetProteinsPercentage: 0,
      targetFatsPercentage: 0,
    };

    const { start, end } = getWeekRange(timeFrame);

    // Function to filter trackers
    const filterTracker = (tracker) =>
      tracker?.weeklyEntries.filter((entry) => {
        const entryStartDate = moment(entry.weekStartDate);
        const entryEndDate = moment(entry.weekEndDate);
        return (
          entryStartDate.isBetween(start, end, null, "[]") ||
          entryEndDate.isBetween(start, end, null, "[]") ||
          (entryStartDate.isBefore(end) && entryEndDate.isAfter(start))
        );
      });

    const filteredExercisesTracker = filterTracker(exercisesTracker) || [];
    const filteredCaloriesTracker = filterTracker(caloriesTracker) || [];
    const filteredNutrientsTracker = filterTracker(nutrientsTracker) || [];

    // Update the calculations to use the filtered trackers
    const weeksCountExercises = Math.min(
      timeFrame,
      filteredExercisesTracker?.length || 0
    );
    const weeksCountCalories = Math.min(
      timeFrame,
      filteredCaloriesTracker?.length || 0
    );
    const weeksCountNutrients = Math.min(
      timeFrame,
      filteredNutrientsTracker?.length || 0
    );

    console.log({
      filteredExercisesTracker,
      filteredCaloriesTracker,
      filteredNutrientsTracker,
    });

    summary.minutesExercising = filteredExercisesTracker
      .slice(0, weeksCountExercises)
      .reduce((total, entry) => total + entry.minutesOfExercise, 0);
    summary.totalCaloriesIntake = filteredCaloriesTracker
      .slice(0, weeksCountCalories)
      .reduce((total, entry) => total + entry.totalIntake, 0);
    summary.totalCaloriesBurned = filteredCaloriesTracker
      .slice(0, weeksCountCalories)
      .reduce((total, entry) => total + entry.totalBurned, 0);

    const nutrientSums = filteredNutrientsTracker
      .slice(0, weeksCountNutrients)
      .reduce(
        (acc, entry) => {
          acc.carbohydrates += entry.carbohydrates || 0;
          acc.proteins += entry.proteins || 0;
          acc.fats += entry.fats || 0;
          acc.fiber += entry.fiber || 0;
          acc.sodium += entry.sodium || 0;
          acc.naturalSugar += entry.naturalSugar || 0;
          acc.addedSugar += entry.addedSugar || 0;
          acc.calcium += entry.calcium || 0;
          acc.magnesium += entry.magnesium || 0;
          acc.iron += entry.iron || 0;
          acc.potassium += entry.potassium || 0;
          acc.omega_3 += entry.omega_3 || 0;
          acc.cholesterol += entry.cholesterol || 0;
          acc.zinc += entry.zinc || 0;
          acc.vitaminD += entry.vitaminD || 0;
          acc.vitaminB12 += entry.vitaminB12 || 0;
          acc.vitaminC += entry.vitaminC || 0;
          acc.vitaminE += entry.vitaminE || 0;
          return acc;
        },
        {
          carbohydrates: 0,
          proteins: 0,
          fats: 0,
          fiber: 0,
          sodium: 0,
          naturalSugar: 0,
          addedSugar: 0,
          calcium: 0,
          magnesium: 0,
          iron: 0,
          potassium: 0,
          omega_3: 0,
          cholesterol: 0,
          zinc: 0,
          vitaminD: 0,
          vitaminB12: 0,
          vitaminC: 0,
          vitaminE: 0,
        }
      );

    const averageMinutesExercising =
      weeksCountExercises > 0
        ? summary.minutesExercising / weeksCountExercises
        : 0;
    const averageCaloriesIntake =
      weeksCountCalories > 0
        ? summary.totalCaloriesIntake / weeksCountCalories
        : 0;
    const averageCaloriesBurned =
      weeksCountCalories > 0
        ? summary.totalCaloriesBurned / weeksCountCalories
        : 0;
    const averageCarbohydrates =
      weeksCountNutrients > 0
        ? nutrientSums.carbohydrates / weeksCountNutrients
        : 0;
    const averageProteins =
      weeksCountNutrients > 0 ? nutrientSums.proteins / weeksCountNutrients : 0;
    const averageFats =
      weeksCountNutrients > 0 ? nutrientSums.fats / weeksCountNutrients : 0;
    const averageFiber =
      weeksCountNutrients > 0 ? nutrientSums.fiber / weeksCountNutrients : 0;
    const averageSodium =
      weeksCountNutrients > 0 ? nutrientSums.sodium / weeksCountNutrients : 0;
    const averageNaturalSugar =
      weeksCountNutrients > 0
        ? nutrientSums.naturalSugar / weeksCountNutrients
        : 0;
    const averageAddedSugar =
      weeksCountNutrients > 0
        ? nutrientSums.addedSugar / weeksCountNutrients
        : 0;
    const averageCalcium =
      weeksCountNutrients > 0 ? nutrientSums.calcium / weeksCountNutrients : 0;
    const averageMagnesium =
      weeksCountNutrients > 0
        ? nutrientSums.magnesium / weeksCountNutrients
        : 0;
    const averagePotassium =
      weeksCountNutrients > 0
        ? nutrientSums.potassium / weeksCountNutrients
        : 0;
    const averageIron =
      weeksCountNutrients > 0 ? nutrientSums.iron / weeksCountNutrients : 0;
    const averageOmega_3 =
      weeksCountNutrients > 0 ? nutrientSums.omega_3 / weeksCountNutrients : 0;
    const averageCholesterol =
      weeksCountNutrients > 0
        ? nutrientSums.cholesterol / weeksCountNutrients
        : 0;
    const averageZinc =
      weeksCountNutrients > 0 ? nutrientSums.zinc / weeksCountNutrients : 0;
    const averageVitaminD =
      weeksCountNutrients > 0 ? nutrientSums.vitaminD / weeksCountNutrients : 0;
    const averageVitaminB12 =
      weeksCountNutrients > 0
        ? nutrientSums.vitaminB12 / weeksCountNutrients
        : 0;
    const averageVitaminC =
      weeksCountNutrients > 0 ? nutrientSums.vitaminC / weeksCountNutrients : 0;
    const averageVitaminE =
      weeksCountNutrients > 0 ? nutrientSums.vitaminE / weeksCountNutrients : 0;

    // fetching healthGoals
    const healthGoals = await HealthGoalService.getInProgressHealthGoals(
      patientId
    );
    let refinedHealthGoals = [];
    healthGoals.forEach((goal) => {
      const reducedGoal = {
        description: goal.description,
        metricEntries: [],
        id: goal.id,
      };
      goal.trackableMetrics.forEach((metric) => {
        const trackableMetric = {
          description: metric.description,
          targetValue: metric.targetValue,
        };
        reducedGoal.metricEntries.push(trackableMetric);
      });
      refinedHealthGoals.push(reducedGoal);
    });
    // Update summary with calculated averages
    const actualMacroSum =
      nutrientSums.carbohydrates + nutrientSums.proteins + nutrientSums.fats;
    const targetMacroSum =
      nutrientsTracker.carbohydratesLimit +
      nutrientsTracker.proteinsLimit +
      nutrientsTracker.fatsLimit;
    summary.actualCarbsPercentage = nutrientSums.carbohydrates / actualMacroSum;
    summary.actualProteinsPercentage = nutrientSums.proteins / actualMacroSum;
    summary.actualFatsPercentage = nutrientSums.fats / actualMacroSum;
    summary.targetCarbsPercentage =
      nutrientsTracker.carbohydratesLimit / targetMacroSum;
    summary.targetProteinsPercentage =
      nutrientsTracker.proteinsLimit / targetMacroSum;
    summary.targetFatsPercentage = nutrientsTracker.fatsLimit / targetMacroSum;
    summary.minutesExercising = averageMinutesExercising;
    summary.totalCaloriesIntake = averageCaloriesIntake;
    summary.totalCaloriesBurned = averageCaloriesBurned;
    summary.macroNutrients = {
      carbohydrates: averageCarbohydrates,
      proteins: averageProteins,
      fats: averageFats,
      fiber: averageFiber,
      sodium: averageSodium,
      naturalSugar: averageNaturalSugar,
      addedSugar: averageAddedSugar,
      calcium: averageCalcium,
      magnesium: averageMagnesium,
      iron: averageIron,
      potassium: averagePotassium,
      omega_3: averageOmega_3,
      cholesterol: averageCholesterol,
      zinc: averageZinc,
      vitaminD: averageVitaminD,
      vitaminB12: averageVitaminB12,
      vitaminC: averageVitaminC,
      vitaminE: averageVitaminE,
    };
    summary.healthGoals = refinedHealthGoals;

    return summary;
  } catch (error: unknown) {
    console.error("Error creating the summary", error);
    throw error;
  }
};
