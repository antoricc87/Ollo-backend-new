import { z } from "zod";

export const patientWeeklyReportSchema = z.object({
  healthGoalProgress: z.array(
    z.object({
      healthGoalName: z.string(),
      healthGoalId: z.string(),
      healthGoalPercentageCompletion: z.number(),
    })
  ),
  healthScore: z.number(),
  nutritionScore: z.object({
    nutritionScore: z.number(),
    macronutrientBalanceScore: z.number(),
    caloricIntakeScore: z.number(),
    dietQualityScore: z.number(),
    nutritionFeedback: z.string(),
  }),
  exerciseScore: z.object({
    exerciseScore: z.number(),
    consistencyScore: z.number(),
    weeklyActivityScore: z.number(),
    exerciseFeedback: z.string(),
  }),
  sleepScore: z.object({
    sleepScore: z.number(),
    durationScore: z.number(),
    qualityScore: z.number(),
    consistencyScore: z.number(),
    sleepFeedback: z.string(),
  }),
  stressScore: z.object({
    stressScore: z.number(),
    hrvScore: z.number(),
    restingHrvScore: z.number(),
    stressFeedback: z.string(),
  }),
});
export const CaloricNeed = z.object({
  caloricAmount: z.number(),
});
export enum FlaggedAreas {
  GLUCOSE = "GLUCOSE",
  CALORIES = "CALORIES",
  NUTRIENTS = "NUTRIENTS",
  SODIUM = "SODIUM",
  CHOLESTEROL = "CHOLESTEROL",
  SUGAR = "SUGAR",
  SLEEP = "SLEEP",
  WEIGHT = "WEIGHT",
  BLOODPRESSURE = "BLOODPRESSURE",
}

const NutritionSchema = z.object({
  recommendations: z.string(),
  overallReport: z.string(),
});
const HealthSchema = z.object({
  recommendations: z.string(),
  overallReport: z.string(),
});
const CheckupReport = z.object({
  nutrition: NutritionSchema,
  health: HealthSchema,
});
export const checkupReportSchema = z.object({
  checkupReport: CheckupReport,
  flaggedAreas: z.array(z.nativeEnum(FlaggedAreas)),
  flaggedAreasReasons: z.array(z.string()),
});
