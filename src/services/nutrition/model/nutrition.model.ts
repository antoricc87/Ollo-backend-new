import { FoodEntry } from "@prisma/client";
import dotenv from "dotenv";
import moment from "moment";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { Nutrients } from "../../../types";
import prisma from "../../../utility/prismaClient";
import { calculateAgeFromDob } from "../../../utils/calculateAgefromDob";
import { generateNutrientValues } from "../../../utils/calculateMissingNutrientsAndCalories";
import { calculateTDEE } from "../../../utils/calculateTDEE";
import {
  getCurrentWeekRange,
  getCurrentWeekRangeFromDate,
  getPreviousWeekRange,
} from "../../../utils/formatDate";
import CaloriesService from "../../calories_tracker/model/calories.model";
import {
  getPatientById,
  updatePatientSummarySection,
} from "../../patient/model/patient.model";
import {
  nutrientLimitSchema,
  nutrientLimitTool,
  portionResponseTool,
} from "../schemas/nutrition.schema";
import { getUserToken } from "../../../utils/auth_token";
import { calculateCaloricAdjustment } from "../../../utils/calculateAdjustedTDEE";
dotenv.config();

//initiating openai instance
const apiKey = process.env.REACT_APP_OPENAI_API_KEY;
const openai = new OpenAI({
  apiKey: apiKey || "",
});

