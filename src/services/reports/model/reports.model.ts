import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import HealthGoalService from "../../healthgoal/model/healthGoals.model";
import { zodTextFormat } from "openai/helpers/zod";
import {
  checkupReportSchema,
  patientWeeklyReportSchema,
} from "../schemas/reports.schema";
import ExercisesService from "../../exercises_tracker/model/exercises.model";
import CaloriesService from "../../calories_tracker/model/calories.model";
import WeightService from "../../weight_tracker/model/weight.model";
import GlucoseService from "../../glucose_tracker/model/glucose.model";
import NutrientsService from "../../nutrition/model/nutrition.model";
import BPService from "../../bp_tracker/model/bloodpressure.model";
import moment from "moment";
import { getPatientById } from "../../patient/model/patient.model";
import { generateWeeklyMedicalReportPrompt } from "../prompts/reports_prompts";
import { getPreviousWeekRange, getWeekRange } from "../../../utils/formatDate";
import { calculateScores } from "../../../utils/healthScores";
import prisma from "../../../utility/prismaClient";
import { MacroNutrients } from "../../../types";
import {
  analyzeBloodPressureTracker,
  analyzeGlucoseTracker,
} from "../../../utility/trackers_data_aggregation/data_aggregation";
import { calculateAgeFromDob } from "../../../utils/calculateAgefromDob";
import { CHECKUP_REPORT_PROMPT } from "../prompts/reports.prompts";
const apiKey = process.env.REACT_APP_OPENAI_API_KEY;
const openai = new OpenAI({
  apiKey: apiKey || "",
});
class ReportsService {
  async createSummaryToAnalyze(patientId: string, timeFrame: number) {
    try {
      const whereId = { userId: patientId };
      const patient = await getPatientById(patientId);
      const exercisesTracker = await ExercisesService.getWeeklyExercisesTracker(
        whereId
      );
      const caloriesTracker = await CaloriesService.getCaloriesTracker(whereId);
      const nutrientsTracker = await NutrientsService.getNutrientsTracker(
        whereId
      );
      const weightTracker = (await WeightService.getWeigthTracker(
        patientId
      )) as any;
      const glucoseTracker = await GlucoseService.fetchWeeklyGlucoseTracker(
        patientId
      );
      const bloodPressureTracker = await BPService.fetchWeeklyBPTracker(
        patientId
      );

      const summary = {
        minutesExercising: 0,
        averageCaloriesIntake: 0,
        averageCaloriesBurned: 0,
        glucoseData: {},
        bloodPressureData: {},
        weightTracker: weightTracker.weightEntries,
        macroNutrientsAverage: {},
        patientConditions: patient.patientSummary.conditions.map(
          (c) => c.condition
        ),
        patientTargetCalories: patient.patientSummary.caloricAmount,
        healthGoals: [],
        actualCarbsPercentage: 0,
        actualFatsPercentage: 0,
        actualProteinsPercentage: 0,
        targetCarbsPercentage: 0,
        targetProteinsPercentage: 0,
        targetFatsPercentage: 0,
        averageProcessedFoodCount: 0,
        averageGlycemicLoad: 0,
        averageVegetableServingsCount: 0,
        averageFruitServingsCount: 0,
      };
      const weeksInMonth = timeFrame;
      let totalMinutesExercising = 0;
      let totalCaloriesIntake = 0;
      let totalCaloriesBurned = 0;
      let totalCarbohydrates = 0;
      let totalProteins = 0;
      let totalFats = 0;
      let totalFiber = 0;
      let totalSodium = 0;
      let totalNaturalSugar = 0;
      let totalAddedSugar = 0;
      let totalCalcium = 0;
      let totalMagnesium = 0;
      let totalIron = 0;
      let totalPotassium = 0;
      let totalOmega3 = 0;
      let totalCholesterol = 0;
      let totalZinc = 0;
      let totalVitaminD = 0;
      let totalVitaminB12 = 0;
      let totalVitaminC = 0;
      let totalVitaminE = 0;
      let totalProcessedFood = 0;
      let totalGlycemicLoad = 0;
      let totalVegetableServings = 0;
      let totalFruitServings = 0;
      const { start, end } = getWeekRange(timeFrame);

      // Filter out the current week from exercisesTracker
      const filteredExercisesTracker = exercisesTracker.weeklyEntries.filter(
        (entry) => {
          const entryStartDate = moment(entry.weekStartDate); // Parse weekStartDate
          const entryEndDate = moment(entry.weekEndDate); // Parse weekEndDate
          return (
            entryStartDate.isBetween(start, end, null, "[]") ||
            entryEndDate.isBetween(start, end, null, "[]") ||
            (entryStartDate.isBefore(end) && entryEndDate.isAfter(start))
          );
        }
      );
      // Filter out the  weeks from glucose tracker
      const filteredGlucoseTracker = glucoseTracker.weeklyEntries.filter(
        (entry) => {
          const entryStartDate = moment(entry.weekStartDate); // Parse weekStartDate
          const entryEndDate = moment(entry.weekEndDate); // Parse weekEndDate
          return (
            entryStartDate.isBetween(start, end, null, "[]") ||
            entryEndDate.isBetween(start, end, null, "[]") ||
            (entryStartDate.isBefore(end) && entryEndDate.isAfter(start))
          );
        }
      );
      const aggregatedGlucoseData = analyzeGlucoseTracker({
        weeklyEntries: filteredGlucoseTracker,
      });
      // Filter out the  weeks from blood pressure tracker
      const filteredBPTracker = bloodPressureTracker.weeklyEntries.filter(
        (entry) => {
          const entryStartDate = moment(entry.weekStartDate); // Parse weekStartDate
          const entryEndDate = moment(entry.weekEndDate); // Parse weekEndDate
          return (
            entryStartDate.isBetween(start, end, null, "[]") ||
            entryEndDate.isBetween(start, end, null, "[]") ||
            (entryStartDate.isBefore(end) && entryEndDate.isAfter(start))
          );
        }
      );
      const aggregatedBloodPressureData = analyzeBloodPressureTracker({
        weeklyEntries: filteredBPTracker,
      });
      // Filter out the current week from caloriesTracker
      const filteredCaloriesTracker = caloriesTracker.weeklyEntries.filter(
        (entry) => {
          const entryStartDate = moment(entry.weekStartDate);
          const entryEndDate = moment(entry.weekEndDate);
          return (
            entryStartDate.isBetween(start, end, null, "[]") ||
            entryEndDate.isBetween(start, end, null, "[]") ||
            (entryStartDate.isBefore(end) && entryEndDate.isAfter(start))
          );
        }
      );

      // Filter out the current week from nutrientsTracker
      const filteredNutrientsTracker = nutrientsTracker.weeklyEntries.filter(
        (entry) => {
          const entryStartDate = moment(entry.weekStartDate);
          const entryEndDate = moment(entry.weekEndDate);
          return (
            entryStartDate.isBetween(start, end, null, "[]") ||
            entryEndDate.isBetween(start, end, null, "[]") ||
            (entryStartDate.isBefore(end) && entryEndDate.isAfter(start))
          );
        }
      );

      // Update the calculations to use the filtered trackers
      const weeksCountExercises =
        filteredExercisesTracker.length > 0
          ? Math.min(weeksInMonth, filteredExercisesTracker.length)
          : 0;
      const weeksCountCalories =
        filteredCaloriesTracker.length > 0
          ? Math.min(weeksInMonth, filteredCaloriesTracker.length)
          : 0;
      const weeksCountNutrients =
        filteredNutrientsTracker.length > 0
          ? Math.min(weeksInMonth, filteredNutrientsTracker.length)
          : 0;

      filteredExercisesTracker
        .slice(0, weeksCountExercises)
        .forEach((entry) => {
          totalMinutesExercising += entry.minutesOfExercise;
        });

      filteredCaloriesTracker.slice(0, weeksCountCalories).forEach((entry) => {
        totalCaloriesIntake += entry.totalIntake;
        totalCaloriesBurned += entry.totalBurned;
      });

      filteredNutrientsTracker
        .slice(0, weeksCountNutrients)
        .forEach((entry) => {
          totalCarbohydrates += entry.carbohydrates || 0;
          totalProteins += entry.proteins || 0;
          totalFats += entry.fats || 0;
          totalFiber += entry.fiber || 0;
          totalSodium += entry.sodium || 0;
          totalNaturalSugar += entry.naturalSugar || 0;
          totalAddedSugar += entry.addedSugar || 0;
          totalCalcium += entry.calcium || 0;
          totalMagnesium += entry.magnesium || 0;
          totalIron += entry.iron || 0;
          totalPotassium += entry.potassium || 0;
          totalOmega3 += entry.omega_3 || 0;
          totalCholesterol += entry.cholesterol || 0;
          totalZinc += entry.zinc || 0;
          totalVitaminD += entry.vitaminD || 0;
          totalVitaminB12 += entry.vitaminB12 || 0;
          totalVitaminC += entry.vitaminC || 0;
          totalVitaminE += entry.vitaminE || 0;
          totalProcessedFood += entry.processedFoodCount || 0;
          totalGlycemicLoad += entry.glycemicLoad || 0;
          totalVegetableServings += entry.vegetableServings || 0;
          totalFruitServings += entry.fruitServings || 0;
        });

      const averageMinutesExercising =
        weeksCountExercises > 0
          ? totalMinutesExercising / weeksCountExercises
          : 0;
      const averageCaloriesIntake =
        weeksCountCalories > 0 ? totalCaloriesIntake / weeksCountCalories : 0;
      const averageCaloriesBurned =
        weeksCountCalories > 0 ? totalCaloriesBurned / weeksCountCalories : 0;
      const averageCarbohydrates =
        weeksCountNutrients > 0 ? totalCarbohydrates / weeksCountNutrients : 0;
      const averageProteins =
        weeksCountNutrients > 0 ? totalProteins / weeksCountNutrients : 0;
      const averageFats =
        weeksCountNutrients > 0 ? totalFats / weeksCountNutrients : 0;
      const averageFiber =
        weeksCountNutrients > 0 ? totalFiber / weeksCountNutrients : 0;
      const averageSodium =
        weeksCountNutrients > 0 ? totalSodium / weeksCountNutrients : 0;
      const averageNaturalSugar =
        weeksCountNutrients > 0 ? totalNaturalSugar / weeksCountNutrients : 0;
      const averageAddedSugar =
        weeksCountNutrients > 0 ? totalAddedSugar / weeksCountNutrients : 0;
      const averageCalcium =
        weeksCountNutrients > 0 ? totalCalcium / weeksCountNutrients : 0;
      const averageMagnesium =
        weeksCountNutrients > 0 ? totalMagnesium / weeksCountNutrients : 0;
      const averageIron =
        weeksCountNutrients > 0 ? totalIron / weeksCountNutrients : 0;
      const averagePotassium =
        weeksCountNutrients > 0 ? totalPotassium / weeksCountNutrients : 0;
      const averageOmega3 =
        weeksCountNutrients > 0 ? totalOmega3 / weeksCountNutrients : 0;
      const averageCholesterol =
        weeksCountNutrients > 0 ? totalCholesterol / weeksCountNutrients : 0;
      const averageZinc =
        weeksCountNutrients > 0 ? totalZinc / weeksCountNutrients : 0;
      const averageVitaminD =
        weeksCountNutrients > 0 ? totalVitaminD / weeksCountNutrients : 0;
      const averageVitaminB12 =
        weeksCountNutrients > 0 ? totalVitaminB12 / weeksCountNutrients : 0;
      const averageVitaminC =
        weeksCountNutrients > 0 ? totalVitaminC / weeksCountNutrients : 0;
      const averageVitaminE =
        weeksCountNutrients > 0 ? totalVitaminE / weeksCountNutrients : 0;
      const averageProcessFoudCount =
        weeksCountNutrients > 0 ? totalProcessedFood / weeksCountNutrients : 0;
      const averageGlycemicLoad =
        weeksCountNutrients > 0 ? totalGlycemicLoad / weeksCountNutrients : 0;
      const averageVegetableServingsCount =
        weeksCountNutrients > 0
          ? totalVegetableServings / weeksCountNutrients
          : 0;
      const averageFruitServingsCount =
        weeksCountNutrients > 0 ? totalFruitServings / weeksCountNutrients : 0;
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
      summary.actualCarbsPercentage =
        totalCarbohydrates / (totalCarbohydrates + totalProteins + totalFats);
      summary.actualProteinsPercentage =
        totalProteins / (totalCarbohydrates + totalProteins + totalFats);
      summary.actualFatsPercentage =
        totalFats / (totalCarbohydrates + totalProteins + totalFats);
      summary.targetCarbsPercentage =
        nutrientsTracker.carbohydratesLimit /
        (nutrientsTracker.carbohydratesLimit +
          nutrientsTracker.proteinsLimit +
          nutrientsTracker.fatsLimit);
      summary.targetProteinsPercentage =
        nutrientsTracker.proteinsLimit /
        (nutrientsTracker.carbohydratesLimit +
          nutrientsTracker.proteinsLimit +
          nutrientsTracker.fatsLimit);
      summary.targetFatsPercentage =
        nutrientsTracker.fatsLimit /
        (nutrientsTracker.carbohydratesLimit +
          nutrientsTracker.proteinsLimit +
          nutrientsTracker.fatsLimit);
      summary.minutesExercising = averageMinutesExercising;
      summary.averageCaloriesIntake = averageCaloriesIntake;
      summary.averageCaloriesBurned = averageCaloriesBurned;
      summary.macroNutrientsAverage = {
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
        omega_3: averageOmega3,
        cholesterol: averageCholesterol,
        zinc: averageZinc,
        vitaminD: averageVitaminD,
        vitaminB12: averageVitaminB12,
        vitaminC: averageVitaminC,
        vitaminE: averageVitaminE,
      };
      (summary.averageProcessedFoodCount = averageProcessFoudCount),
        (summary.averageGlycemicLoad = averageGlycemicLoad),
        (summary.averageFruitServingsCount = averageFruitServingsCount),
        (summary.averageVegetableServingsCount = averageVegetableServingsCount);
      summary.glucoseData = aggregatedGlucoseData;
      summary.bloodPressureData = aggregatedBloodPressureData;
      // summary.healthGoals = refinedHealthGoals;

      console.log("summary:", JSON.stringify(summary));
      return summary;
    } catch (error: unknown) {
      console.error("Error creating the summary", error);
      throw error;
    }
  }

