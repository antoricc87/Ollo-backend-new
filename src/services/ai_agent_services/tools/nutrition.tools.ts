import { Tool } from "langchain/tools";
import moment from "moment";
import OpenAI from "openai";
import { createShoppingList } from "../../../utility/instacart/get_grocery_list";
import prisma from "../../../utility/prismaClient";
import { searchYouTube } from "../../../utility/youtube/get_youtube_videos";
import CaloriesService from "../../calories_tracker/model/calories.model";
import NutritionService from "../../nutrition/model/nutrition.model";
import {
  calculateMultipleMealsCaloriesAndNutrients,
  getOpenAiCaloriesCalculator,
} from "../../openAI/model/openai.model";
import {
  getPatientById,
  getSubAccounts,
} from "../../patient/model/patient.model";
import {
  mealPlanStructureString,
  recipeStructureString,
  singleMealStructureString,
} from "../schemas/ai_agent.schemas";
import { convertToLineItems } from "./functionalities/nutrition/nutritions.tools.functionalities";
import {
  getNutritionOverviewPrompt,
  getPatientNutritionAndHealthInformation,
} from "./patient_data/retrieve_patient_data";
import {
  LLMSubAccountDetector,
  isMealLoggingQueryLLM,
} from "./utilities/llm-subaccount-detector";
import { getAggregatedHealthData } from "./utilities/multi-account-health-aggregator";
import { FavoriteMealDetector } from "./utilities/favorite-meal-detector";

export class MealPlanGeneratorTool extends Tool {
  name = "meal_plan_generator";
  description =
    "Generate a personalized meal plan (recommended for a 1-Day meal plan or more, not for single meal), taking in consideration user health data ";
  constructor(private patientId: string) {
    super();
  }

  // _call method where the tool fetches data and generates a response
  async _call(userQuery: string) {
    // Log the patientId to verify it's passed correctly
    console.log(
      "MealPlanGeneratorTool has been called with patientId:",
      this.patientId
    );
    // Fetch patient data
    const patient = await getPatientById(this.patientId);

    // Log the patient data to confirm it's fetched correctly
    if (!patient) {
      console.log("No patient data found for patientId:", this.patientId);
      return "No patient data found.";
    }
    // Destructure the necessary patient data for generating the meal plan
    const { nutrition, allergies, conditions, caloricAmount, labResults } =
      patient.patientSummary;
    const conditionList = conditions.map((c) => c.condition.name);
    const allergiesList = allergies.map((a) => a.allergy.substance);
    const abnormalLabs = labResults[0].labResults
      .filter((l) => l.isOutOfRange)
      .map((l) => l.testType);
    console.log(abnormalLabs);
    const mealPlan = `Generate a personalized meal plan ensuring it does not exceed the daily caloric amount of ${caloricAmount} kcal.

      Distribute the total caloric intake across meals as follows:
      - **Breakfast**: **25-30%** (~${Math.round(caloricAmount * 0.3)} kcal)
      - **Lunch**: **30-35%** (~${Math.round(caloricAmount * 0.35)} kcal)
      - **Snack**: **5-10%** (~${Math.round(caloricAmount * 0.1)} kcal)
      - **Dinner**: **25-30%** (~${Math.round(caloricAmount * 0.3)} kcal)

      Consider the patient's dietary restrictions and health needs:
      - **Allergies**: ${allergiesList}
      - **Health Conditions**: ${conditionList}
      - **Nutrition Preferences**: ${JSON.stringify(nutrition)}
      - **Abnormal Labs**: ${abnormalLabs}

      Ensure the meal plan:
      1. Provides **balanced nutrition** with appropriate macronutrients (carbohydrates, proteins, and fats) and essential micronutrients.
      2. Strictly avoids any allergens listed or any ingredient not recommended for patient health conditions (if any).
      3. Adapts to the patient's health conditions by recommending foods that support their well-being, and following guidelines for recommended portions.
      4. Aligns with their nutrition preferences, incorporating preferred food choices where possible.
      5. Always specify the **caloric content** and **quantity** for each ingredient in the meal.
      6. Meals must strictly adhere to the **caloric distribution** specified above.
      7. Always include ***breakfast, lunch, snack, and dinner***.

      **Response Requirement**: The meal plan must explicitly state that it has been carefully crafted based on the provided caloric limit, allergies, conditions, and nutrition preferences.
      - Ensure to **NOT INCLUDE** the fenced code block with json specification.
      - **DO NOT INCLUDE** anything else other than the json.
      Ensure that the response is strictly in JSON format using this structure: ${mealPlanStructureString}.
      - ***REMEMBER TO ATTACH THE TOOL USED***[toolUsed:meal_plan_generator]
      `;

    return mealPlan; // Return the generated meal plan
    // return {
    //   type: "meal_plan",
    //   content: `Here is your personalized meal plan:\n\n${mealPlan}`,
    //   display: true,
    // };
  }
}

export class SingleMealGeneratorTool extends Tool {
  name = "single_meal_generator";
  description =
    "Generate a personalized single meal taking in consideration user health data(recommended for single meal generation e.g. Dinner only, lunch only)";
  constructor(private patientId: string) {
    super();
  }
  // _call method where the tool fetches data and generates a response
  async _call(userQuery: string) {
    // Log the patientId to verify it's passed correctly
    console.log(
      "SingleMealGeneratorTool has been called with patientId:",
      this.patientId
    );

    const patientData: any = await getPatientNutritionAndHealthInformation(
      this.patientId
    );
    if (!patientData) {
      console.error("No patient data found");
    }
    const {
      caloricAmount,
      allergies,
      conditions,
      nutrition,
      todayIntakeCalories,
      todayNutrients,
    } = patientData;

    const mealPlan = `Generate a personalized single meal (breakfast, lunch, or dinner) ensuring it does not exceed the daily caloric amount of ${caloricAmount} kcal.
   
      Distribute the total caloric intake across meals using the following guideline:
      - **If it's Breakfast**: **25-30%** (~${Math.round(
        caloricAmount * 0.3
      )} kcal)
      - **If it's Lunch**: **30-35%** (~${Math.round(
        caloricAmount * 0.35
      )} kcal)
      - **If it's Snack**: **5-10%** (~${Math.round(caloricAmount * 0.1)} kcal)
      - **If it's Dinner**: **25-30%** (~${Math.round(
        caloricAmount * 0.3
      )} kcal)
      When choosing the meal Take in consideration the calories intake and nutrients of the day, in a way to recommend a balanced meal(e.g. if the daily intake carbs is high do not recommend high carbs meal unless specified from the user).
      Daily Intake:${todayIntakeCalories},
      Daily Nutrients:${JSON.stringify(todayNutrients)}
      Consider the patient's dietary restrictions and health needs:
      - **Allergies**: ${JSON.stringify(allergies)}
      - **Health Conditions**: ${JSON.stringify(conditions)}
      - **Nutrition Preferences**: ${JSON.stringify(nutrition)}
      
      Ensure the meal:
      1. Provides **balanced nutrition** with appropriate macronutrients (carbohydrates, proteins, and fats) and essential micronutrients.
      2. Strictly avoids any allergens listed or any ingredient not recommended for patient health conditions (if any).
      3. Adapts to the patient's health conditions by recommending foods that support their well-being, and following guidelines for recommended portions.
      4. Aligns with their nutrition preferences, incorporating preferred food choices where possible.
      5. Always specify the **caloric content** and **quantity** for each ingredient in the meal.
      6. Meals must strictly adhere to the **caloric distribution** specified above.

      **Instacart Message:** 
      - If **only one meal** is generated:  
        **"That meal sounds delicious! Would you like me to create a shoppable Instacart link so you can easily grab the ingredients? 🛒😃"**
      - If **multiple meals** are generated:  
        **"Great choices! If you'd like, I can create a shoppable Instacart link for any of these meals. Just let me know which one sounds good to you! 😊"**

      **Response Requirement:** 
      - The meal plan must explicitly state that it has been carefully crafted based on the provided caloric limit, allergies, conditions, and nutrition preferences.
      - Ensure to **NOT INCLUDE** anything else outside of the JSON structure.
      - Ensure the response follows this JSON format: ${singleMealStructureString}.
      - ***THE RESPONSE MUST BE SRICTLY IN JSON***
      - ***REMEMBER TO ATTACH THE TOOL USED*** [toolUsed:single_meal_generator]  
`;

    return mealPlan;
  }
}

export class RecipeGeneratorTool extends Tool {
  name = "recipe_generator";
  description = "Generate a step by step food recipe";

