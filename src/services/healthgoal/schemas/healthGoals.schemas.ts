import { z } from "zod";

export const ValueEnum = z.enum([
  "sodium",
  "calcium",
  "magnesium",
  "carbohydrates",
  "proteins",
  "potassium",
  "iron",
  "fats",
  "sugar",
  "fiber",
  "omega-3",
  "cholesterol",
  "calories_intake",
  "calories_burned",
  "exercise_minutes",
  "exercise_core",
  "exercise_strength",
  "exercise_cardio",
  "exercise_mobility",
  "exercise_high_intensity_interval_training",
  "weight",
  "mindfulness",
  "screen_time",
  "hydration",
  "sleep",
  "vegetables_serving",
  "fruit_serving",
  "caffeine",
  "relaxation",
  "meditation",
  "vitaminC",
  "vitaminD",
  "vitaminB12",
  "vitaminE",
]);
export const HealthGoalCategories = z.enum(["HEALTH", "WELLNESS"]);
export const HealthGoalSchema = z.object({
  healthGoals: z.array(
    z.object({
      description: z.string(),
      category: HealthGoalCategories,
      startingValue: z.string(),
      targetValue: z.string(),
      endDate: z.coerce.date(),
      metrics: z.array(
        z.object({
          description: z.string(),
          targetValue: z.string(),
          unit: z.string(),
          category: z.string(),
          value: ValueEnum,
          frequency: z.string(),
        })
      ),
    })
  ),
  foodsToAvoid: z.array(z.string()),
  foodsToIncrease: z.array(z.string()),
});

// Schema for the overall report
export const patientHealthReportSchema = z.object({
  currentHealthStatusOverview: z.string(),
  exerciseHabitsAndCaloricBalanceAnalysis: z.string(),

  recommendations: z.object({
    dietaryModifications: z.array(z.string()),
    exerciseAdjustments: z.array(z.string()),
    lifestyleChanges: z.array(z.string()),
  }),
  potentialHealthRisksOrConcerns: z.array(
    z.object({
      riskName: z.string(),
      description: z.string(),
    })
  ),
  conclusion: z.string(),
});

export const CaloricNeed = z.object({
  caloricAmount: z.number(),
});

// Tool definitions for OpenAI
export const healthGoalsTool = {
  type: "function" as const,
  function: {
    name: "generateHealthGoals",
    description: "Generate structured health goals with trackable metrics",
    parameters: {
      type: "object",
      properties: {
        healthGoals: {
          type: "array",
          items: {
            type: "object",
            properties: {
              description: { type: "string" },
              category: {
                type: "string",
                enum: ["HEALTH", "WELLNESS"],
              },
              startingValue: { type: "string" },
              targetValue: { type: "string" },
              endDate: { type: "string", format: "date-time" },
              metrics: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    description: { type: "string" },
                    targetValue: { type: "string" },
                    unit: { type: "string" },
                    category: { type: "string" },
                    value: {
                      type: "string",
                      enum: [
                        "sodium",
                        "calcium",
                        "magnesium",
                        "carbohydrates",
                        "proteins",
                        "potassium",
                        "iron",
                        "fats",
                        "sugar",
                        "fiber",
                        "omega-3",
                        "cholesterol",
                        "calories_intake",
                        "calories_burned",
                        "exercise_minutes",
                        "exercise_core",
                        "exercise_strength",
                        "exercise_cardio",
                        "exercise_mobility",
                        "exercise_high_intensity_interval_training",
                        "weight",
                        "mindfulness",
                        "screen_time",
                        "hydration",
                        "sleep",
                        "vegetables_serving",
                        "fruit_serving",
                        "caffeine",
                        "relaxation",
                        "meditation",
                        "vitaminC",
                        "vitaminD",
                        "vitaminB12",
                        "vitaminE",
                      ],
                    },
                    frequency: { type: "string" },
                  },
                  required: [
                    "description",
                    "targetValue",
                    "unit",
                    "category",
                    "value",
                    "frequency",
                  ],
                },
              },
            },
            required: [
              "description",
              "category",
              "startingValue",
              "targetValue",
              "endDate",
              "metrics",
            ],
          },
        },
        // foodsToAvoid: {
        //   type: "array",
        //   items: { type: "string" },
        // },
        // foodsToIncrease: {
        //   type: "array",
        //   items: { type: "string" },
        // },
      },
      required: ["healthGoals", "foodsToAvoid", "foodsToIncrease"],
    },
  },
};

export const caloricNeedTool = {
  type: "function" as const,
  function: {
    name: "calculateCaloricNeed",
    description: "Calculate the daily caloric needs of a patient",
    parameters: {
      type: "object",
      properties: {
        caloricAmount: { type: "number" },
      },
      required: ["caloricAmount"],
    },
  },
};

export const patientHealthReportTool = {
  type: "function" as const,
  function: {
    name: "generatePatientHealthReport",
    description: "Generate a comprehensive medical report for a patient",
    parameters: {
      type: "object",
      properties: {
        currentHealthStatusOverview: { type: "string" },
        exerciseHabitsAndCaloricBalanceAnalysis: { type: "string" },
        recommendations: {
          type: "object",
          properties: {
            dietaryModifications: {
              type: "array",
              items: { type: "string" },
            },
            exerciseAdjustments: {
              type: "array",
              items: { type: "string" },
            },
            lifestyleChanges: {
              type: "array",
              items: { type: "string" },
            },
          },
          required: [
            "dietaryModifications",
            "exerciseAdjustments",
            "lifestyleChanges",
          ],
        },
        potentialHealthRisksOrConcerns: {
          type: "array",
          items: {
            type: "object",
            properties: {
              riskName: { type: "string" },
              description: { type: "string" },
            },
            required: ["riskName", "description"],
          },
        },
        conclusion: { type: "string" },
      },
      required: [
        "currentHealthStatusOverview",
        "exerciseHabitsAndCaloricBalanceAnalysis",
        "recommendations",
        "potentialHealthRisksOrConcerns",
        "conclusion",
      ],
    },
  },
};