  async generateWeeklyReport(
    patientId: string,
    hrv: any,
    hrv_baseline: number,
    heart_rate: any,
    heart_rate_baseline: number,
    resting_heart_rate: any,
    resting_heart_rate_baseline: number,
    workouts: any,
    sleep: any,
    steps: any,
    minutes_exercising: any
  ) {
    try {
      const summary = await this.createSummaryToAnalyze(patientId, 1);
      if (summary) {
        const metrics = {
          hrv,
          hrv_baseline,
          heart_rate,
          heart_rate_baseline,
          resting_heart_rate,
          resting_heart_rate_baseline,
          workouts,
          sleep,
          steps,
          minutes_exercising,
          totalCaloriesBurned: summary.averageCaloriesBurned,
          totalCaloriesIntake: summary.averageCaloriesIntake,
        };
        const scores = calculateScores(
          metrics,
          summary.targetCarbsPercentage,
          summary.targetProteinsPercentage,
          summary.targetFatsPercentage,
          summary.actualCarbsPercentage,
          summary.actualProteinsPercentage,
          summary.actualFatsPercentage
        );

        const macroNutrients = summary.macroNutrientsAverage as MacroNutrients;

        const completion = await openai.responses.parse({
          model: "gpt-4o-mini",
          input: [
            {
              role: "system",
              content: generateWeeklyMedicalReportPrompt.system_content,
            },
            {
              role: "user",
              content: `
                Daily Macronutrient Averages:${JSON.stringify({
                  carbohydrates: (macroNutrients.carbohydrates / 7).toFixed(1),
                  proteins: (macroNutrients.proteins / 7).toFixed(1),
                  fats: (macroNutrients.fats / 7).toFixed(1),
                  fiber: (macroNutrients.fiber / 7).toFixed(1),
                  sodium: (macroNutrients.sodium / 7).toFixed(1),
                  naturalSugar: (macroNutrients.naturalSugar / 7).toFixed(1),
                  addedSugar: (macroNutrients.addedSugar / 7).toFixed(1),
                  calcium: (macroNutrients.calcium / 7).toFixed(1),
                  magnesium: (macroNutrients.magnesium / 7).toFixed(1),
                })}
                Daily Calories Burned (Average): ${(
                  summary.averageCaloriesBurned / 7
                ).toFixed(1)}
                Daily Calories Intake (Average): ${(
                  summary.averageCaloriesIntake / 7
                ).toFixed(1)}
                Daily Patient Target Calories:${JSON.stringify(
                  summary.patientTargetCalories
                )}
                Patient Health Goals:${JSON.stringify(summary.healthGoals)}
                Patient Weight Tracker:${JSON.stringify(summary.weightTracker)}
                HRV:${JSON.stringify(hrv)}
                HRV Baseline:${hrv_baseline}
                Heart Rate:${JSON.stringify(heart_rate)}
                Heart Rate Baseline:${heart_rate_baseline}
                Resting Heart Rate:${JSON.stringify(resting_heart_rate)}
                Resting Heart Rate Baseline:${resting_heart_rate_baseline}
                Workouts:${JSON.stringify(workouts)}
                Sleep:${JSON.stringify(sleep)}
                Steps:${JSON.stringify(steps)}
                Minutes of Exercise:${JSON.stringify(minutes_exercising)}
                Scores:${JSON.stringify(scores)}
              `,
            },
          ],
          text: {
            format: zodTextFormat(patientWeeklyReportSchema, "report_schema"),
          },
        });
        const report = completion.output_parsed;
        await this.saveWeeklyReportInDB(report, patientId);
        return report;
      }
    } catch (error: unknown) {
      console.error("Error generating the report", error);
      throw error;
    }
  }