  constructor(private patientId: string) {
    super();
  }

  async _call(youtubeSearchQuery: string) {
    const patient = await getPatientById(this.patientId);
    const { nutrition, allergies, conditions, caloricAmount } =
      patient.patientSummary;
    // Generate the recipe based on the patient data
    const recipe = this.generateRecipe(
      nutrition,
      allergies,
      conditions,
      caloricAmount,
      youtubeSearchQuery
    );

    return recipe;
  }

  async generateRecipe(
    nutrition: any,
    allergies: any,
    conditions: any,
    caloricAmount: any,
    youtubeSearchQuery: string
  ) {
    // Use JSON.stringify to convert the objects/arrays into readable strings
    const nutritionString = JSON.stringify(nutrition);
    const allergiesString = JSON.stringify(allergies);
    const conditionsString = JSON.stringify(conditions);
    // **Determine Video Duration**

    // **Fetch YouTube Results**
    const youtubeResults = await searchYouTube(youtubeSearchQuery, "short");
    // Extract video details into an array
    const videos =
      youtubeResults?.items?.map((video: any) => ({
        title: video.snippet.title,
        videoUrl: `https://www.youtube.com/watch?v=${video.id.videoId}`,
        thumbnail: video.snippet.thumbnails.default.url,
      })) || [];
    // Use the stringified values in the recipe string
    return `Generate a step-by-step food recipe considering the following patient health data and TDEE:
    - Daily TDEE: ${caloricAmount}
    - Allergies: ${allergiesString}
    - Health conditions: ${conditionsString}
    - Food preferences: ${nutritionString}
    
    If any ingredient in the recipe poses a health risk to the patient based on their data (e.g., allergies, conditions), clearly inform the patient. For example, if a patient is allergic to eggs and the recipe includes eggs, or if a patient has hypertension and the recipe is high in sodium, include a warning. These are only examples—only provide warnings that are directly relevant to the patient's health profile.
    
    **Recommended YouTube Videos:**
    ${JSON.stringify(videos, null, 2)}
    
    - The response must be strictly in JSON following this schema: ${recipeStructureString}
    - Ensure to **ALWAYS INCLUDE** the fenced code block with JSON specification.
    - ***Append: [toolUsed:recipe_generator]***`;
  }
}

export class GroceryListGeneratorTool extends Tool {
  name = "grocery_list_generator";
  description =
    "Generate a personalized grocery list, based on patient health conditions and food preferences";
  constructor(private patientId: string) {
    super();
  }

  // _call method where the tool fetches data and generates a response
  async _call(mealPlanDetails?: string) {
    // Log the patientId to verify it's passed correctly

    console.log(
      "Grocery list generator has been called with patientId:",
      this.patientId
    );

    // Fetch patient data
    const patient = await getPatientById(this.patientId);
    // Log the patient data to confirm it's fetched correctly
    if (!patient) {
      console.log("No patient data found for patientId:", this.patientId);
      return "No patient data found.";
    }
    const whereClause = { userId: this.patientId };
    const nutrientsTracker = await NutritionService.getNutrientsTracker(
      whereClause
    );
    // Destructure the necessary patient data for generating the meal plan
    const { nutrition, allergies, conditions, caloricAmount } =
      patient.patientSummary;
    const { carbohydratesLimit, proteinsLimit, fatsLimit } = nutrientsTracker;
    // Generate the meal plan string using the fetched data
    const groceryList = `Generate a detailed grocery list for a patient, ensuring a **balanced and personalized nutrition plan** based on the following health data:
    
- **Daily Caloric Intake**: ${caloricAmount} kcal
- **Daily Macronutrient Balance**:
  - Carbohydrates: ${carbohydratesLimit}g
  - Proteins: ${proteinsLimit}g
  - Fats: ${fatsLimit}g
- **Allergies**: ${JSON.stringify(allergies)}
- **Health Conditions**: ${JSON.stringify(conditions)}
- **Food Preferences**: ${JSON.stringify(nutrition)}

**If quantity are specified in the user query, make sue to use those quanity**
💡 Ensure the grocery list provides **nutritionally balanced ingredients** while staying within the patient's **caloric and macronutrient limits**.
📌 Every ingredient must have a **specified quantity** to meet the patient's daily nutritional goals.
- **Respond strictly in json format, following this schema: 

{
title:"Here is your <duration> grocery with this specifics:e.g high protein, gluten free etc", 
items:[
{item:garlic,unit:lb, quantity:2},
{item:spaghetti,unit:lb, quantity:1},
{item:tomatoes,uit:each,quantity:3},
{item:greek yogurt,unit: 32oz, quantity:1}
{item:black beens,unit: 15oz,quantity:2}
{item:eggs,unit: 12 each,quantity:1}
  ]
}

For countable vegetables items such as tomatoes, it is recommended to use the each value rather than specifying a weight. For items like yogurt , canned goods or any other item that use ounces, use oz as the unit. For the rest, use lb as the unit.**
- Ensure to **NOT INCLUDE** the fenced code block with json specification
- Respons strictly in json.
- Append [toolUsed:grocery_list_generator]
`;
    return groceryList;
  }
}

export class FallbackTool extends Tool {
  name = "fallback_response";
  description =
    "Answer every nutrition-related question based on patient's data that can't be answered with other tools.";

  constructor(private patientId: string) {
    super();
  }

  async _call(input: string) {
    console.log(
      "🔍 FallbackTool activated. Handling general query. patientId:",
      this.patientId
    );

    try {
      // Get comprehensive patient nutrition and health data
      const patientData = await getPatientNutritionAndHealthInformation(
        this.patientId
      );

      if (!patientData) {
        return "I'm here to assist you with any general health, nutrition, or fitness inquiries. How can I help today?";
      }
      console.dir(patientData, { depth: null });
      // Generate personalized response using patient data
      const response = this.generatePersonalizedResponse(input, patientData);
      return response;
    } catch (error) {
      console.error("❌ Error in FallbackTool:", error);
      return "Sorry, something went wrong while retrieving your nutrition data. Let me know how I can help!";
    }
  }

  private generatePersonalizedResponse(
    query: string,
    patientData: any
  ): string {
    return `You are a personalized nutrition assistant. Analyze the user's question using their complete health and nutrition data.

**User Question:** ${query}

**Patient Health Data:**
${JSON.stringify(patientData, null, 2)}


**Instructions:**
- Use the actual data provided above to answer the question
- If they ask about macros, use the currentWeekNutrients data (carbohydrates, proteins, fats)
- If they ask about calories, use todayIntakeCalories and caloricAmount
- If they ask about allergies, use the allergies array
- If they ask about health conditions, use the conditions array
- Always provide specific numbers and data from their actual records
- Be conversational and encouraging
- Don't say you don't have data when it's clearly provided above`;
  }
}

export class InstacartShoppingListTool extends Tool {
  name = "instacart_shopping_list_generator";
  description = "Converts a grocery list into an Instacart shopping list link";

  constructor(private patientId: string) {
    super();
  }

  async _call(groceryListText: string) {
    console.log(
      "Instacart list generator has been called with:",
      groceryListText
    );
    const patient = await getPatientById(this.patientId);
    const { instacartPreferences } = patient;
    // Convert grocery list text to structured Instacart format
    const lineItems = await convertToLineItems(groceryListText);

    if (!lineItems) {
      throw new Error("No valid grocery items found in the input.");
    }

    // Call Instacart API to generate shopping list
    const shoppingListResponse = await createShoppingList(
      lineItems.line_items,
      instacartPreferences.retailer_key
    );

    // Return the Instacart-generated link
    return `
    -Ensure the link is only added at the end of the sentence.
    Here is your shoppable link for the grocery list. You can use this link to easily add the items to your cart and order them online.\n\n[Shop on Instacart](${shoppingListResponse.trim()})
    ***DO NOT INCLUDE THE GROCERY LIST ITEMS IN THE MESSAGE, ONLY THE ABOVE MESSAGE***
    `;
  }
}

export class LogMealTool extends Tool {
  name = "log_meal_tool";
  description: "Log meals from detailed food descriptions. Handles regular meals, favorite meals, and mixed queries. CRITICAL: If user mentions ANY favorite meal keywords ('my favorite', 'favorite', 'usual', 'go-to', 'saved'), set containsFav=true. Set isMixedQuery=true ONLY if there are BOTH favorite meals AND regular meals in the same request. For pure favorite meal requests, set containsFav=true and isMixedQuery=false. Handles single or multiple meals with intelligent date recognition.";

