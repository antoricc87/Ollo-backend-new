/**
 * LEGACY meal estimators (pre-Phase-1). Kept verbatim as an escape hatch:
 * set MEAL_ANALYSIS_ENGINE=legacy to route the four calorie endpoints here
 * instead of src/services/meal_analysis/mealAnalysis.service.ts.
 * Do not extend — scheduled for removal once Phase 1 is validated in production.
 */
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { randomUUID } from "crypto";
import dotenv from "dotenv";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import OpenAI from "openai";
import os from "os";
import path from "path";
import { promisify } from "util";
import { getPatientById } from "../../../patient/model/patient.model";
import {
  calorieResponseTool,
  caloriesArrayResponseTool,
} from "../../schemas/openai.schema";

ffmpeg.setFfmpegPath(ffmpegInstaller.path);
const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);
dotenv.config();
const openai = new OpenAI({ apiKey: process.env.REACT_APP_OPENAI_API_KEY || "" });

export const getOpenAiCaloriesCalculator = async (
  foodDescription: string,
  patientId: string
) => {
  const patient = await getPatientById(patientId);
  const { conditions } = patient.patientSummary;
  const patientConditions = conditions.map((c) => c.condition.name);
  const prompt = `Calculate the total number of calories and nutrients (for nutrients calculate always in decimal numbers and always in grams except for sodium,calcium,iron,potassium,cholesterol,zinc, magnesium, vitamin C and vitamin E in mg, and vitamin D and vitamin B12 in µg — micrograms)  for each meal in the following food description: "${foodDescription}". 

  - Ensure that each food item appears **only once** (no duplicates with different serving sizes). 
  - If a quantity is **not specified**, assume a **single reasonable serving** based on standard portion sizes (e.g., a slice of bread, one medium apple, one cup of blueberries).
  - If an item cannot be portioned into a **single serving easily** (e.g., pizza), assume **one whole unit** instead of multiple variants.
  - Do **not** generate multiple versions of the same food with different serving sizes.
  - Always provide output in structured JSON format.

  Additionally, provide:
  - **Glycemic Index (GI)**: The standard glycemic index of each food.
  - **Vegetable Portion**: The number of vegetable servings based on standard portion sizes (1 cup raw vegetables, ½ cup cooked vegetables = 1 serving).
  - **Fruit Portion**: The number of fruit servings based on standard portion sizes (1 medium fruit, 1 cup diced fruit, ½ cup dried fruit = 1 serving).

- **Warnings**: produce an array of warning objects for any unhealthy aspects of the meal.
  PatientConditions:${patientConditions.join(",")}

Use the following rules:

1. If the patient has any medical conditions listed in PatientConditions, analyze the nutritional data for each food and emit condition-specific warnings only if relevant.

   Each warning should include:
   - A clear and concise explanation of the risk (1–2 sentences max).
   - The related condition.
   - A severity score from 1 (minor) to 5 (critical).

2. Use the following condition-specific guidance to assess impact:

   - **Diabetes**: flag foods with high sugar (>15g), high total carbohydrates (>40g), or glycemic index >70. Mention impact on blood sugar or insulin response.
   - **Hypertension**: flag high sodium (>600mg per item). Explain effect on blood pressure.
   - **High Cholesterol / Heart Disease**: flag high saturated fat (>8g), trans fat (>1g), or cholesterol (>100mg). Highlight cardiovascular risk.
   - **Kidney Disease**: flag excess sodium (>500mg), potassium (>700mg), or protein (>25g). Warn about kidney load or electrolyte imbalance.
   - **Irritable Bowel Syndrome (IBS)**: flag high fiber (>10g), lactose, or artificial sweeteners. Mention possible digestive symptoms.

3. If no patient conditions are impacted, but the food still presents a general health risk (e.g., extremely high sodium, sugar, fat), emit a general warning:
   – Example: "High in sodium; consume in moderation" (severity: 3)
   – These should **not** refer to specific conditions.


  The response format should be an array of objects, each containing:
  - "description": The food name **without quantity** (e.g., "Salad" instead of "200g of Salad").
  - "calories": The total calories for the selected portion.
  - "quantity": The assumed serving size (e.g., "1 slice", "1 cup", "1 whole", "100g").

  Also, provide a **short and concise** name for the meal (e.g., "English Breakfast", "Egg Sandwich").
  Assign a meal type (BREAKFAST, LUNCH, DINNER, SNACK) based on the ingredients.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [
        {
          role: "system",
          content: `You are a helpful assistant that accurately calculates calories and nutrients for meals based on a given food description. 
          
          - **Do not generate duplicate food items** (e.g., avoid "1 slice of pizza" and "1 whole pizza" at the same time).
          - When a quantity is **not provided**, assume a **standard portion size** where possible.
          - **Only one serving per food item** (if ambiguous, default to the most typical portion size).
          - Always provide comprehensive nutritional information including all nutrients, glycemic index, and warnings.`,
        },
        { role: "user", content: prompt },
      ],
      tools: [calorieResponseTool],
      tool_choice: {
        type: "function",
        function: { name: "generateCalorieResponse" },
      },
    });

    const toolCall = response.choices[0].message.tool_calls?.[0];
    if (!toolCall) {
      throw new Error("No structured output returned");
    }
    console.log(JSON.parse(toolCall.function.arguments));
    return JSON.parse(toolCall.function.arguments);
  } catch (error: any) {
    console.error("Error calculating calories", error);
    throw error;
  }
};
export const calculateMultipleMealsCaloriesAndNutrients = async (
  foodDescription: string,
  patientId: string
): Promise<{
  meals: any[];
  dateReference: string | null;
  dateConfidence: number;
}> => {
  const patient = await getPatientById(patientId);
  const { conditions } = patient.patientSummary;
  const patientConditions = conditions.map((c) => c.condition.name);
  const prompt = `Calculate the total number of calories and nutrients (for nutrients calculate always in decimal numbers and always in grams except for sodium,calcium,iron,potassium,cholesterol,zinc, magnesium, vitamin C and vitamin E in mg, and vitamin D and vitamin B12 in µg — micrograms) for each meal in the following food description: "${foodDescription}". 

  **IMPORTANT**: 
  1. Group the food items by meal type. If the description mentions "for breakfast", "for lunch", "for dinner", or similar meal indicators, create separate meal objects for each meal mentioned. Each meal should contain its own ingredients array.
  2. **Extract any date/time references** from the food description (yesterday, today, tomorrow, Monday, Tuesday, etc., last week, 2 days ago, specific dates like 12/25/2023, etc.) and include them in the response.
  3. **For each meal, assign the appropriate date**. ALWAYS provide a mealDate for every meal. If multiple days are mentioned (e.g., "Tuesday and Wednesday"), assign each meal to its specific day. If only one day is mentioned, assign all meals to that day. If no specific day is mentioned, use "today" as the mealDate.

  - Ensure that each food item appears **only once** per meal (no duplicates with different serving sizes). 
  - If a quantity is **not specified**, assume a **single reasonable serving** based on standard portion sizes (e.g., a slice of bread, one medium apple, one cup of blueberries).
  - If an item cannot be portioned into a **single serving easily** (e.g., pizza), assume **one whole unit** instead of multiple variants.
  - Do **not** generate multiple versions of the same food with different serving sizes.
  - Always provide output in structured JSON format.

  Additionally, provide:
  - **Glycemic Index (GI)**: The standard glycemic index of each food.
  - **Vegetable Portion**: The number of vegetable servings based on standard portion sizes (1 cup raw vegetables, ½ cup cooked vegetables = 1 serving).
  - **Fruit Portion**: The number of fruit servings based on standard portion sizes (1 medium fruit, 1 cup diced fruit, ½ cup dried fruit = 1 serving).

- **Warnings**: produce an array of warning objects for any unhealthy aspects of the meal.
  PatientConditions:${patientConditions.join(",")}

Use the following rules:

1. If the patient has any medical conditions listed in PatientConditions, analyze the nutritional data for each food and emit condition-specific warnings only if relevant.

   Each warning should include:
   - A clear and concise explanation of the risk (1–2 sentences max).
   - The related condition.
   - A severity score from 1 (minor) to 5 (critical).

2. Use the following condition-specific guidance to assess impact:

   - **Diabetes**: flag foods with high sugar (>15g), high total carbohydrates (>40g), or glycemic index >70. Mention impact on blood sugar or insulin response.
   - **Hypertension**: flag high sodium (>600mg per item). Explain effect on blood pressure.
   - **High Cholesterol / Heart Disease**: flag high saturated fat (>8g), trans fat (>1g), or cholesterol (>100mg). Highlight cardiovascular risk.
   - **Kidney Disease**: flag excess sodium (>500mg), potassium (>700mg), or protein (>25g). Warn about kidney load or electrolyte imbalance.
   - **Irritable Bowel Syndrome (IBS)**: flag high fiber (>10g), lactose, or artificial sweeteners. Mention possible digestive symptoms.

3. If no patient conditions are impacted, but the food still presents a general health risk (e.g., extremely high sodium, sugar, fat), emit a general warning:
   – Example: "High in sodium; consume in moderation" (severity: 3)
   – These should **not** refer to specific conditions.

  **Response Format**: Return an object containing:
  - "meals": An array of meal objects
  - "dateReference": The detected date reference (e.g., "yesterday", "Monday", "2 days ago") or null if none found
  - "dateConfidence": Confidence level for date detection (0-1)

  Each meal object should contain:
  - "ingredients": An array of ingredient objects for that specific meal
  - "mealName": A descriptive name that captures the essence of the meal (e.g., "Classic English Breakfast with Bacon and Eggs", "Creamy Pasta Carbonara with Pancetta", "Grilled Salmon with Roasted Vegetables"). This should be descriptive and specific to the actual foods, NOT just the meal type.
  - "mealType": The meal type (BREAKFAST, LUNCH, DINNER, SNACK) based on the context
  - "mealDate": The specific date for this meal (e.g., "Tuesday", "Wednesday", "yesterday", "today", "2024-01-15"). Use the same format as the general dateReference.

  Each ingredient object should contain ALL the following fields:
  - "description": The food name **without quantity** (e.g., "Sausage" instead of "2 sausages")
  - "calories": The total calories for the selected portion
  - "quantity": The assumed serving size (e.g., "2 sausages", "1 cup", "1 whole", "100g")
  - "measurementUnit": The unit of measurement (PIECE, CUP, GRAM, OUNCE, SERVING, etc.)
  - "warnings": An array of warning objects with "warning" (string) and "severity" (number 1-5) properties
  - "isProcessedFood": Boolean indicating if the food is processed
  - "glycemicIndex": The glycemic index number
  - "vegetableServings": Number of vegetable servings
  - "fruitServings": Number of fruit servings
  - "nutrients": An object containing ALL the following nutritional values:
    * "carbohydrates": number (in grams)
    * "proteins": number (in grams)
    * "fats": number (in grams)
    * "fiber": number (in grams)
    * "sodium": number (in mg)
    * "naturalSugar": number (in grams)
    * "addedSugar": number (in grams)
    * "calcium": number (in mg)
    * "magnesium": number (in mg)
    * "iron": number (in mg)
    * "potassium": number (in mg)
    * "omega_3": number (in grams)
    * "cholesterol": number (in mg)
    * "zinc": number (in mg)
    * "vitaminD": number (in mg)
    * "vitaminB12": number (in mg)
    * "vitaminC": number (in mg)
    * "vitaminE": number (in mg)

  **CRITICAL**: Ensure ALL nutritional values are provided for each ingredient. Do not omit any required fields.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [
        {
          role: "system",
          content: `You are a helpful assistant that accurately calculates calories and nutrients for meals based on a given food description. 
          
          - **Group food items by meal type** when the description mentions specific meals (breakfast, lunch, dinner, etc.).
          - **Do not generate duplicate food items** (e.g., avoid "1 slice of pizza" and "1 whole pizza" at the same time).
          - When a quantity is **not provided**, assume a **standard portion size** where possible.
          - **Only one serving per food item** (if ambiguous, default to the most typical portion size).
          - **CRITICAL**: Always provide COMPLETE nutritional information for each ingredient including ALL required fields: calories, measurementUnit, warnings, isProcessedFood, glycemicIndex, vegetableServings, fruitServings, and the complete nutrients object with all 18 nutritional values.
          - Return separate meal objects for each meal mentioned in the description.
          - **DO NOT OMIT ANY REQUIRED FIELDS** - every ingredient must have all nutritional data populated.
          - **mealName**: Create descriptive names that capture the actual foods in the meal (e.g., "Grilled Chicken Caesar Salad", "Beef Stir-Fry with Rice"), NOT just the meal type (e.g., "Lunch", "Dinner").
          - **mealType**: Use the appropriate meal type category (BREAKFAST, LUNCH, DINNER, SNACK).
          - **Date Extraction**: Always analyze the food description for date/time references and include them in the response. Extract the exact date reference as it appears in the text (e.g., "yesterday", "Monday", "2 days ago", "last Friday").
          - **Per-Meal Dates**: ALWAYS provide a mealDate for every meal. If multiple days are mentioned, assign each meal to its specific day. If only one day is mentioned, assign all meals to that day. If no specific day is mentioned, use "today" as the mealDate.`,
        },
        { role: "user", content: prompt },
      ],
      tools: [caloriesArrayResponseTool],
      tool_choice: {
        type: "function",
        function: { name: "generateCalorieResponse" },
      },
    });

    const toolCall = response.choices[0].message.tool_calls?.[0];
    if (!toolCall) {
      throw new Error("No structured output returned");
    }

    const rawResponse = toolCall.function.arguments;

    try {
      const parsedResponse = JSON.parse(rawResponse);

      // Validate the response structure
      if (!parsedResponse.meals || !Array.isArray(parsedResponse.meals)) {
        throw new Error("Invalid response structure: meals is not an array");
      }

      // Validate each meal object
      for (let i = 0; i < parsedResponse.meals.length; i++) {
        const meal = parsedResponse.meals[i];

        if (!meal || typeof meal !== "object") {
          throw new Error(
            `Invalid meal object at index ${i}: ${JSON.stringify(meal)}`
          );
        }
        if (!Array.isArray(meal.ingredients)) {
          throw new Error(
            `Invalid meal ingredients at index ${i}: ${JSON.stringify(
              meal.ingredients
            )}`
          );
        }
        if (!meal.mealName || !meal.mealType) {
          console.log(`❌ Missing fields in meal ${i}:`, {
            mealName: meal.mealName,
            mealType: meal.mealType,
            hasMealName: !!meal.mealName,
            hasMealType: !!meal.mealType,
          });
          throw new Error(
            `Invalid meal structure at index ${i}: missing mealName or mealType`
          );
        }
      }

      return parsedResponse;
    } catch (parseError) {
      console.error("Error parsing LLM response:", parseError);

      throw new Error(`Failed to parse LLM response: ${parseError.message}`);
    }
  } catch (error: any) {
    console.error("Error calculating calories", error);
    throw error;
  }
};