  async saveWeeklyReportInDB(reportData: any, patientId: string) {
    const { healthGoalProgress } = reportData;
    const { start, end } = getPreviousWeekRange();
    try {
      const result = await prisma.$transaction(async (prisma) => {
        // Create Weekly Report
        const weeklyReport = await prisma.weeklyReport.create({
          data: {
            userId: patientId,
            healthScore: reportData.healthScore,
            weekStartDate: start,
            weekEndDate: end,
          },
        });

        // Create Health Goal Progress
        const healthGoalProgressPromises = healthGoalProgress.map((goal) => {
          return prisma.healthGoalProgress.create({
            data: {
              healthGoalName: goal.healthGoalName,
              healthGoalId: goal.healthGoalId,
              healthGoalPercentageCompletion:
                goal.healthGoalPercentageCompletion,
              weeklyReportId: weeklyReport.id,
            },
          });
        });

        // Create Nutrition Score
        const nutritionScore = prisma.nutritionScore.create({
          data: {
            nutritionScore: reportData.nutritionScore.nutritionScore,
            macronutrientBalanceScore:
              reportData.nutritionScore.macronutrientBalanceScore,
            caloricIntakeScore: reportData.nutritionScore.caloricIntakeScore,
            dietQualityScore: reportData.nutritionScore.dietQualityScore,
            nutritionFeedback: reportData.nutritionScore.nutritionFeedback,
            weeklyReportId: weeklyReport.id,
          },
        });

        // Create Exercise Score
        const exerciseScore = prisma.exerciseScore.create({
          data: {
            exerciseScore: reportData.exerciseScore.exerciseScore,
            consistencyScore: reportData.exerciseScore.consistencyScore,
            weeklyActivityScore: reportData.exerciseScore.weeklyActivityScore,
            exerciseFeedback: reportData.exerciseScore.exerciseFeedback,
            weeklyReportId: weeklyReport.id,
          },
        });

        // Create Sleep Score
        const sleepScore = prisma.sleepScore.create({
          data: {
            sleepScore: reportData.sleepScore.sleepScore,
            durationScore: reportData.sleepScore.durationScore,
            qualityScore: reportData.sleepScore.qualityScore,
            consistencyScore: reportData.sleepScore.consistencyScore,
            sleepFeedback: reportData.sleepScore.sleepFeedback,
            weeklyReportId: weeklyReport.id,
          },
        });

        // Create Stress Score
        const stressScore = prisma.stressScore.create({
          data: {
            stressScore: reportData.stressScore.stressScore,
            hrvScore: reportData.stressScore.hrvScore,
            restingHrvScore: reportData.stressScore.restingHrvScore,
            stressFeedback: reportData.stressScore.stressFeedback,
            weeklyReportId: weeklyReport.id,
          },
        });

        // Run all promises in parallel
        await Promise.all([
          ...healthGoalProgressPromises,
          nutritionScore,
          exerciseScore,
          sleepScore,
          stressScore,
        ]);

        return weeklyReport;
      });

      console.log("Weekly report saved successfully:", result);
    } catch (error: unknown) {
      console.error("Error saving the health report:", error);
      throw error;
    }
  }
  // fetch reports
  async fetchReportsWhere(whereObj: object) {
    try {
      return await prisma.weeklyReport.findMany({
        where: whereObj,
        include: {
          healthGoalProgress: true,
          nutritionScore: true,
          exerciseScore: true,
          sleepScore: true,
          stressScore: true,
        },
      });
    } catch (error: unknown) {
      console.error("Error fetching the reports", error);
      throw error;
    }
  }
  //delete report by id
  async deleteReportById(reportId: string) {
    try {
      return await prisma.weeklyReport.delete({
        where: { id: reportId },
      });
    } catch (error: unknown) {
      console.error("Error deleting the report", error);
      throw error;
    }
  }