  private favoriteMealDetector: FavoriteMealDetector;
  private openai: OpenAI;

  constructor(private patientId: string) {
    super();
    this.favoriteMealDetector = new FavoriteMealDetector();
    this.openai = new OpenAI({
      apiKey: process.env.REACT_APP_OPENAI_API_KEY,
    });
  }

  async _call(
    input:
      | string
      | {
          foodDescription: string;
          targetPatientId?: string;
          containsFav?: boolean;
          isMixedQuery?: boolean;
        }
  ) {
    let foodDescription: string;
    let targetPatientId: string;
    let containsFav: boolean = false;
    let isMixedQuery: boolean = false;

    // Handle both string input and object input
    if (typeof input === "string") {
      console.log("an input string was passed");
      console.log("input: ", input);

      // Parse string prefixes for favorite meal detection
      if (input.startsWith("FAVORITE_MEAL: ")) {
        foodDescription = input.replace("FAVORITE_MEAL: ", "");
        containsFav = true;
        isMixedQuery = false;
        console.log(
          "🎯 Detected FAVORITE_MEAL prefix - containsFav=true, isMixedQuery=false"
        );
      } else if (input.startsWith("MIXED_MEAL: ")) {
        foodDescription = input.replace("MIXED_MEAL: ", "");
        containsFav = true;
        isMixedQuery = true;
        console.log(
          "🔄 Detected MIXED_MEAL prefix - containsFav=true, isMixedQuery=true"
        );
      } else {
        foodDescription = input;
        containsFav = false;
        isMixedQuery = false;
      }

      targetPatientId = this.patientId;
    } else {
      foodDescription = input.foodDescription;
      targetPatientId = input.targetPatientId || this.patientId;
      containsFav = input.containsFav || false;
      isMixedQuery = input.isMixedQuery || false;
    }

    console.log(
      "Food logging tool called with:",
      foodDescription,
      "for patient:",
      targetPatientId,
      "containsFav:",
      containsFav,
      "isMixedQuery:",
      isMixedQuery
    );

    try {
      const patient = await getPatientById(targetPatientId);

      // Process based on AI agent's prefix detection - trust the agent's classification
      // For pure favorite meal queries, handle them separately for better performance
      if (containsFav && !isMixedQuery) {
        console.log(
          "🎯 Processing PURE favorite meal query - using saved data only"
        );

        // Use the complex query handler to detect ALL favorite meals
        const favoriteOnlyResult = await this.handleComplexMultiDayQuery(
          foodDescription,
          targetPatientId,
          patient.timeZone
        );

        if (favoriteOnlyResult && !favoriteOnlyResult.includes("❌ Error")) {
          return favoriteOnlyResult;
        }

        // Fallback to single favorite detection if complex handler fails
        const favMealDetection =
          await this.favoriteMealDetector.detectFavoriteMealInQuery(
            foodDescription,
            targetPatientId
          );

        if (
          favMealDetection.isFavoriteMealQuery &&
          favMealDetection.targetFavMeal
        ) {
          const favMealResult = await this.logFavoriteMeal(
            favMealDetection.targetFavMeal,
            targetPatientId,
            patient.timeZone,
            favMealDetection.dateReference
          );
          return favMealResult;
        }
      }

      // If this contains favorite meals, check if it's a complex multi-day query
      if (containsFav) {
        // Check if this is a complex multi-day query with multiple favorite meals
        const isComplexMultiDayQuery =
          this.isComplexMultiDayQuery(foodDescription);

        if (isComplexMultiDayQuery) {
          console.log(
            "🔄 Processing complex multi-day query with multiple favorite meals"
          );
          const complexResult = await this.handleComplexMultiDayQuery(
            foodDescription,
            targetPatientId,
            patient.timeZone
          );

          // If complex query was processed successfully, return the result
          if (complexResult && !complexResult.includes("❌ Error")) {
            return complexResult;
          }
        }

        // Check if this is ONLY favorite meals (no regular meals)
        const isOnlyFavoriteMeals = this.isOnlyFavoriteMeals(foodDescription);

        if (isOnlyFavoriteMeals) {
          console.log(
            "🎯 Processing ONLY favorite meals - no regular meals detected"
          );

          // Use the complex query handler which can detect multiple favorites
          const favoriteOnlyResult = await this.handleComplexMultiDayQuery(
            foodDescription,
            targetPatientId,
            patient.timeZone
          );

          if (favoriteOnlyResult && !favoriteOnlyResult.includes("❌ Error")) {
            return favoriteOnlyResult;
          }
        }

        // Use the regular mixed query handler for simpler cases
        const mixedMealResult = await this.handleMixedMealQuery(
          foodDescription,
          targetPatientId,
          patient.timeZone,
          containsFav,
          isMixedQuery
        );

        if (mixedMealResult) {
          return mixedMealResult;
        }
      }

      // Process as regular meals if no favorite meal indicators
      const foodEntries = await calculateMultipleMealsCaloriesAndNutrients(
        foodDescription,
        targetPatientId
      );

      // Ensure meals is an array and validate structure
      if (!Array.isArray(foodEntries.meals)) {
        console.error("foodEntries.meals is not an array:", foodEntries.meals);
        return "Error: Invalid meal data structure";
      }

      // Filter out invalid meal entries and validate structure
      const validMeals = foodEntries.meals.filter((meal) => {
        return (
          meal &&
          typeof meal === "object" &&
          Array.isArray(meal.ingredients) &&
          meal.mealName &&
          meal.mealType
        );
      });

      if (validMeals.length === 0) {
        console.error("No valid meals found in response:", foodEntries.meals);
        return "Error: No valid meal data found";
      }

      // Process meals sequentially to avoid race conditions
      const results = [];

      for (const entry of validMeals) {
        // Parse the date for this specific meal
        let mealDate: moment.Moment;
        if (entry.mealDate) {
          try {
            // Try to parse the meal date directly with moment
            mealDate = moment.tz(entry.mealDate, patient.timeZone);

            // If moment couldn't parse it, fall back to our custom parser
            if (!mealDate.isValid()) {
              mealDate = this.parseDateReference(
                entry.mealDate,
                patient.timeZone
              );
            }
          } catch (error) {
            console.log("Error parsing meal date, using current date:", error);
            mealDate = moment().tz(patient.timeZone);
          }
        } else {
          // Fallback to general date reference or current date
          if (foodEntries.dateReference) {
            try {
              mealDate = moment.tz(foodEntries.dateReference, patient.timeZone);
              if (!mealDate.isValid()) {
                mealDate = this.parseDateReference(
                  foodEntries.dateReference,
                  patient.timeZone
                );
              }
            } catch (error) {
              mealDate = moment().tz(patient.timeZone);
            }
          } else {
            mealDate = moment().tz(patient.timeZone);
          }
        }

        const totals = await this.calculateTotalNutrients(entry.ingredients);
        const formattedFoodEntry = {
          entries: [
            {
              description: entry.mealName || "Meal",
              calories: totals.totalCalories,
              quantity: "1",
              ingredients: entry.ingredients, // Phase 3: persisted per ingredient (server recomputes totals)
              glycemicLoad: entry.glycemicLoad || totals.totalGlycemicLoad,
              vegetableServings: totals.totalVegetableServings,
              fruitServings: totals.totalFruitServings,
              mealType: entry.mealType,
              isProcessedFood: totals.isProcessedFood,
              nutrients: {
                carbohydrates: totals.totalCarbs,
                proteins: totals.totalProteins,
                fats: totals.totalFats,
                fiber: totals.totalFiber,
                sodium: totals.totalSodium,
                naturalSugar: totals.totalNaturalSugar,
                addedSugar: totals.totalAddedSugar,
                calcium: totals.totalCalcium,
                magnesium: totals.totalMagnesium,
                iron: totals.totalIron,
                potassium: totals.totalPotassium,
                omega_3: totals.totalOmega3,
                cholesterol: totals.totalCholesterol,
                zinc: totals.totalZinc,
                vitaminD: totals.totalVitaminD,
                vitaminB12: totals.totalVitaminB12,
                vitaminC: totals.totalVitaminC,
                vitaminE: totals.totalVitaminE,
              },
            },
          ],
        };

        // Process this meal sequentially - wait for completion before moving to next
        const result = await CaloriesService.createFoodEntry(
          targetPatientId,
          formattedFoodEntry.entries,
          mealDate,
          patient.timeZone
        );

        results.push(result);
      }

      // Check if all entries were successfully created
      const allSuccessful = results.every(
        (result) => result !== null && result !== undefined
      );

      if (allSuccessful) {
        const patientName =
          targetPatientId === this.patientId
            ? "you"
            : `${patient.firstName} ${patient.lastName}`.trim();

        const totalMealsLogged = results.reduce((total, result) => {
          return total + (Array.isArray(result) ? result.length : 0);
        }, 0);

        return `All good, I have logged ${totalMealsLogged} meal(s) for ${patientName}`;
      }

      return "Sorry, I couldn't log all the meals. Please try again.";
    } catch (error) {
      console.error("Error logging meal:", error);
      return "Sorry, I encountered an error while logging the meal. Please try again.";
    }
  }

