import { getPatientById } from "../patient/model/patient.model";
import axios from "axios";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { foodInfoSchema } from "./utile.schema";
import { z } from "zod";
import fs from "fs";
import path from "path";
import prisma from "../../utility/prismaClient";

const apiKey = process.env.REACT_APP_OPENAI_API_KEY;
const openai = new OpenAI({
  apiKey: apiKey || "",
});
require("dotenv").config();
export class UtilsService {
  async getInstacartRetailers(postalCode: string, token: String) {
    try {
      const url = `https://connect.instacart.com/idp/v1/retailers?postal_code=${postalCode}&country_code=US`;
      // const url = `https://connect.dev.instacart.tools/idp/v1/retailers?postal_code=${postalCode}&country_code=US`;
      const response = await axios.get(url, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          // "X-Instacart-Env": "production",
        },
      });
      // console.log("Retailers:", response.data);
      if (response.data) return response.data;
    } catch (error: any) {
      if (error.response?.data?.error?.errors) {
        console.error(
          "Detailed validation errors:",
          JSON.stringify(error.response.data.error.errors, null, 2)
        );
      } else {
        console.error(
          "Error fetching instacart retailers:",
          error.response?.data || error
        );
      }
      throw error;
    }
  }

  async getFoodInfoFromImage(base64Image: string, patientId: string) {
    // 1. Load patient profile
    const patient = await getPatientById(patientId);
    const allergies: string[] =
      patient.patientSummary?.allergies?.map((a) => a.allergy.substance) ?? [];
    const conditions: string[] =
      patient.patientSummary?.conditions?.map((c) => c.condition.name) ?? [];
    const medications: string[] =
      patient.patientSummary?.medications?.map((m) => m.medication.name) ?? [];

    // 2. Full schema explanation in the system prompt
    const systemMessage = `
  You are an AI assistant.  Always respond with JSON matching this Zod schema exactly:
  
  z.object({
    foodName:           z.string(),  // Name of the product/dish
    estimatedCalories:  z.number(),  // Total kcal fper serving/package
    nutrients:          z.object({                  
      carbs:            z.number(),  // Carbs in grams per serving
      proteins:         z.number(),  // Proteins in grams per serving
      fats:             z.number(),  // Fats in grams per serving
    }),
    glycemicIndex:      z.number(),  // Glycemic index value
    isProcessedFood:    z.boolean(), // true if is processed food
    healthScore:        z.number().int().min(1).max(5), 
                                            // Overall 1–5 healthiness score for this patient
    conditionScores: {
      z.string(), // Condition name, e.g. "Diabetes"
      z.number() // 1–5 impact score per condition
    ingredients:        z.array(z.string()), // List of ingredients
    warnings:           z.array(z.string()),        // e.g. ["containes elevated sugar","containe elevated sodiumd etc"]
    medicationInteractions: z.array(z.string()),    // Drug–food interaction alerts
    personalizedFeedback: z.object({          // Tailored advice
      healthierAlternatives: z.string(),             //considering your conditions try to swap it for [healtier product] if there are any conditions, or generally recommend an alternative
      nutritionAdvice:      z.string(),     //e.g this is very good for your [condition name] because..., or this is not ideal for your [condition name] because ....limit to not more then 500 char
    }),
  });
  `;

    // 3. The user prompt with patient data & instructions
    const userPrompt = `
  Patient Profile:
  - Allergies:  ${allergies.length ? allergies.join(", ") : "None"}
  - Conditions: ${conditions.length ? conditions.join(", ") : "None"}
  - Medications:${medications.length ? medications.join(", ") : "None"}
  
  Instructions:
  1. Identify the food product in the image,***ENSURE to stick with nutrition information shown in the image when applicable***.
  2. Provide **estimatedCalories** per serving.
  3. Break out **nutrients** into grams of carbs, proteins, and fats per serving (make sure are as much accurate as possible).
  4. Specify its **glycemicIndex**.
  5. Flag **isProcessedFood** true/false.
  6. Compute **healthScore** (1–5) for overall healthiness for THIS patient.
  7. For each condition, assign a **conditionScores[condition]** (1–5) indicating how this product is good for your condition (1 very bad-5 very good).
  8. List all likely **ingredients**.
  9. Generate **warnings** specifically for any of the patient's conditions (e.g. "Not recommended for Diabetes").
  10. Note any **medicationInteractions**.
  11. Under **personalizedRecommendations**, suggest:
      • **healthierAlternatives**
      • **nutritionAdvice**:***Ensure nutrition advice is limited and related to the product only, do not include exercise or general health recommendations. Only recommendation related to the product***
  
  Remember: output JSON only, matching the schema exactly.
  `;

    // 4. Call the model
    const response = await openai.beta.chat.completions.parse({
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 8192,
      messages: [
        { role: "system", content: systemMessage.trim() },
        {
          role: "user",
          content: [
            { type: "text", text: userPrompt.trim() },
            { type: "image_url", image_url: { url: base64Image } },
          ],
        },
      ],
      response_format: zodResponseFormat(foodInfoSchema, "food_info_schema"),
    });

    // 5. Validate & return
    const parsed = response.choices[0].message.parsed;
    return parsed;
  }

  async transcribeAudioFile(): Promise<string> {
    const audioFilePath = path.join(__dirname, "../../R20250516024124.WAV");
    try {
      const audioStream = fs.createReadStream(audioFilePath);
      const response = await openai.audio.transcriptions.create({
        model: "gpt-4o-mini-transcribe",
        file: audioStream,
        response_format: "text",
      });
      return response;
    } catch (error: unknown) {
      console.error("Error transcribing audio file", error);
      throw error;
    }
  }

  async validatePromoCode(code: string) {
    try {
      const promoCode = await prisma.promoCode.findMany({
        where: {
          code: code,
          isActive: true,
          isDeleted: false,
        },
      });
      if (promoCode.length === 0) {
        return {
          isValid: false,
          message: "Invalid promo code",
        };
      }
      return {
        isValid: true,
        message: "Promo code is valid",
      };
    } catch (error: unknown) {
      console.error("Error validating promo code", error);
      throw error;
    }
  }
  // create promo code
  async createPromoCode(code: string) {
    console.log("code", code);
    try {
      const existingPromoCode = await prisma.promoCode.findUnique({
        where: { code: code, isActive: true, isDeleted: false },
      });
      if (existingPromoCode) {
        return {
          isValid: false,
          message: "Promo code already exists",
        };
      }
      return await prisma.promoCode.create({
        data: { code: code, isActive: false, isDeleted: false },
      });
    } catch (error: unknown) {
      console.error("Error creating promo code", error);
      throw error;
    }
  }
}

export default new UtilsService();