//generate calories amount from meal image
export const getCaloriesFromImage = async (
  base64Image: string,
  description: string,
  patientId: string
) => {
  try {
    const patient = await getPatientById(patientId);
    const { conditions } = patient.patientSummary;
    const patientConditions = conditions.map((c) => c.condition.name);
    const prompt = `
    Analyze the image and provide the exact amount of calories and nutrients (for nutrients calculate always in decimal numbers and always in grams except for sodium,calcium,iron,potassium,cholesterol,zinc, magnesium, vitamin C and vitamin E in mg, and vitamin D and vitamin B12 in µg — micrograms) contained in the food.
    - Ensure that each food item appears **only once** (no duplicates with different serving sizes).  The response should be in JSON format.Make sure to not include the quantity in the description.
    Give a short and concise name to the meal (ex. english breakfast, egg sandwich etc).
  Assign a meal type (BREAKFAST,LUNCH,DINNER,SNACK) based on the ingredients.
    foodDescription:${description}
    If the foodDescription is not empty use it as an extra guidline to calculate the calories and nutrients.
 Additionally, provide:
  - **Glycemic Index (GI)**: The standard glycemic index of each food.
  - **Vegetable Portion**: The number of vegetable servings based on standard portion sizes (1 cup raw vegetables, ½ cup cooked vegetables = 1 serving).
  - **Fruit Portion**: The number of fruit servings based on standard portion sizes (1 medium fruit, 1 cup diced fruit, ½ cup dried fruit = 1 serving).

     - **Warnings**: produce an array of warning objects for any unhealthy aspects.  
  PatientConditions:${patientConditions.join(",")}
Warnings (only if the food impacts them)
If patientConditions contains one or more items, scan the food's nutrition and only emit warnings for conditions it actually affects.
– Example: High sugar content is not recommended for diabetes (severity: 4)
– Do not mention hypertension if sodium is within normal range
If patientConditions is empty or none of the listed conditions are impacted but the food still has an unhealthy aspect, emit a general warning.
– Example: High in sodium; consume in moderation (severity: 3)
    `;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [
        {
          role: "system",
          content: `You are a helpful assistant that accurately calculates the total number of calories and nutrients (for nutrients calculate always in decimal numbers and always in grams except for sodium,calcium,iron,potassium,cholesterol,zinc, magnesium, vitamin C and vitamin E in mg, and vitamin D and vitamin B12 in µg — micrograms) in the food shown in the image. 
          
          - **Do not generate duplicate food items** (e.g., avoid "1 slice of pizza" and "1 whole pizza" at the same time).
          - When a quantity is **not provided**, assume a **standard portion size** where possible.
          - **Only one serving per food item** (if ambiguous, default to the most typical portion size).
          - Always provide comprehensive nutritional information including all nutrients, glycemic index, and warnings.
          - Make sure to not include the quantity in the description.
          - Give a short and concise name to the meal (ex. english breakfast, egg sandwich etc).
          - Assign a meal type (BREAKFAST,LUNCH,DINNER,SNACK) based on the ingredients.`,
        },
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: {
                url: base64Image,
                detail: "high",
              },
            },
          ],
        },
      ],
      tools: [calorieResponseTool],
      tool_choice: {
        type: "function",
        function: { name: "generateCalorieResponse" },
      },
    });

    const toolCall = response.choices[0].message.tool_calls?.[0];
    if (!toolCall) {
      throw new Error("No structured output returned");
    }

    return JSON.parse(toolCall.function.arguments);
  } catch (error: unknown) {
    console.error("Error calculating calories", error);
    throw error;
  }
};


