import { z } from "zod";

export const conditionScoreItemSchema = z.object({
  condition: z.string(),
  score: z.number(),
});

export const foodInfoSchema = z.object({
  foodName: z.string(),
  estimatedCalories: z.number(),
  nutrients: z.object({
    carbs: z.number(),
    proteins: z.number(),
    fats: z.number(),
  }),
  glycemicIndex: z.number(),
  isProcessedFood: z.boolean(),
  healthScore: z.number(),
  conditionScores: z.array(conditionScoreItemSchema),
  ingredients: z.array(z.string()),
  warnings: z.array(z.string()),
  medicationInteractions: z.array(z.string()),
  personalizedFeedback: z.object({
    healthierAlternatives: z.string(),
    nutritionAdvice: z.string(),
  }),
});
