import { z } from "zod";

export const questionSchema = z.object({
  question: z.string(),
  options: z.array(z.string()),
});

export const questionSchemaArray = z.object({
  questions: z.array(questionSchema),
});

export const diagnosisResponseSchema = z.object({
  mostLikelyDiagnosis: z.string(),
  differentialDiagnosis: z.array(z.string()),
  recommendations: z.string(),
  potentialTests: z.array(z.string()),
  correlations: z.array(z.string()),
});