  private parseDateReference(
    dateReference: string,
    timeZone: string
  ): moment.Moment {
    if (!dateReference) {
      return moment().tz(timeZone);
    }

    const reference = dateReference.toLowerCase().trim();
    const now = moment().tz(timeZone);

    // Check for multiple days (e.g., "tuesday and wednesday", "monday, tuesday")
    const multipleDaysMatch = reference.match(/(\w+)\s+(?:and|,)\s+(\w+)/i);
    if (multipleDaysMatch) {
      // If multiple days are mentioned, return the first day
      // The user will need to clarify which meals go on which day
      const firstDay = multipleDaysMatch[1].toLowerCase();
      const dayOfWeekMap: { [key: string]: number } = {
        monday: 1,
        tuesday: 2,
        wednesday: 3,
        thursday: 4,
        friday: 5,
        saturday: 6,
        sunday: 0,
      };

      if (dayOfWeekMap[firstDay] !== undefined) {
        return this.getDayOfWeek(now, dayOfWeekMap[firstDay]);
      }
    }

    // High confidence patterns
    if (/yesterday|last night/i.test(reference)) {
      return now.clone().subtract(1, "day");
    }
    if (/today|this morning|this afternoon|this evening/i.test(reference)) {
      return now.clone();
    }
    if (/tomorrow/i.test(reference)) {
      return now.clone().add(1, "day");
    }

    // Medium confidence patterns - days ago
    const daysAgoMatch = reference.match(/(\d+) days? ago/i);
    if (daysAgoMatch) {
      return now.clone().subtract(parseInt(daysAgoMatch[1]), "days");
    }

    // Day of week patterns (this week)
    const dayOfWeekMap: { [key: string]: number } = {
      monday: 1,
      tuesday: 2,
      wednesday: 3,
      thursday: 4,
      friday: 5,
      saturday: 6,
      sunday: 0,
    };

    for (const [day, dayNum] of Object.entries(dayOfWeekMap)) {
      if (reference.includes(day)) {
        if (reference.includes("last")) {
          // Last week
          return this.getDayOfWeek(now.clone().subtract(1, "week"), dayNum);
        } else {
          // This week
          return this.getDayOfWeek(now, dayNum);
        }
      }
    }

    // Low confidence patterns - specific dates
    const dateMatch = reference.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (dateMatch) {
      return moment.tz(
        `${dateMatch[3]}-${dateMatch[1].padStart(
          2,
          "0"
        )}-${dateMatch[2].padStart(2, "0")}`,
        timeZone
      );
    }

    const isoDateMatch = reference.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (isoDateMatch) {
      return moment.tz(
        `${isoDateMatch[1]}-${isoDateMatch[2].padStart(
          2,
          "0"
        )}-${isoDateMatch[3].padStart(2, "0")}`,
        timeZone
      );
    }

    // Fallback to current date
    return now.clone();
  }

  private getDayOfWeek(
    referenceDate: moment.Moment,
    dayOfWeek: number
  ): moment.Moment {
    const currentDay = referenceDate.day();
    const daysToSubtract = (currentDay - dayOfWeek + 7) % 7;
    return referenceDate.clone().subtract(daysToSubtract, "days");
  }

  private async handleMixedMealQuery(
    userQuery: string,
    targetPatientId: string,
    timeZone: string,
    containsFav: boolean,
    isMixedQuery: boolean
  ): Promise<string | null> {
    try {
      console.log("🔄 Processing mixed meal query with improved splitting");

      // Use the complex query handler for better multiple favorite detection
      const favoriteDetection =
        await this.detectAndExtractFavoritesFromComplexQuery(
          userQuery,
          targetPatientId
        );

      if (
        !favoriteDetection.success ||
        favoriteDetection.favoriteMeals.length === 0
      ) {
        console.log(
          "No favorite meals detected, falling back to regular processing"
        );
        return null;
      }

      console.log(
        "🎯 Detected favorite meals:",
        favoriteDetection.favoriteMeals
      );
      console.log(
        "📝 Cleaned query for regular meals:",
        favoriteDetection.cleanedQuery
      );

      const results = [];

      // Check if this is ONLY favorite meals (no regular meals)
      if (
        !isMixedQuery &&
        !this.hasRegularMealContent(favoriteDetection.cleanedQuery)
      ) {
        console.log(
          "🎯 Processing ONLY favorite meals - using saved data directly"
        );

        // Log all favorite meals
        for (const favMealInfo of favoriteDetection.favoriteMeals) {
          const favMealResult = await this.logFavoriteMeal(
            favMealInfo.favMeal,
            targetPatientId,
            timeZone,
            favMealInfo.date
          );
          results.push(favMealResult);
        }

        return results.join("\n\n");
      }

      // Process MIXED query (both favorite and regular meals)
      console.log(
        "🔄 Processing MIXED query - splitting favorite and regular meals"
      );

      // 1. Log all favorite meals first (using saved data - NO recalculation)
      for (const favMealInfo of favoriteDetection.favoriteMeals) {
        console.log(
          `🎯 Logging favorite meal: ${favMealInfo.description} on ${favMealInfo.date}`
        );

        const favMealResult = await this.logFavoriteMeal(
          favMealInfo.favMeal,
          targetPatientId,
          timeZone,
          favMealInfo.date
        );
        results.push(favMealResult);
      }

      // 2. Process remaining query as regular meals (only these will be calculated)
      const remainingQuery = favoriteDetection.cleanedQuery;
      if (remainingQuery.trim()) {
        console.log(
          "📊 Calculating nutrients for regular meals only:",
          remainingQuery
        );

        // Use the regular meal processing for the cleaned query
        const regularMealResult = await this.processRegularMealsFromQuery(
          remainingQuery,
          targetPatientId,
          timeZone
        );
        results.push(regularMealResult);
      }

      return results.join("\n\n");
    } catch (error) {
      console.error("Error handling mixed meal query:", error);
      return "❌ Error processing mixed meal query";
    }
  }

  private hasRegularMealContent(cleanedQuery: string): boolean {
    // Check if the cleaned query has substantial content that suggests regular meals
    const trimmed = cleanedQuery.trim();
    if (trimmed.length < 10) return false;

    // Look for meal indicators in the remaining content
    const mealIndicators = [
      "breakfast",
      "lunch",
      "dinner",
      "snack",
      "ate",
      "had",
      "consumed",
      "for",
      "with",
      "and",
      "then",
    ];

    const lowerQuery = trimmed.toLowerCase();
    return mealIndicators.some((indicator) => lowerQuery.includes(indicator));
  }

  private isComplexMultiDayQuery(query: string): boolean {
    // Check if query contains multiple date references and multiple favorite meal indicators
    const datePatterns = [
      /\b(yesterday|today|tomorrow)\b/gi,
      /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi,
      /\b(last|next)\s+(week|month|year)\b/gi,
      /\b\d+\s+days?\s+ago\b/gi,
      /\b\d{1,2}\/\d{1,2}\/\d{4}\b/g,
    ];

    const favoritePatterns = [
      /\bmy\s+favorite\b/gi,
      /\bfavorite\s+(breakfast|lunch|dinner)\b/gi,
      /\bmy\s+usual\b/gi,
      /\bgo-to\b/gi,
      /\bsaved\s+meal\b/gi,
    ];

    const dateMatches = datePatterns.reduce((count, pattern) => {
      const matches = query.match(pattern);
      return count + (matches ? matches.length : 0);
    }, 0);

    const favoriteMatches = favoritePatterns.reduce((count, pattern) => {
      const matches = query.match(pattern);
      return count + (matches ? matches.length : 0);
    }, 0);

    // Consider it complex if there are multiple dates AND multiple favorite references
    return dateMatches >= 2 && favoriteMatches >= 2;
  }