// generate calories from audio file
export const getCaloriesFromAudio = async (
  base64Audio: string,
  patientId: string
) => {
  const tempId = randomUUID();
  const tempRawPath = path.join(os.tmpdir(), `ollo-audio-${tempId}.raw`);
  const tempConvertedPath = path.join(os.tmpdir(), `ollo-audio-${tempId}.mp3`);

  try {
    // Convert Base64 to binary and write to a temporary raw file
    const audioBuffer = Buffer.from(
      base64Audio.replace(/^data:audio\/\w+;base64,/, ""),
      "base64"
    );
    await writeFile(tempRawPath, audioBuffer);

    // Convert to MP3 using ffmpeg
    await new Promise<void>((resolve, reject) => {
      ffmpeg(tempRawPath)
        .toFormat("mp3")
        .on("error", reject)
        .on("end", resolve)
        .save(tempConvertedPath);
    });

    // Transcribe the audio using the converted file
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tempConvertedPath),
      model: "gpt-4o-mini-transcribe",
    });
    const patient = await getPatientById(patientId);
    const { conditions } = patient.patientSummary;
    const patientConditions = conditions.map((c) => c.condition.name);
    const prompt = `Calculate the total number of calories and nutrients (for nutrients calculate always in decimal numbers and always in grams except for sodium,calcium,iron,potassium,cholesterol,zinc, magnesium, vitamin C and vitamin E in mg, and vitamin D and vitamin B12 in µg — micrograms) for each meal in the following food description: ${
      transcription.text
    }. 
     - Ensure that each food item appears **only once** (no duplicates with different serving sizes). 
  - If a quantity is **not specified**, assume a **single reasonable serving** based on standard portion sizes (e.g., a slice of bread, one medium apple, one cup of blueberries).
  - If an item cannot be portioned into a **single serving easily** (e.g., pizza), assume **one whole unit** instead of multiple variants.
  - Do **not** generate multiple versions of the same food with different serving sizes.
  - Always provide output in structured JSON format.

  The response format should be an array of objects, each containing:
  - "description": The food name **without quantity** (e.g., "Salad" instead of "200g of Salad").
  - "calories": The total calories for the selected portion.
  - "quantity": The assumed serving size (e.g., "1 slice", "1 cup", "1 whole", "100g").
Additionally, provide:
  - **Glycemic Index (GI)**: The standard glycemic index of each food.
  - **Vegetable Portion**: The number of vegetable servings based on standard portion sizes (1 cup raw vegetables, ½ cup cooked vegetables = 1 serving).
  - **Fruit Portion**: The number of fruit servings based on standard portion sizes (1 medium fruit, 1 cup diced fruit, ½ cup dried fruit = 1 serving).

  - **Warnings**: produce an array of warning objects for any unhealthy aspects.  
  PatientConditions:${patientConditions.join(",")}
Warnings (only if the food impacts them)
If patientConditions contains one or more items, scan the food's nutrition and only emit warnings for conditions it actually affects.
– Example: High sugar content is not recommended for diabetes (severity: 4)
– Do not mention hypertension if sodium is within normal range
If patientConditions is empty or none of the listed conditions are impacted but the food still has an unhealthy aspect, emit a general warning.
– Example: High in sodium; consume in moderation (severity: 3)

  Also, provide a **short and concise** name for the meal (e.g., "English Breakfast", "Egg Sandwich").
  Assign a meal type (BREAKFAST, LUNCH, DINNER, SNACK) based on the ingredients.
    `;
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [
        {
          role: "system",
          content: `You are a helpful assistant that accurately calculates calories and nutrients for meals based on a given food description. 
          
          - **Do not generate duplicate food items** (e.g., avoid "1 slice of pizza" and "1 whole pizza" at the same time).
          - When a quantity is **not provided**, assume a **standard portion size** where possible.
          - **Only one serving per food item** (if ambiguous, default to the most typical portion size).
          - Always provide comprehensive nutritional information including all nutrients, glycemic index, and warnings.`,
        },
        { role: "user", content: prompt },
      ],
      tools: [calorieResponseTool],
      tool_choice: {
        type: "function",
        function: { name: "generateCalorieResponse" },
      },
    });

    const toolCall = response.choices[0].message.tool_calls?.[0];
    if (!toolCall) {
      throw new Error("No structured output returned");
    }

    return JSON.parse(toolCall.function.arguments);
  } catch (error) {
    console.error("Error calculating calories from audio", error);
    throw error;
  } finally {
    // Cleanup temporary files
    await unlink(tempRawPath).catch(() => {});
    await unlink(tempConvertedPath).catch(() => {});
  }
};