  // monthly report for the doctor
  //use patient data to generate checkup report
  async createCheckupReport(reportData: any) {
    try {
      const report = await prisma.healthCheckUp.create({
        data: reportData,
      });
      if (report) return report;
    } catch (error: unknown) {
      console.error("Error creating the checkup report", error);
      throw error;
    }
  }
  async generatePatientCheckupReport(patientId: string, timeFrame: number) {
    try {
      const patient = await getPatientById(patientId);
      const { gender, dob } = patient;
      const patientSummary = await this.createSummaryToAnalyze(
        patientId,
        timeFrame
      );

      const userPayload = {
        patientGender: gender,
        patientAge: calculateAgeFromDob(dob),
        patientSummary: patientSummary,
      };

      const compeltion = await openai.responses.parse({
        model: "gpt-4o-mini",
        temperature: 0,
        input: [
          { role: "system", content: CHECKUP_REPORT_PROMPT },
          { role: "user", content: JSON.stringify(userPayload) },
        ],
        text: {
          format: zodTextFormat(checkupReportSchema, "checkup_report_schema"),
        },
      });

      return compeltion.output_parsed;
    } catch (error: unknown) {
      console.error("Error generating checkup report", error);
      throw error;
    }
  }

  async generateAndSaveCheckupReport(patientId: string, timeFrame: number = 4) {
    try {
      const checkupReport = await this.generatePatientCheckupReport(
        patientId,
        timeFrame
      );
      if (!checkupReport) {
        throw new Error("Error generating checkup report");
      }
      const { start, end } = getWeekRange(timeFrame);
      const reportData = {
        ...checkupReport,
        patientId: patientId,
        periodStart: start,
        periodEnd: end,
      };
      const savedReport = await this.createCheckupReport(reportData);
      if (savedReport) {
        return savedReport;
      }
    } catch (error: unknown) {
      console.error("Error generating checkup report", error);
      throw error;
    }
  }
}
export default new ReportsService();