  private isOnlyFavoriteMeals(query: string): boolean {
    // Check if query contains ONLY favorite meal references (no regular meal descriptions)
    const favoritePatterns = [
      /\bmy\s+favorite\b/gi,
      /\bfavorite\s+(breakfast|lunch|dinner)\b/gi,
      /\bmy\s+usual\b/gi,
      /\bgo-to\b/gi,
      /\bsaved\s+meal\b/gi,
    ];

    const regularMealPatterns = [
      /\b(ate|had|consumed|for)\s+(?!my\s+favorite|favorite|my\s+usual|go-to|saved\s+meal)[a-z\s]+(breakfast|lunch|dinner|meal)/gi,
      /\b(breakfast|lunch|dinner|meal)\s+(?!my\s+favorite|favorite|my\s+usual|go-to|saved\s+meal)[a-z\s]+/gi,
      /\bwith\s+[a-z\s]+(?!my\s+favorite|favorite|my\s+usual|go-to|saved\s+meal)/gi,
    ];

    const favoriteMatches = favoritePatterns.reduce((count, pattern) => {
      const matches = query.match(pattern);
      return count + (matches ? matches.length : 0);
    }, 0);

    const regularMatches = regularMealPatterns.reduce((count, pattern) => {
      const matches = query.match(pattern);
      return count + (matches ? matches.length : 0);
    }, 0);

    // Consider it only favorite meals if there are favorite references but no regular meal descriptions
    return favoriteMatches > 0 && regularMatches === 0;
  }

  private async handleComplexMultiDayQuery(
    userQuery: string,
    targetPatientId: string,
    timeZone: string
  ): Promise<string> {
    try {
      console.log(
        "🔄 Processing complex multi-day query with LLM-based favorite detection"
      );

      // Step 1: Use LLM to clean the query and detect favorite meals
      const favoriteDetection =
        await this.detectAndExtractFavoritesFromComplexQuery(
          userQuery,
          targetPatientId
        );

      if (!favoriteDetection.success) {
        console.log(
          "Failed to detect favorites, falling back to regular processing"
        );
        return "❌ Failed to detect favorite meals in complex query";
      }

      console.log(
        "🎯 Detected favorite meals:",
        favoriteDetection.favoriteMeals
      );
      console.log(
        "📝 Cleaned query for regular meals:",
        favoriteDetection.cleanedQuery
      );

      const results = [];

      // Step 2: Process favorite meals using saved data
      for (const favMealInfo of favoriteDetection.favoriteMeals) {
        console.log(
          `🎯 Logging favorite meal: ${favMealInfo.description} on ${favMealInfo.date}`
        );

        const favMealResult = await this.logFavoriteMeal(
          favMealInfo.favMeal,
          targetPatientId,
          timeZone,
          favMealInfo.date
        );
        results.push(favMealResult);
      }

      // Step 3: Process remaining regular meals using calculateMultipleMealsCaloriesAndNutrients
      if (favoriteDetection.cleanedQuery.trim()) {
        console.log("📊 Processing regular meals from cleaned query");

        const foodEntries = await calculateMultipleMealsCaloriesAndNutrients(
          favoriteDetection.cleanedQuery,
          targetPatientId
        );

        if (Array.isArray(foodEntries.meals)) {
          const validMeals = foodEntries.meals.filter((meal) => {
            return (
              meal &&
              typeof meal === "object" &&
              Array.isArray(meal.ingredients) &&
              meal.mealName &&
              meal.mealType
            );
          });

          for (const meal of validMeals) {
            console.log(
              `📊 Logging regular meal: ${meal.mealName} on ${meal.mealDate}`
            );

            const regularMealResult = await this.createRegularMealEntry(
              meal,
              targetPatientId,
              timeZone
            );
            if (regularMealResult) {
              results.push(regularMealResult);
            }
          }
        }
      }

      const patient = await getPatientById(targetPatientId);
      const patientName =
        targetPatientId === this.patientId
          ? "you"
          : `${patient.firstName} ${patient.lastName}`.trim();

      const totalMealsLogged = results.length;

      return `✅ Logged ${totalMealsLogged} meal(s) for ${patientName}`;
    } catch (error) {
      console.error("Error handling complex multi-day query:", error);
      return "❌ Error processing complex meal query";
    }
  }

  private async detectAndExtractFavoritesFromComplexQuery(
    userQuery: string,
    patientId: string
  ): Promise<{
    success: boolean;
    favoriteMeals: Array<{
      description: string;
      mealType: string;
      date: string;
      favMeal: any;
    }>;
    cleanedQuery: string;
  }> {
    try {
      // Get user's favorite meals for matching
      const favMeals = await this.getFavoriteMeals(patientId);

      if (!favMeals || favMeals.length === 0) {
        return {
          success: false,
          favoriteMeals: [],
          cleanedQuery: userQuery,
        };
      }

      // Create a prompt for the LLM to detect and extract favorite meals
      const favMealList = favMeals
        .map((meal) => `- ${meal.description} (${meal.mealType})`)
        .join("\n");

      const prompt = `Analyze this complex multi-day meal query and extract favorite meal references.

**User Query:** "${userQuery}"

**Available Favorite Meals:**
${favMealList}

**Instructions:**
1. Identify ALL favorite meal references in the query (look for "my favorite", "favorite breakfast/lunch/dinner", "my usual", "go-to", etc.)
2. For each favorite meal reference, extract:
   - The exact description from the user query
   - The meal type (breakfast, lunch, dinner)
   - The date reference (yesterday, Monday, etc.)
3. **CRITICAL CLEANING RULES:**
   - If the query contains ONLY favorite meal references (no regular meals), return empty string "" for cleanedQuery
   - If the query contains BOTH favorite meals AND regular meals, RESTRUCTURE the query to create a natural, grammatically correct sentence with only the regular meals
   - **RESTRUCTURE, DON'T JUST REMOVE**: Create a coherent sentence that flows naturally without the favorite meal references
   - Preserve date/time references and maintain proper grammar
   - Be very precise - don't leave any part of the favorite meal reference
4. Match each detected favorite with the closest match from the available favorite meals list

**Response Format (JSON only):**
{
  "favoriteMeals": [
    {
      "description": "exact description from user query",
      "mealType": "breakfast/lunch/dinner",
      "date": "date reference from query",
      "matchedFavMeal": "closest match from available list or null"
    }
  ],
  "cleanedQuery": "restructured query with all favorite meal references removed but regular meals preserved in natural, grammatically correct sentences, or empty string if only favorites"
}

**Examples:**
- Input: "Yesterday I had my favorite breakfast and for lunch pasta carbonara"
- Output: {"favoriteMeals": [{"description": "my favorite breakfast", "mealType": "breakfast", "date": "yesterday", "matchedFavMeal": "Greek Yogurt Bowl"}], "cleanedQuery": "Yesterday for lunch I had pasta carbonara"}

- Input: "Yesterday I had my favorite breakfast for lunch, my favorite rice with peas and carrots, and for dinner two slices of pizza"
- Output: {"favoriteMeals": [{"description": "my favorite breakfast", "mealType": "breakfast", "date": "yesterday", "matchedFavMeal": "Greek Yogurt Bowl"}, {"description": "my favorite rice with peas and carrots", "mealType": "lunch", "date": "yesterday", "matchedFavMeal": "Rice with Peas and Carrots"}], "cleanedQuery": "Yesterday for dinner I had two slices of pizza"}

- Input: "log mi my favorite breakfast and my favorite lunch"
- Output: {"favoriteMeals": [{"description": "my favorite breakfast", "mealType": "breakfast", "date": null, "matchedFavMeal": "Greek Yogurt Bowl"}, {"description": "my favorite lunch", "mealType": "lunch", "date": null, "matchedFavMeal": "Rice with Peas and Carrots"}], "cleanedQuery": ""}

- Input: "I had my favorite breakfast and my usual dinner"
- Output: {"favoriteMeals": [{"description": "my favorite breakfast", "mealType": "breakfast", "date": null, "matchedFavMeal": "Greek Yogurt Bowl"}, {"description": "my usual dinner", "mealType": "dinner", "date": null, "matchedFavMeal": "Some Dinner"}], "cleanedQuery": ""}

- Input: "For breakfast I had my favorite breakfast and for lunch chicken salad"
- Output: {"favoriteMeals": [{"description": "my favorite breakfast", "mealType": "breakfast", "date": null, "matchedFavMeal": "Greek Yogurt Bowl"}], "cleanedQuery": "For lunch I had chicken salad"}`;

      const response = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error("No response from LLM");
      }

      // Parse the JSON response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in response");
      }