class NutritionService {
  async generatePortionsFromAI(
    mealType: string,
    caloricAmount: number,
    ingredients: string[]
  ) {
    const mealTypeAllocation = {
      breakfast: 0.275,
      snack: 0.1,
      lunch: 0.325,
      dinner: 0.375,
    };

    const mealCaloricTarget = Math.round(
      caloricAmount * (mealTypeAllocation[mealType.toLowerCase()] || 0.3) // Default to 30% if mealType is invalid
    );

    const prompt = `
    Generate portions for a ${mealType} meal with a total caloric target of ${mealCaloricTarget} kcal.
    Use the following ingredients: ${ingredients.join(", ")}.
    Distribute the calories proportionally across all ingredients to meet the caloric target of ${mealCaloricTarget} kcal.
    Ensure the total calories of all ingredients combined do not exceed ${mealCaloricTarget} kcal.
    For each ingredient, provide the quantity in grams, its respective calories, and the micro and macro nutrients contained in the ingredient. 
    For nutrients, calculate always in decimal numbers and always in grams except for sodium, calcium, iron, potassium, cholesterol, zinc, magnesium, vitamin C and vitamin E in mg, and vitamin D and vitamin B12 in µg (micrograms).
    Ensure the amount and calories provided are related and never 0.
    Ensure to alway use the unit, if not specified by the user use g as default.
    Generate a meal name based on the ingredients provided.
  `;

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0,
        messages: [
          {
            role: "system",
            content: `You are a nutritional assistant generating portions based on user-selected ingredients.`,
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        tools: [portionResponseTool],
        tool_choice: {
          type: "function",
          function: { name: "generatePortions" },
        },
      });

      const toolCall = response.choices[0].message.tool_calls?.[0];
      if (!toolCall) {
        throw new Error("No structured output returned");
      }

      const portions = JSON.parse(toolCall.function.arguments);
      return portions;
    } catch (error: unknown) {
      console.error("Error generating the meal plans with openai", error);
      throw error;
    }
  }

  async generateNutrientsTotalAmount(patientId: string) {
    try {
      const patient = await getPatientById(patientId);

      const healthGoals = await prisma.healthGoal.findMany({
        where: {
          patientId,
          NOT: {
            status: {
              in: ["ACHIEVED", "NOT_ACHIEVED"],
            },
          },
        },
        include: {
          trackableMetrics: true,
        },
      });
      const systemContent = `You are an advanced dietitian assistant responsible for determining the optimal daily nutrient intake for a patient. Please use the following information:

      - Medical Summary: ${patient.patientSummary}
      - Health Goals and Trackable Metrics: ${JSON.stringify(healthGoals)}
      
      Instructions:
      1. If there are health goals related to body composition (e.g., weight gain/loss, fat/muscle increase/decrease), adjust the caloric amount accordingly. Otherwise, use the provided caloric amount.
      2. Based on the adjusted caloric amount, patient summary, and health goals, calculate the recommended daily protein intake.
      3. After determining the protein amount, calculate the appropriate daily intake for other macronutrients and micronutrients.
      4. Ensure that all estimates are based on the patient's medical summary, particularly their conditions and health goals.
      
      The output should be in JSON format, including:
      - Grams for carbohydrates, proteins, fats, fiber, natural sugars, and added sugars.
      - Milligrams for sodium, calcium, iron, potassium, cholesterol, zinc, magnesium, vitamin C and vitamin E.
      - Micrograms (µg) for vitamin D and vitamin B12.

      Ensure that the total amounts of macronutrients align with the updated caloric amount.
      `;

      const userContent =
        "Update the patient's caloric amount if necessary, based on their summary and health goals. Calculate the recommended daily nutrient amounts, taking into account medical conditions and selected health goals.";

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemContent },
          { role: "user", content: userContent },
        ],
        tools: [nutrientLimitTool],
        tool_choice: {
          type: "function",
          function: { name: "generateNutrientLimits" },
        },
      });

      const toolCall = response.choices[0].message.tool_calls?.[0];
      if (!toolCall) {
        throw new Error("No structured output returned");
      }

      let recommendedAmounts = JSON.parse(toolCall.function.arguments);

      // Post-processing: enforce target values from trackableMetrics
      healthGoals.forEach((goal) => {
        goal.trackableMetrics.forEach((metric) => {
          const nutrient = metric.value.toLowerCase(); // Match nutrient key
          if (recommendedAmounts.hasOwnProperty(nutrient)) {
            recommendedAmounts[nutrient] = metric.targetValue; // Override with target value
          }
        });
      });

      const { explanation, caloricAmount, ...nutrientLimits } =
        recommendedAmounts;
      return nutrientLimits;
    } catch (error) {
      console.error("Error generating nutrients amount");
      throw error;
    }
  }

  async generateOptimalCalories(
    patientId: string,
    tdee: number,
    healthGoals: string[],
    pace?: "slow" | "moderate" | "aggressive"
  ): Promise<string> {
    try {
      const patient = await getPatientById(patientId);
      const age = calculateAgeFromDob(patient.dob);
      const weight = patient.patientSummary.vitals.weight;
      const weightUnit = patient.patientSummary.vitals.weight_unit;
      const height = patient.patientSummary.vitals.height;
      const heightUnit = patient.patientSummary.vitals.height_unit;
      const weightInKg = weightUnit === "kg" ? weight : weight / 2.20462;
      const heightInCm = heightUnit === "metric" ? height : height * 2.54;
      const calculatedTDEE = calculateTDEE(
        weightInKg,
        heightInCm,
        age,
        patient.gender,
        patient.patientSummary.exercise.frequency
      );
      // let TDEE: number;
      // if (tdee !== 0) {
      //   TDEE = tdee;
      // } else {
      //   TDEE = calculateTDEE(
      //     weightInKg,
      //     heightInCm,
      //     age,
      //     patient.gender,
      //     patient.patientSummary.exercise.frequency
      //   );
      // }
      const TDEE = tdee < calculatedTDEE ? calculatedTDEE : tdee;
      let adjustedCalories = TDEE;
      if (healthGoals.length > 0) {
        adjustedCalories = calculateCaloricAdjustment(
          healthGoals[0], // Assuming the primary goal is the first in the list
          TDEE,
          patient.gender,
          weightInKg,
          pace || "moderate" // Default to "moderate" if no pace is provided
        );
      }
      // ✅ Now using `calculateCaloricAdjustment` to get the adjusted calorie intake

      const systemContent = `
          You are a medical AI assistant that provides dietary recommendations.
          Based on the patient's biometric data, exercise frequency, medical conditions, and health goals,
          calculate the optimal daily caloric intake and macronutrient and micronutrient distribution.
          Ensure the response is concise, structured, and formatted in Markdown for easy readability.
        `;

      const userPrompt = `
          **Patient Information**:
          - Weight: ${weight} ${weightUnit}
          - Height: ${height} ${heightUnit}
          - Age: ${age} years
          - Sex: ${patient.gender}
          - Exercise Frequency: ${patient.patientSummary.exercise.frequency}
          - **Recommended Daily Calories**: ${adjustedCalories} kcal/day
          - Medical Conditions: ${JSON.stringify(
            patient.patientSummary.conditions
          )}
          - **Health Goals**: ${JSON.stringify(healthGoals)}
        
        **Instructions**:
        1. Based on the **Recommended Daily Calories** ${adjustedCalories} and  **Health Goals** calculate the optimal **macronutrient** distribution:
            - Protein: X% of total calories
            - Carbohydrates: Y% of total calories
            - Fats: Z% of total calories
        2. Calculate the **daily recommended intake** for the following **micronutrients**:
              - **Fiber**: 25-38g (adjust based on patient conditions and needs)
              - **Sodium**: ≤2300mg (or lower for conditions like hypertension/CKD)
              - **Natural Sugar** & **Added Sugar**: ≤36g (men) / ≤25g (women) (adjust based on patient conditions and needs)
              - **Calcium**: 1000-1300mg
              - **Magnesium**: 310-420mg
              - **Iron**: 8-18mg (consider gender, menstruation, deficiencies)
              - **Potassium**: 2600-3400mg
              - **Omega-3**: **Consistently set to 1000mg per day**
              - **Cholesterol**: ≤300mg
              - **Zinc**: 8-11mg
              - **Vitamin D**: 600-800 IU
              - **Vitamin C**: 75-90mg
              - **Vitamin B12**: 2.4mcg
              - **Vitamin E**: 15mg

        Ensure all micronutrient recommendations follow these fixed values:
        - If any health goal has a trackable metric related to a specific micronutrient use the value provided in the trackable metric.
        - If a nutrient has a range, use the **midpoint value** unless the patient has specific conditions requiring an adjustment.
        - If a patient's condition affects a nutrient's intake (e.g., kidney disease reducing sodium or potassium, diabetes reducing added sugar), adjust within a **narrower range** but never exceed limits.
        3. Structure the response in the following format:
      
        **Example Output**:
        - **Calories**: ${adjustedCalories} kcal/day. The calories should be exactly the same number as **Recommended Daily Calories** 
        - **Macronutrient Distribution**:
          - Protein: X% (\${proteinGrams}g)
          - Carbs: Y% (\${carbGrams}g)
          - Fats: Z% (\${fatGrams}g)
        - **Micronutrient Recommendations**:
          - Fiber: \${fiberLimit}g
          - Sodium: \${sodiumLimit}mg
          - Natural Sugar: \${naturalSugarLimit}g
          - Added Sugar: \${addedSugarLimit}g
          - Calcium: \${calciumLimit}mg
          - Magnesium: \${magnesiumLimit}mg
          - Iron: \${ironLimit}mg
          - Potassium: \${potassiumLimit}mg
          - Omega-3: \${omega_3Limit}mg
          - Cholesterol: \${cholesterolLimit}mg
          - Zinc: \${zincLimit}mg
          - Vitamin D: \${vitaminDLimit} IU
          - Vitamin C: \${vitaminCLimit}mg
          - Vitamin B12: \${vitaminB12Limit}mcg
          - Vitamin E: \${vitaminELimit}mg
        `;

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: systemContent,
          },
          {
            role: "user",
            content: userPrompt,
          },
        ],
      });

      return completion.choices[0].message.content.trim();
    } catch (error: unknown) {
      console.error("Error generating optimal calories", error);
      throw error; // Rethrow the error after logging it
    }
  }
  //this is used in generate health goals frontend
  async generateNutrientsTotalAmountAndCalories(
    caloricResult: string,
    patientId: string
  ) {
    try {
      // System message content for the OpenAI API
      const systemContent = ` You are a medical AI assistant that processes dietary recommendations.
      Your task is to analyze a given text-based dietary plan and extract numerical values for caloric intake, macronutrient, and micronutrient limits.
      Ensure that all extracted values follow the standardized nutrition schema provided.
      Additionally, provide a **concise qualitative summary** explaining:
      - Why the specific caloric intake was chosen.
      - The rationale behind the macronutrient breakdown (carbs, proteins, fats).
      - Any adjustments made in micronutrient calculations based on health conditions.
      The response must be structured **in JSON format**, following the schema provided.

      `;

      // User prompt content for the OpenAI API
      const userContent = `
 Analyze the following **dietary recommendation** and extract the necessary data according to the given schema.

      ### **Input Dietary Recommendation:**
      ${caloricResult}

      ### **Instructions:**
      1. **Extract numerical values** for calories, macronutrients (carbohydrates, proteins, fats), and micronutrients (fiber, sodium, sugars, calcium, magnesium, iron, potassium, omega-3, cholesterol, zinc, vitamin D, vitamin C, vitamin B12, and vitamin E).
      2. Convert all **units correctly**:
          - **Calories** in kcal
          - **Macronutrients** in grams (g)
          - **Micronutrients** in mg, mcg, or IU as applicable.
      3. **Ensure consistency** by using predefined values where ranges exist (e.g., Omega-3 is always **1000mg**).
      4. **Provide a short qualitative recap** explaining the reasoning behind:
          - Caloric adjustment based on health goals.
          - Macronutrient distribution for weight management and energy balance.
          - Micronutrient levels for metabolic and overall health.
      5. Format the response **strictly in JSON**

      Ensure that **all values are formatted correctly** and that the explanation remains **concise but informative**.
      `;

      // Call the OpenAI API
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemContent },
          { role: "user", content: userContent },
        ],
        tools: [nutrientLimitTool],
        tool_choice: {
          type: "function",
          function: { name: "generateNutrientLimits" },
        },
      });

      const toolCall = response.choices[0].message.tool_calls?.[0];
      if (!toolCall) {
        throw new Error("No structured output returned");
      }

      // Parse the response to get the recommended nutrient amounts
      const recommendedAmounts = JSON.parse(toolCall.function.arguments);
      const { explanation, caloricAmount, ...nutrientLimts } =
        recommendedAmounts;
      await this.createTracker(patientId, nutrientLimts);
      const dataObj = [{ caloricAmount: caloricAmount }];
      await updatePatientSummarySection(patientId, "caloricAmount", dataObj);
      const updatedPatientData = await getPatientById(patientId);
      const token = await getUserToken(patientId);

      return { ...updatedPatientData, token };
    } catch (error) {
      console.error("Error generating nutrient amounts", error);
      throw error;
    }
  }

  async createTracker(userId: string, nutrientLimts?: object) {
    try {
      const existingTracker = await prisma.macroNutrientsTracker.findUnique({
        where: { userId: userId },
      });

      const nutrientsLimit = nutrientLimts
        ? nutrientLimts
        : await this.generateNutrientsTotalAmount(userId);

      if (existingTracker) {
        // Update the existing tracker with new values
        const updatedTracker = await prisma.macroNutrientsTracker.update({
          where: { userId: userId },
          data: {
            ...nutrientsLimit,
          },
        });
        return updatedTracker;
      }

      const trackerData = {
        ...nutrientsLimit,
        userId: userId,
      };
      const tracker = await prisma.macroNutrientsTracker.create({
        data: trackerData,
      });

      return tracker;
    } catch (error) {
      console.error("Error creating or updating the calories tracker", error);
      throw error;
    }
  }
  //create daily nutritient tracker
  async createDailyNutrientTracker(
    userId: string,
    date: any,
    timeZone: string
  ) {
    try {
      let mainTracker = await prisma.macroNutrientsTracker.findUnique({
        where: { userId: userId },
      });
      if (!mainTracker) mainTracker = await this.createTracker(userId);

      // const startOfDay = moment()
      //   .tz(timeZone)
      //   .startOf("day")
      //   .format("YYYY-MM-DDTHH:mm:ss.SSSZ");
      // const endOfDay = moment()
      //   .tz(timeZone)
      //   .endOf("day")
      //   .format("YYYY-MM-DDTHH:mm:ss.SSSZ");
      const startOfDay = moment(date)
        .tz(timeZone)
        .startOf("day")
        .format("YYYY-MM-DDTHH:mm:ss.SSS[+00:00]");
      const endOfDay = moment(date)
        .tz(timeZone)
        .endOf("day")
        .format("YYYY-MM-DDTHH:mm:ss.SSS[+00:00]");
      const existingDailyTracker = await prisma.dailyNutrients.findFirst({
        where: {
          trackerId: mainTracker.id,
          date: startOfDay,
        },
      });

      if (existingDailyTracker) return existingDailyTracker;

      const dailyTracker = await prisma.dailyNutrients.create({
        data: {
          userId: userId,
          // date: getLocalDate(new Date()),
          date: startOfDay,
          trackerId: mainTracker.id,
          // carbohydrates: nutrients.carbohydrates,
          // proteins: nutrients.proteins,
          // fats: nutrients.fats,
          // fiber: nutrients.fiber,
          // sodium: nutrients.sodium,
          // naturalSugar: nutrients.naturalSugar,
          // addedSugar: nutrients.addedSugar,
          // calcium: nutrients.calcium,
          // magnesium: nutrients.magnesium,
        },
      });

      return dailyTracker;
    } catch (error: unknown) {
      console.error("Error creating daily nutrient tracker", error);
      throw error;
    }
  }
  // Create weekly calorie tracker
  async createWeeklyNutrientTracker(
    userId: string,
    nutrients: Nutrients,
    date: any
  ) {
    try {
      const mainTracker = await prisma.macroNutrientsTracker.findUnique({
        where: { userId: userId },
        include: { weeklyEntries: true }, // Include weekly entries for validation
      });

      if (!mainTracker) throw new Error("Main tracker not found for the user.");

      // const { start: startOfWeek, end: endOfWeek } = getCurrentWeekRange();
      const { start: startOfWeek, end: endOfWeek } =
        getCurrentWeekRangeFromDate(date);

      const existingWeeklyTracker = await prisma.weeklyNutrients.findFirst({
        where: {
          trackerId: mainTracker.id,
          // weekStartDate: {
          //   gte: new Date(startOfWeek),
          //   lt: new Date(new Date(endOfWeek).getTime() + 24 * 60 * 60 * 1000),
          // },
          weekStartDate: {
            gte: moment(startOfWeek).toDate(),
            lt: moment(endOfWeek).add(1, "day").toDate(),
          },
        },
      });

      if (existingWeeklyTracker) return existingWeeklyTracker;

      const weeklyTracker = await prisma.weeklyNutrients.create({
        data: {
          userId,
          // weekStartDate: new Date(startOfWeek),
          // weekEndDate: new Date(endOfWeek),
          weekStartDate: moment(startOfWeek).toDate(),
          weekEndDate: moment(endOfWeek).toDate(),
          trackerId: mainTracker.id,
          carbohydrates: nutrients.carbohydrates,
          proteins: nutrients.proteins,
          fats: nutrients.fats,
          fiber: nutrients.fiber,
          sodium: nutrients.sodium,
          naturalSugar: nutrients.naturalSugar,
          addedSugar: nutrients.addedSugar,
          calcium: nutrients.calcium,
          magnesium: nutrients.magnesium,
          iron: nutrients.iron,
          potassium: nutrients.potassium,
          omega_3: nutrients.omega_3,
          cholesterol: nutrients.cholesterol,
          zinc: nutrients.zinc,
          vitaminD: nutrients.vitaminD,
          vitaminC: nutrients.vitaminC,
          vitaminB12: nutrients.vitaminB12,
          vitaminE: nutrients.vitaminE,
        },
      });

      return weeklyTracker;
    } catch (error) {
      console.error("Error creating the weekly tracker", error);
      throw error;
    }
  }

  //update daily and weekly trackers
  async updateDailyWeeklyNutrientTracker(
    userId: string,
    nutrients: Nutrients,
    date: any,
    timeZone: string,
    totalProcessedFood?: number,
    totalGlycemicLoad?: number,
    totalVegetableServings?: number,
    totalFruitServings?: number
  ) {
    // const today = new Date();
    // const startOfDay = new Date(today.setUTCHours(0, 0, 0, 0));
    // const startOfDay = moment()
    //   .tz(timeZone)
    //   .startOf("day")
    //   .format("YYYY-MM-DDTHH:mm:ss.SSSZ");
    const startOfDay = moment(date)
      .tz(timeZone)
      .startOf("day")
      .format("YYYY-MM-DDTHH:mm:ss.SSS[+00:00]");
    try {
      // Create or get daily tracker
      const dailyTracker = await this.createDailyNutrientTracker(
        userId,
        date,
        timeZone
      );
      // Update the weekly entry based on the daily tracker
      let existingWeeklyEntry = await prisma.weeklyNutrients.findFirst({
        where: {
          userId: userId,
          weekStartDate: { lte: startOfDay },
          weekEndDate: { gte: startOfDay },
        },
      });
      // Create weekly tracker if it doesn't exist
      if (!existingWeeklyEntry) {
        existingWeeklyEntry = await this.createWeeklyNutrientTracker(
          userId,
          nutrients,
          date
        );
      } else {
        // Update the existing weekly entry
        await prisma.weeklyNutrients.update({
          where: { id: existingWeeklyEntry.id },
          data: {
            carbohydrates:
              existingWeeklyEntry.carbohydrates + nutrients.carbohydrates,
            proteins: existingWeeklyEntry.proteins + nutrients.proteins,
            fats: existingWeeklyEntry.fats + nutrients.fats,
            fiber: existingWeeklyEntry.fiber + nutrients.fiber,
            sodium: existingWeeklyEntry.sodium + nutrients.sodium,
            naturalSugar:
              existingWeeklyEntry.naturalSugar + nutrients.naturalSugar,
            addedSugar: existingWeeklyEntry.addedSugar + nutrients.addedSugar,
            calcium: existingWeeklyEntry.calcium + nutrients.calcium,
            magnesium: existingWeeklyEntry.magnesium + nutrients.magnesium,
            iron: (existingWeeklyEntry.iron ?? 0) + nutrients.iron,
            potassium:
              (existingWeeklyEntry.potassium ?? 0) + nutrients.potassium,
            omega_3: (existingWeeklyEntry.omega_3 ?? 0) + nutrients.omega_3,
            cholesterol:
              (existingWeeklyEntry.cholesterol ?? 0) + nutrients.cholesterol,
            zinc: (existingWeeklyEntry.zinc ?? 0) + nutrients.zinc,
            vitaminD: (existingWeeklyEntry.vitaminD ?? 0) + nutrients.vitaminD,
            vitaminC: (existingWeeklyEntry.vitaminC ?? 0) + nutrients.vitaminC,
            vitaminB12:
              (existingWeeklyEntry.vitaminB12 ?? 0) + nutrients.vitaminB12,
            vitaminE: (existingWeeklyEntry.vitaminE ?? 0) + nutrients.vitaminE,
            processedFoodCount:
              existingWeeklyEntry.processedFoodCount + totalProcessedFood,
            glycemicLoad:
              (existingWeeklyEntry.glycemicLoad ?? 0) +
              (totalGlycemicLoad ?? 0),
            vegetableServings:
              (existingWeeklyEntry.vegetableServings ?? 0) +
              (totalVegetableServings ?? 0),
            fruitServings:
              (existingWeeklyEntry.fruitServings ?? 0) +
              (totalFruitServings ?? 0),
          },
        });
      }

      // Update the daily calories intake
      await prisma.dailyNutrients.update({
        where: { id: dailyTracker.id },
        data: {
          carbohydrates: dailyTracker.carbohydrates + nutrients.carbohydrates,
          proteins: dailyTracker.proteins + nutrients.proteins,
          fats: dailyTracker.fats + nutrients.fats,
          fiber: dailyTracker.fiber + nutrients.fiber,
          sodium: dailyTracker.sodium + nutrients.sodium,
          naturalSugar: dailyTracker.naturalSugar + nutrients.naturalSugar,
          addedSugar: dailyTracker.addedSugar + nutrients.addedSugar,
          calcium: dailyTracker.calcium + nutrients.calcium,
          magnesium: dailyTracker.magnesium + nutrients.magnesium,
          iron: (dailyTracker.iron ?? 0) + nutrients.iron,
          potassium: (dailyTracker.potassium ?? 0) + nutrients.potassium,
          omega_3: (dailyTracker.omega_3 ?? 0) + nutrients.omega_3,
          cholesterol: (dailyTracker.cholesterol ?? 0) + nutrients.cholesterol,
          zinc: (dailyTracker.zinc ?? 0) + nutrients.zinc,
          vitaminD: (dailyTracker.vitaminD ?? 0) + nutrients.vitaminD,
          vitaminB12: (dailyTracker.vitaminB12 ?? 0) + nutrients.vitaminB12,
          vitaminC: (dailyTracker.vitaminC ?? 0) + nutrients.vitaminC,
          vitaminE: (dailyTracker.vitaminE ?? 0) + nutrients.vitaminE,
          processedFoodCount:
            dailyTracker.processedFoodCount + totalProcessedFood,
          glycemicLoad:
            (dailyTracker.glycemicLoad ?? 0) + (totalGlycemicLoad ?? 0),
          vegetableServings:
            (dailyTracker.vegetableServings ?? 0) +
            (totalVegetableServings ?? 0),
          fruitServings:
            (dailyTracker.fruitServings ?? 0) + (totalFruitServings ?? 0),
        },
      });
    } catch (error: unknown) {
      console.log("Error updating trackers", error);
      throw error;
    }
  }

  //fetch nutrients tracker
  async getNutrientsTracker(where: any) {
    try {
      const tracker = await prisma.macroNutrientsTracker.findUnique({
        where: where,
        include: {
          dailyEntries: true,
          weeklyEntries: true,
        },
      });
      if (tracker) {
        return tracker;
      } else {
        return null;
      }
    } catch (error: unknown) {
      console.error("Error fetching the tracker");
      throw error;
    }
  }

  async getWeeklyNutrientsTracker(where: any) {
    try {
      const tracker = await prisma.macroNutrientsTracker.findUnique({
        where: where,
        include: {
          weeklyEntries: true,
        },
      });
      if (tracker) {
        return tracker;
      } else {
        return null;
      }
    } catch (error: unknown) {
      console.error("Error fetching the tracker");
      throw error;
    }
  }

  async getWeeklyNutrientsForInterval({
    userId,
    start,
    end,
  }: {
    userId: string;
    start: Date;
    end: Date;
  }) {
    try {
      const entries = await prisma.weeklyNutrients.findMany({
        where: {
          userId,
          weekStartDate: { lte: end },
          weekEndDate: { gte: start },
        },
        include: {
          tracker: {
            include: {
              weeklyEntries: true,
            },
          },
        },
      });

      return entries;
    } catch (error) {
      console.error("Error in getWeeklyNutrientsForInterval:", error);
      throw error;
    }
  }

  //delete nutritients tracker
  async deleteNutrientsTracker(where: any) {
    try {
      const response = await prisma.macroNutrientsTracker.delete({
        where: where,
      });
      if (response) return true;
    } catch (error: unknown) {
      console.error("Error deleting the tracker", error);
      throw error;
    }
  }
  // create fav meal
  async createFavMeal(
    foodEntries: FoodEntry[],
    patientId: string,
    description: string,
    mealType: any
  ) {
    try {
      const favMeal = await prisma.favMeal.create({
        data: {
          userId: patientId,
          description: description,
          mealType: mealType,
          quantity: "1",
          ingredients: {
            connect: foodEntries.map((entry) => ({ id: entry.id })),
          },
          calories: foodEntries.reduce((acc, entry) => acc + entry.calories, 0),
          carbohydrates: foodEntries.reduce(
            (acc, entry) => acc + (entry.carbohydrates ?? 0),
            0
          ),
          proteins: foodEntries.reduce(
            (acc, entry) => acc + (entry.proteins ?? 0),
            0
          ),
          fats: foodEntries.reduce((acc, entry) => acc + (entry.fats ?? 0), 0),
          fiber: foodEntries.reduce(
            (acc, entry) => acc + (entry.fiber ?? 0),
            0
          ),
          sodium: foodEntries.reduce(
            (acc, entry) => acc + (entry.sodium ?? 0),
            0
          ),
          naturalSugar: foodEntries.reduce(
            (acc, entry) => acc + (entry.naturalSugar ?? 0),
            0
          ),
          addedSugar: foodEntries.reduce(
            (acc, entry) => acc + (entry.addedSugar ?? 0),
            0
          ),
          calcium: foodEntries.reduce(
            (acc, entry) => acc + (entry.calcium ?? 0),
            0
          ),
          magnesium: foodEntries.reduce(
            (acc, entry) => acc + (entry.magnesium ?? 0),
            0
          ),
          iron: foodEntries.reduce((acc, entry) => acc + (entry.iron ?? 0), 0),
          potassium: foodEntries.reduce(
            (acc, entry) => acc + (entry.potassium ?? 0),
            0
          ),
          omega_3: foodEntries.reduce(
            (acc, entry) => acc + (entry.omega_3 ?? 0),
            0
          ),
          cholesterol: foodEntries.reduce(
            (acc, entry) => acc + (entry.cholesterol ?? 0),
            0
          ),
          zinc: foodEntries.reduce((acc, entry) => acc + (entry.zinc ?? 0), 0),
          vitaminD: foodEntries.reduce(
            (acc, entry) => acc + (entry.vitaminD ?? 0),
            0
          ),
          vitaminC: foodEntries.reduce(
            (acc, entry) => acc + (entry.vitaminC ?? 0),
            0
          ),
          vitaminB12: foodEntries.reduce(
            (acc, entry) => acc + (entry.vitaminB12 ?? 0),
            0
          ),
          vitaminE: foodEntries.reduce(
            (acc, entry) => acc + (entry.vitaminE ?? 0),
            0
          ),
          // ✅ Newly added fields
          glycemicLoad: foodEntries.reduce(
            (acc, entry) => acc + (entry.glycemicLoad ?? 0),
            0
          ),
          vegetableServings: foodEntries.reduce(
            (acc, entry) => acc + (entry.vegetableServings ?? 0),
            0
          ),
          fruitServings: foodEntries.reduce(
            (acc, entry) => acc + (entry.fruitServings ?? 0),
            0
          ),
          isProcessedFood: foodEntries.some((entry) => entry.isProcessedFood),
        },
      });
      if (favMeal) return favMeal;
    } catch (error: unknown) {
      console.error("Error creating the FavMeal", error);
      throw error;
    }
  }

  //delete fav meal
  async deleteFavMeal(favMealId: string) {
    try {
      // First, find the FavMeal to get the associated food entries
      const favMeal = await prisma.favMeal.findUnique({
        where: { id: favMealId },
        include: { ingredients: true }, // Include food entries
      });

      if (!favMeal) {
        throw new Error("FavMeal not found");
      }

      // Remove the favMealId from each FoodEntry
      await prisma.foodEntry.updateMany({
        where: { id: { in: favMeal.ingredients.map((entry) => entry.id) } },
        data: { favMealId: null }, // Set favMealId to null
      });

      // Now delete the FavMeal itself
      const response = await prisma.favMeal.delete({
        where: { id: favMealId },
      });
      return response;
    } catch (error: unknown) {
      console.error("Error deleting the FavMeal", error);
      throw error;
    }
  }
  // fetch fav meals
  async getFavMeals(whereClause: object) {
    try {
      const favMeals = await prisma.favMeal.findMany(whereClause);
      if (favMeals) {
        return favMeals;
      }
    } catch (error: unknown) {
      console.error("Error fetching the fav meals", error);
      throw error;
    }
  }
  // update nutrient and calories weekly tracker with generated values
  async addGeneratedValues(
    patientId: string,
    scale: number,
    missingDays: number
  ) {
    const { start: prevStartWeek, end: prevEndWeek } = getPreviousWeekRange();
    const { nutrients, calories }: { nutrients: Nutrients; calories: number } =
      generateNutrientValues(scale, missingDays);
    try {
      //update weekly calories
      await CaloriesService.updateOrCreateWeeklyIntakeCaloriesTracker(
        patientId,
        calories,
        prevStartWeek,
        prevEndWeek
      );
      const weeklyNutrientTracker = await prisma.weeklyNutrients.findFirst({
        where: {
          userId: patientId,
          weekStartDate: prevStartWeek,
          weekEndDate: prevEndWeek,
        },
      });
      if (
        weeklyNutrientTracker !== null &&
        !weeklyNutrientTracker.missingDaysAdded
      ) {
        await prisma.weeklyNutrients.update({
          where: { id: weeklyNutrientTracker.id },
          data: {
            carbohydrates:
              weeklyNutrientTracker.carbohydrates + nutrients.carbohydrates,
            proteins: weeklyNutrientTracker.proteins + nutrients.proteins,
            fats: weeklyNutrientTracker.fats + nutrients.fats,
            fiber: weeklyNutrientTracker.fiber + nutrients.fiber,
            sodium: weeklyNutrientTracker.sodium + nutrients.sodium,
            naturalSugar:
              weeklyNutrientTracker.naturalSugar + nutrients.naturalSugar,
            addedSugar: weeklyNutrientTracker.addedSugar + nutrients.addedSugar,
            calcium: weeklyNutrientTracker.calcium + nutrients.calcium,
            magnesium: weeklyNutrientTracker.magnesium + nutrients.magnesium,
            iron: (weeklyNutrientTracker.iron ?? 0) + nutrients.iron,
            potassium:
              (weeklyNutrientTracker.potassium ?? 0) + nutrients.potassium,
            omega_3: (weeklyNutrientTracker.omega_3 ?? 0) + nutrients.omega_3,
            cholesterol:
              (weeklyNutrientTracker.cholesterol ?? 0) + nutrients.cholesterol,
            zinc: (weeklyNutrientTracker.zinc ?? 0) + nutrients.zinc,
            vitaminD:
              (weeklyNutrientTracker.vitaminD ?? 0) + nutrients.vitaminD,
            vitaminC:
              (weeklyNutrientTracker.vitaminC ?? 0) + nutrients.vitaminC,
            vitaminB12:
              (weeklyNutrientTracker.vitaminB12 ?? 0) + nutrients.vitaminB12,
            vitaminE:
              (weeklyNutrientTracker.vitaminE ?? 0) + nutrients.vitaminE,
            missingDaysAdded: true,
          },
        });
        return true;
      } else {
        return true;
      }
    } catch (error: unknown) {
      console.error("Something went wrong updating the tracker");
    }
  }

  //----------------------------------------------//

}

export default new NutritionService();
