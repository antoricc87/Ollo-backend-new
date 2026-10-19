import { FoodEntry } from "@prisma/client";
import dotenv from "dotenv";
import moment from "moment";
import { Nutrients } from "../../../types";
import prisma from "../../../utility/prismaClient";
import { generateNutrientValues } from "../../../utils/calculateMissingNutrientsAndCalories";
import {
  getCurrentWeekRange,
  getCurrentWeekRangeFromDate,
  getPreviousWeekRange,
} from "../../../utils/formatDate";
import CaloriesService from "../../calories_tracker/model/calories.model";
import {
  FAV_MEAL_INCLUDE,
  favMealTotals,
  ingredientsFromFoodEntries,
  loadEntriesForFavourite,
  toPrismaFavIngredient,
} from "./favMealIngredients";
import { getPatientById } from "../../patient/model/patient.model";
import { nutrientLimitTool } from "../schemas/nutrition.schema";
import { getLLM } from "../../agent/llm/openai.client";
dotenv.config();


class NutritionService {

  async generateNutrientsTotalAmount(patientId: string) {
    try {
      const patient = await getPatientById(patientId);

      // Health goals were retired (tables dropped 2026-08-29); the plan
      // (`services/plan`) carries targets now.
      const healthGoals: { trackableMetrics: { value: string; targetValue: string }[] }[] = [];
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

      // Shared client, task "design" (agent/llm/policy.ts) — was its own gpt-4o-mini call (R1, Oct 19 2026).
      let recommendedAmounts: Record<string, any> = await getLLM().json<Record<string, any>>({
        task: "design",
        system: systemContent,
        user: userContent,
        schema: { ...nutrientLimitTool.function.parameters, additionalProperties: false },
        schemaName: "nutrient_limits",
      });

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
  /**
   * Save a favourite from food entries the user already logged.
   *
   * The per-ingredient rows are the point: they are loaded from the DB (not
   * trusted from the request) so logging the favourite later is a verbatim copy
   * — no model call, no resolver call, identical numbers every time. The scalar
   * macro columns are a cache recomputed from those rows.
   */
  async createFavMeal(
    foodEntries: FoodEntry[],
    patientId: string,
    description: string,
    mealType: any,
    options: { slot?: any; aliases?: string[] } = {}
  ) {
    try {
      const ids = (foodEntries || []).map((e: any) => e?.id).filter(Boolean);
      const entries = await loadEntriesForFavourite(ids);
      if (!entries.length) throw new Error("No food entries found for this favourite");
      const ingredients = ingredientsFromFoodEntries(entries);
      if (!ingredients.length) throw new Error("Those food entries have nothing to save");

      const favMeal = await prisma.favMeal.create({
        include: FAV_MEAL_INCLUDE,
        data: {
          userId: patientId,
          description: description,
          mealType: mealType,
          slot: options.slot ?? null,
          aliases: options.aliases ?? [],
          quantity: "1",
          ingredients: { create: ingredients.map(toPrismaFavIngredient) },
          // Kept until FoodEntry.favMealId is dropped, so old clients still read it.
          legacyEntries: { connect: entries.map((e) => ({ id: e.id })) },
          ...favMealTotals(ingredients),
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
        include: { legacyEntries: { select: { id: true } } },
      });

      if (!favMeal) {
        throw new Error("FavMeal not found");
      }

      // FavMealIngredient rows cascade. Only the legacy FoodEntry links have to
      // be unhooked by hand — they are logged meals and must outlive the favourite.
      await prisma.foodEntry.updateMany({
        where: { id: { in: favMeal.legacyEntries.map((entry) => entry.id) } },
        data: { favMealId: null },
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