      const result = JSON.parse(jsonMatch[0]);

      // Debug: Log the LLM response
      console.log(
        "🔍 LLM Response for complex query:",
        JSON.stringify(result, null, 2)
      );

      // Match the detected favorites with actual saved favorites
      const matchedFavorites = [];
      for (const detectedFav of result.favoriteMeals || []) {
        const matchedFavMeal = this.findBestFavoriteMatch(
          detectedFav.description,
          detectedFav.mealType,
          favMeals
        );

        if (matchedFavMeal) {
          matchedFavorites.push({
            description: detectedFav.description,
            mealType: detectedFav.mealType,
            date: detectedFav.date,
            favMeal: matchedFavMeal,
          });
        }
      }

      return {
        success: true,
        favoriteMeals: matchedFavorites,
        cleanedQuery:
          result.cleanedQuery !== undefined ? result.cleanedQuery : userQuery,
      };
    } catch (error) {
      console.error("Error detecting favorites from complex query:", error);
      return {
        success: false,
        favoriteMeals: [],
        cleanedQuery: userQuery,
      };
    }
  }

  private findBestFavoriteMatch(
    description: string,
    mealType: string,
    favMeals: any[]
  ): any | null {
    const lowerDescription = description.toLowerCase();
    const lowerMealType = mealType.toLowerCase();

    // First try exact type match with description overlap
    for (const favMeal of favMeals) {
      const favMealType = favMeal.mealType?.toLowerCase() || "";
      const favDescription = favMeal.description?.toLowerCase() || "";

      if (favMealType === lowerMealType) {
        // Check for significant overlap
        if (
          favDescription.includes(lowerDescription) ||
          lowerDescription.includes(favDescription) ||
          this.hasSignificantOverlap(favDescription, lowerDescription)
        ) {
          return favMeal;
        }
      }
    }

    // If no exact match, try just type match
    for (const favMeal of favMeals) {
      const favMealType = favMeal.mealType?.toLowerCase() || "";
      if (favMealType === lowerMealType) {
        return favMeal; // Return first match by type
      }
    }

    return null;
  }

  private async getFavoriteMeals(patientId: string): Promise<any[]> {
    try {
      const favMeals = await prisma.favMeal.findMany({
        where: {
          userId: patientId,
        },
        // Phase 3: ingredient rows ride along so a re-logged favorite keeps its breakdown
        include: { ingredients: { include: { ingredients: { orderBy: { sortOrder: "asc" } } } } },
        orderBy: {
          createdAt: "desc",
        },
      });
      return favMeals;
    } catch (error) {
      console.error("Error fetching favorite meals:", error);
      return [];
    }
  }

  private hasSignificantOverlap(
    description1: string,
    description2: string
  ): boolean {
    // Split descriptions into words and check for significant overlap
    const words1 = description1.split(/\s+/).filter((word) => word.length > 2);
    const words2 = description2.split(/\s+/).filter((word) => word.length > 2);

    const commonWords = words1.filter((word) => words2.includes(word));
    const overlapRatio =
      commonWords.length / Math.min(words1.length, words2.length);

    // Consider it a match if there's at least 30% overlap in meaningful words
    return overlapRatio >= 0.3;
  }

  private async processRegularMealsFromQuery(
    query: string,
    targetPatientId: string,
    timeZone: string
  ) {
    try {
      console.log("📊 Processing regular meals from cleaned query:", query);

      // Use the regular meal processing with the cleaned query
      const foodEntries = await calculateMultipleMealsCaloriesAndNutrients(
        query,
        targetPatientId
      );

      if (!Array.isArray(foodEntries.meals)) {
        return "❌ Error: Invalid meal data structure for regular meals";
      }

      const validMeals = foodEntries.meals.filter((meal) => {
        return (
          meal &&
          typeof meal === "object" &&
          Array.isArray(meal.ingredients) &&
          meal.mealName &&
          meal.mealType
        );
      });

      if (validMeals.length === 0) {
        return "❌ No valid regular meal data found";
      }

      // Process meals sequentially
      const results = [];
      for (const entry of validMeals) {
        const regularMealEntry = await this.createRegularMealEntry(
          entry,
          targetPatientId,
          timeZone
        );

        if (regularMealEntry) {
          results.push(regularMealEntry);
        }
      }

      const patient = await getPatientById(targetPatientId);
      const patientName =
        targetPatientId === this.patientId
          ? "you"
          : `${patient.firstName} ${patient.lastName}`.trim();

      const totalMealsLogged = results.reduce((total, result) => {
        return total + (Array.isArray(result) ? result.length : 0);
      }, 0);

      return `✅ Logged ${totalMealsLogged} regular meal(s) for ${patientName}`;
    } catch (error) {
      console.error("Error processing regular meals from query:", error);
      return "❌ Error processing regular meals";
    }
  }

  private async logFavoriteMeal(
    favMeal: any,
    targetPatientId: string,
    timeZone: string,
    dateReference?: string | null
  ) {
    try {
      console.log(
        "🎯 Logging favorite meal using SAVED data (NO recalculation):",
        favMeal.description
      );

      // Create a food entry directly from the favorite meal data (using saved nutritional values)
      // NO recalculation needed - we use the pre-calculated values from when the meal was saved
      const formattedFoodEntry = {
        entries: [
          {
            description: favMeal.description,
            calories: favMeal.calories || 0,
            quantity: favMeal.quantity || "1",
            ingredients: Array.isArray(favMeal.ingredients)
              ? favMeal.ingredients.flatMap((e: any) => e?.ingredients ?? [])
              : [],
            glycemicLoad: favMeal.glycemicLoad || 0,
            vegetableServings: favMeal.vegetableServings || 0,
            fruitServings: favMeal.fruitServings || 0,
            mealType: favMeal.mealType,
            isProcessedFood: favMeal.isProcessedFood || false,
            nutrients: {
              carbohydrates: favMeal.carbohydrates || 0,
              proteins: favMeal.proteins || 0,
              fats: favMeal.fats || 0,
              fiber: favMeal.fiber || 0,
              sodium: favMeal.sodium || 0,
              naturalSugar: favMeal.naturalSugar || 0,
              addedSugar: favMeal.addedSugar || 0,
              calcium: favMeal.calcium || 0,
              magnesium: favMeal.magnesium || 0,
              iron: favMeal.iron || 0,
              potassium: favMeal.potassium || 0,
              omega_3: favMeal.omega_3 || 0,
              cholesterol: favMeal.cholesterol || 0,
              zinc: favMeal.zinc || 0,
              vitaminD: favMeal.vitaminD || 0,
              vitaminB12: favMeal.vitaminB12 || 0,
              vitaminC: favMeal.vitaminC || 0,
              vitaminE: favMeal.vitaminE || 0,
            },
          },
        ],
      };

      // Parse the date reference or use current date
      let mealDate: moment.Moment;
      if (dateReference) {
        try {
          mealDate = this.parseDateReference(dateReference, timeZone);
        } catch (error) {
          console.log(
            "Error parsing date reference, using current date:",
            error
          );
          mealDate = moment().tz(timeZone);
        }
      } else {
        mealDate = moment().tz(timeZone);
      }

      const result = await CaloriesService.createFoodEntry(
        targetPatientId,
        formattedFoodEntry.entries,
        mealDate,
        timeZone
      );

      if (result) {
        const patient = await getPatientById(targetPatientId);
        const patientName =
          targetPatientId === this.patientId
            ? "you"
            : `${patient.firstName} ${patient.lastName}`.trim();

        return `✅ Logged your favorite "${favMeal.description}" for ${patientName}`;
      }

      return "❌ Couldn't log the favorite meal";
    } catch (error) {
      console.error("Error logging favorite meal:", error);
      return "❌ Error logging your favorite meal";
    }
  }

  private async createRegularMealEntry(
    meal: any,
    targetPatientId: string,
    timeZone: string
  ) {
    try {
      // Parse the date from the regular meal processing
      let parsedDate: moment.Moment;
      if (meal.mealDate) {
        try {
          parsedDate = moment.tz(meal.mealDate, timeZone);
          if (!parsedDate.isValid()) {
            parsedDate = this.parseDateReference(meal.mealDate, timeZone);
          }
        } catch (error) {
          parsedDate = moment().tz(timeZone);
        }
      } else {
        parsedDate = moment().tz(timeZone);
      }

      const totals = await this.calculateTotalNutrients(meal.ingredients);
      const formattedFoodEntry = {
        entries: [
          {
            description: meal.mealName || "Meal",
            calories: totals.totalCalories,
            quantity: "1",
            ingredients: meal.ingredients, // Phase 3
            glycemicLoad: meal.glycemicLoad || totals.totalGlycemicLoad,
            vegetableServings: totals.totalVegetableServings,
            fruitServings: totals.totalFruitServings,
            mealType: meal.mealType,
            isProcessedFood: totals.isProcessedFood,
            nutrients: {
              carbohydrates: totals.totalCarbs,
              proteins: totals.totalProteins,
              fats: totals.totalFats,
              fiber: totals.totalFiber,
              sodium: totals.totalSodium,
              naturalSugar: totals.totalNaturalSugar,
              addedSugar: totals.totalAddedSugar,
              calcium: totals.totalCalcium,
              magnesium: totals.totalMagnesium,
              iron: totals.totalIron,
              potassium: totals.totalPotassium,
              omega_3: totals.totalOmega3,
              cholesterol: totals.totalCholesterol,
              zinc: totals.totalZinc,
              vitaminD: totals.totalVitaminD,
              vitaminB12: totals.totalVitaminB12,
              vitaminC: totals.totalVitaminC,
              vitaminE: totals.totalVitaminE,
            },
          },
        ],
      };

      const result = await CaloriesService.createFoodEntry(
        targetPatientId,
        formattedFoodEntry.entries,
        parsedDate,
        timeZone
      );

      return result;
    } catch (error) {
      console.error("Error creating regular meal entry:", error);
      return null;
    }
  }

  private async processRegularMeals(
    query: string,
    targetPatientId: string,
    timeZone: string
  ) {
    try {
      console.log(
        "📊 Calculating nutrients for regular meals (NOT favorite meals):",
        query
      );

      // Only regular meals go through nutrient calculation
      // Favorite meals use saved data directly
      const foodEntries = await calculateMultipleMealsCaloriesAndNutrients(
        query,
        targetPatientId
      );

      // Process the regular meals using existing logic
      if (!Array.isArray(foodEntries.meals)) {
        return "❌ Error: Invalid meal data structure for regular meals";
      }

      const validMeals = foodEntries.meals.filter((meal) => {
        return (
          meal &&
          typeof meal === "object" &&
          Array.isArray(meal.ingredients) &&
          meal.mealName &&
          meal.mealType
        );
      });

      if (validMeals.length === 0) {
        return "❌ No valid regular meal data found";
      }

      // Process meals sequentially
      const results = [];
      for (const entry of validMeals) {
        let mealDate: moment.Moment;
        if (entry.mealDate) {
          try {
            mealDate = moment.tz(entry.mealDate, timeZone);
            if (!mealDate.isValid()) {
              mealDate = this.parseDateReference(entry.mealDate, timeZone);
            }
          } catch (error) {
            mealDate = moment().tz(timeZone);
          }
        } else {
          mealDate = moment().tz(timeZone);
        }

        const totals = await this.calculateTotalNutrients(entry.ingredients);
        const formattedFoodEntry = {
          entries: [
            {
              description: entry.mealName || "Meal",
              calories: totals.totalCalories,
              quantity: "1",
              ingredients: entry.ingredients, // Phase 3: persisted per ingredient (server recomputes totals)
              glycemicLoad: entry.glycemicLoad || totals.totalGlycemicLoad,
              vegetableServings: totals.totalVegetableServings,
              fruitServings: totals.totalFruitServings,
              mealType: entry.mealType,
              isProcessedFood: totals.isProcessedFood,
              nutrients: {
                carbohydrates: totals.totalCarbs,
                proteins: totals.totalProteins,
                fats: totals.totalFats,
                fiber: totals.totalFiber,
                sodium: totals.totalSodium,
                naturalSugar: totals.totalNaturalSugar,
                addedSugar: totals.totalAddedSugar,
                calcium: totals.totalCalcium,
                magnesium: totals.totalMagnesium,
                iron: totals.totalIron,
                potassium: totals.totalPotassium,
                omega_3: totals.totalOmega3,
                cholesterol: totals.totalCholesterol,
                zinc: totals.totalZinc,
                vitaminD: totals.totalVitaminD,
                vitaminB12: totals.totalVitaminB12,
                vitaminC: totals.totalVitaminC,
                vitaminE: totals.totalVitaminE,
              },
            },
          ],
        };

        const result = await CaloriesService.createFoodEntry(
          targetPatientId,
          formattedFoodEntry.entries,
          mealDate,
          timeZone
        );

        results.push(result);
      }

      const patient = await getPatientById(targetPatientId);
      const patientName =
        targetPatientId === this.patientId
          ? "you"
          : `${patient.firstName} ${patient.lastName}`.trim();

      const totalMealsLogged = results.reduce((total, result) => {
        return total + (Array.isArray(result) ? result.length : 0);
      }, 0);

      return `✅ Logged ${totalMealsLogged} regular meal(s) for ${patientName}`;
    } catch (error) {
      console.error("Error processing regular meals:", error);
      return "❌ Error processing regular meals";
    }
  }

  async calculateTotalNutrients(entries: any[]) {
    // Validate entries array
    if (!Array.isArray(entries)) {
      console.error(
        "calculateTotalNutrients: entries is not an array:",
        entries
      );
      return {
        totalCalories: 0,
        totalCarbs: 0,
        totalProteins: 0,
        totalFats: 0,
        totalFiber: 0,
        totalSodium: 0,
        totalNaturalSugar: 0,
        totalAddedSugar: 0,
        totalCalcium: 0,
        totalMagnesium: 0,
        totalIron: 0,
        totalPotassium: 0,
        totalOmega3: 0,
        totalCholesterol: 0,
        totalZinc: 0,
        totalVitaminD: 0,
        totalVitaminB12: 0,
        totalVitaminC: 0,
        totalVitaminE: 0,
        totalVegetableServings: 0,
        totalFruitServings: 0,
        totalGlycemicLoad: 0,
        isProcessedFood: false,
      };
    }

    let totalCalories = 0;
    let totalCarbs = 0;
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
    let totalVegetableServings = 0;
    let totalFruitServings = 0;
    let totalGlycemicLoad = 0;
    let processedFoodCount = 0;

    entries.forEach((entry: any) => {
      totalCalories += entry.calories || 0;
      totalCarbs += entry.nutrients?.carbohydrates || 0;
      totalProteins += entry.nutrients?.proteins || 0;
      totalFats += entry.nutrients?.fats || 0;
      totalFiber += entry.nutrients?.fiber || 0;
      totalSodium += entry.nutrients?.sodium || 0;
      totalNaturalSugar += entry.nutrients?.naturalSugar || 0;
      totalAddedSugar += entry.nutrients?.addedSugar || 0;
      totalCalcium += entry.nutrients?.calcium || 0;
      totalMagnesium += entry.nutrients?.magnesium || 0;
      totalIron += entry.nutrients?.iron || 0;
      totalPotassium += entry.nutrients?.potassium || 0;
      totalOmega3 += entry.nutrients?.omega_3 || 0;
      totalCholesterol += entry.nutrients?.cholesterol || 0;
      totalZinc += entry.nutrients?.zinc || 0;
      totalVitaminD += entry.nutrients?.vitaminD || 0;
      totalVitaminB12 += entry.nutrients?.vitaminB12 || 0;
      totalVitaminC += entry.nutrients?.vitaminC || 0;
      totalVitaminE += entry.nutrients?.vitaminE || 0;
      totalVegetableServings += entry.vegetableServings || 0;
      totalFruitServings += entry.fruitServings || 0;
      // Glycemic load per ingredient = GI x carbs / 100 (same formula the app uses client-side)
      if (typeof entry.glycemicIndex === "number" && entry.nutrients?.carbohydrates) {
        totalGlycemicLoad += (entry.glycemicIndex * entry.nutrients.carbohydrates) / 100;
      }

      // Count processed food items
      if (entry.isProcessedFood) {
        processedFoodCount++;
      }
    });

    return {
      totalCalories: Math.round(totalCalories),
      totalCarbs: Math.round(totalCarbs),
      totalProteins: Math.round(totalProteins),
      totalFats: Math.round(totalFats),
      totalFiber: Math.round(totalFiber),
      totalSodium,
      totalNaturalSugar,
      totalAddedSugar,
      totalCalcium,
      totalMagnesium,
      totalIron,
      totalPotassium,
      totalOmega3,
      totalCholesterol,
      totalZinc,
      totalVitaminD,
      totalVitaminB12,
      totalVitaminC,
      totalVitaminE,
      totalVegetableServings,
      totalFruitServings,
      totalGlycemicLoad,
      isProcessedFood: processedFoodCount > 0, // Set to true if any processed food was included
    };
  }
}

export class SubAccountMealLoggingTool extends Tool {
  name = "sub_account_meal_logging_tool";
  description: "Detects sub-account references and logs meals for family members. Use when user mentions someone else's name in meal context.";

  private llmDetector: LLMSubAccountDetector;

  constructor(private patientId: string, private logMealTool: LogMealTool) {
    super();
    this.llmDetector = new LLMSubAccountDetector();
  }

  async _call(userQuery: string) {
    console.log("Sub-account meal logging tool called with:", userQuery);

    try {
      // Use LLM to detect if this is a meal logging query
      const isMealQuery = await isMealLoggingQueryLLM(userQuery);
      if (!isMealQuery) {
        return "This doesn't appear to be a meal logging request. Please use the regular Log Meal Tool for your own meals.";
      }

      // Use LLM to detect sub-account in the query
      const detection = await this.llmDetector.detectSubAccountInQuery(
        userQuery,
        this.patientId
      );

      console.log("LLM Detection Result:", detection);

      if (!detection.isSubAccountQuery) {
        // No sub-account detected, log for main user
        return await this.logMealTool._call(userQuery);
      }

      if (!detection.targetPatientId) {
        return `I couldn't find a matching sub-account for the name mentioned. Please check the spelling or set up the sub-account first. (Detected: ${detection.subAccountName})`;
      }

      // Log meal for the detected sub-account
      const result = await this.logMealTool._call({
        foodDescription: detection.cleanedQuery,
        targetPatientId: detection.targetPatientId,
      });

      return result;
    } catch (error) {
      console.error("Error in sub-account meal logging:", error);
      return "Sorry, I encountered an error while processing the meal logging request. Please try again.";
    }
  }
}

export class NutritionFeedbackTool extends Tool {
  name = "nutrition_feedback";
  description =
    "Analyze the user's nutrition and provide feedback based on calorie intake, macronutrient balance, and weekly nutrient tracking. Use patient health data such as conditions and allergies to make personalized recommendations.";

  constructor(private patientId: string) {
    super();
  }

  async _call() {
    console.log(
      "Nutrition advices tool called with patientId:",
      this.patientId
    );

    try {
      const patientOverview = await getNutritionOverviewPrompt(this.patientId);
      const fitnessGoal = await prisma.healthGoal.findFirst({
        where: {
          category: "WELLNESS",
          status: "IN_PROGRESS",
        },
      });
      console.log(fitnessGoal);
      const fitnessInstruction = fitnessGoal
        ? `**What this means for your goal:**
      - Connect their patterns to their health goals: ${fitnessGoal.description}
      - End on an encouraging, forward-looking note
      - Emphasize gentle shifts over dramatic changes`
        : "";

      const nutritionAdvicePrompt = `
      You are a **conversational, supportive AI nutritionist**. Your task is to analyze the user's **week nutrition patterns** and provide **warm, encouraging feedback** that focuses on patterns rather than exact numbers. Write in a friendly, conversational tone similar to a caring nutritionist talking to a friend.

      **Here's the detailed patient data to analyze:**
      ${patientOverview}

      ### **Your Response Style Should Be:**
      - **Conversational and warm** - like you're talking to a friend over coffee
      - **Pattern-focused** - look at trends across weeks, not individual numbers
      - **Encouraging** - highlight what they're doing well first
      - **Practical** - give simple, actionable suggestions they can actually follow
      - **Non-judgmental** - treat incomplete logging as normal, not a failure

      ### **Structure Your Response Like This:**

      **Opening:** Start with a warm greeting and acknowledge you've looked at their last 3 weeks of data.

      **What I'm seeing overall:** 
      - Comment on their calorie patterns (are complete weeks close to goal?)
      - Note macro patterns (carb-forward, protein trends, fat levels)
      - Acknowledge incomplete weeks as normal, not problematic

      **What you're doing well:**
      - Highlight 2-3 positive patterns you notice
      - Acknowledge their consistency where it exists
      - Celebrate small wins

      **Where we can improve:**
      - Identify 2-3 areas for gentle improvement
      - Focus on patterns, not specific numbers
      - Frame as "small tweaks" not major overhauls

       ${fitnessInstruction}

      ### **Key Guidelines:**
      - Use phrases like "It looks like...", "I'm seeing...", "What I notice..."
      - Avoid rigid meal planning or exact measurements
      - Focus on energy levels, satiety, and sustainable habits
      - If they have health conditions, weave in gentle, relevant advice
      - Keep the tone supportive and non-overwhelming
      - Use bullet points for easy reading
      - End with encouragement and next steps

     

      **Remember:** Your goal is to make them feel supported and motivated, not overwhelmed or judged. Focus on patterns and gentle improvements.
      `;

      console.log("Returning nutrition advice now...");
      return nutritionAdvicePrompt;
    } catch (error) {
      console.error("❌ ERROR in NutritionFeedbackTool:", error);
      return "Something went wrong while analyzing your nutrition. Please try again later.";
    }
  }
}

export class MultiAccountMealPlanGeneratorTool extends Tool {
  name = "multi_account_meal_plan_generator";
  description =
    "Generate a comprehensive meal plan that considers all subaccounts (family members) dietary restrictions, allergies, and health conditions";

  constructor(private parentPatientId: string) {
    super();
  }

  // _call method where the tool fetches data from all accounts and generates a response
  async _call(userQuery: string) {
    console.log(
      "MultiAccountMealPlanGeneratorTool has been called with parentPatientId:",
      this.parentPatientId
    );

    try {
      // Get aggregated health data from all accounts
      const aggregatedData = await getAggregatedHealthData(
        this.parentPatientId
      );

      const mealPlan = `Generate a comprehensive family meal plan that accommodates all family members' dietary needs and restrictions. 

      **Family Composition:**
      ${aggregatedData.familyMembers
        .map(
          (member) =>
            `- ${member.name} (${member.caloricAmount} kcal/day${
              member.age ? `, age ${member.age}` : ""
            })`
        )
        .join("\n")}

      **Combined Dietary Restrictions & Health Considerations:**
      - **All Allergies (Must Avoid):** ${
        aggregatedData.allAllergies.join(", ") || "None reported"
      }
      - **All Health Conditions:** ${
        aggregatedData.allConditions.join(", ") || "None reported"
      }
      - **Nutritional Preferences:** ${JSON.stringify(
        aggregatedData.combinedNutrition
      )}
      - **Abnormal Lab Results:** ${
        aggregatedData.allAbnormalLabs.join(", ") || "None reported"
      }

      **Meal Plan Requirements:**
      1. **Safety First**: Strictly avoid ALL allergens listed above for ANY family member
      2. **Balanced Nutrition**: Provide appropriate macronutrients and micronutrients for all age groups
      3. **Flexible Portions**: Suggest portion adjustments for different family members based on their caloric needs
      4. **Family-Friendly**: Choose meals that can be easily prepared for the whole family
      5. **Health-Conscious**: Consider all health conditions when selecting ingredients and preparation methods

      **Caloric Distribution Guidelines:**
      - **Breakfast**: 25-30% of daily calories
      - **Lunch**: 30-35% of daily calories  
      - **Snack**: 5-10% of daily calories
      - **Dinner**: 25-30% of daily calories

      **Instructions:**
      - Specify caloric content and quantity for each ingredient
      - Provide portion size recommendations for different family members
      - Include breakfast, lunch, snack, and dinner for the day
      - Ensure meals support the health and wellness of all family members
      - Consider any age-specific nutritional needs (children, adults, seniors)

      **Response Requirement**: The meal plan must explicitly state that it has been carefully crafted to accommodate all family members' dietary restrictions, allergies, conditions, and nutritional preferences.
      - Ensure to **NOT INCLUDE** the fenced code block with json specification.
      - **DO NOT INCLUDE** anything else other than the json.
      Ensure that the response is strictly in JSON format using this structure: ${mealPlanStructureString}.
      - ***REMEMBER TO ATTACH THE TOOL USED***[toolUsed:multi_account_meal_plan_generator]
      `;

      return mealPlan;
    } catch (error) {
      console.error("Error in MultiAccountMealPlanGeneratorTool:", error);
      return "Error generating multi-account meal plan. Please try again.";
    }
  }
}
