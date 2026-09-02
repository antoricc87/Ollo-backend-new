import moment from "moment";
import {
  MealIngredientInput,
  NUTRIENT_KEYS,
  normalizeIngredientInputs,
  toPrismaIngredient,
  totalsFromIngredients,
} from "./mealIngredients";
import {
  CaloriesTrackerWhereUniqueInput,
  FoodTrackerWhereUniqueInput,
} from "../../../types";
import prisma from "../../../utility/prismaClient";
import {
  getCurrentWeekRange,
  getCurrentWeekRangeFromDate,
  getPreviousWeekRange,
} from "../../../utils/formatDate";
import NutritionService from "../../nutrition/model/nutrition.model";
class CaloriesService {
  // Create daily calories tracker
  async createDailyTracker(
    userId: string,
    caloriesBurned: number,
    caloriesIntake: number,
    date?: any,
    timeZone?: string
  ) {
    try {
      let mainTracker = await prisma.caloriesTracker.findUnique({
        where: { userId: userId },
      });
      if (!mainTracker) mainTracker = await this.createTracker(userId);

      const startOfDay = moment(date)
        .tz(timeZone)
        .startOf("day")
        .format("YYYY-MM-DDTHH:mm:ss.SSS[+00:00]");
      const endOfDay = moment(date)
        .tz(timeZone)
        .endOf("day")
        .format("YYYY-MM-DDTHH:mm:ss.SSS[+00:00]");
      const existingDailyTracker = await prisma.dailyCalories.findFirst({
        where: {
          trackerId: mainTracker.id,
          date: startOfDay,
        },
      });

      if (existingDailyTracker) return existingDailyTracker;

      const dailyTracker = await prisma.dailyCalories.create({
        data: {
          userId: userId,
          caloriesBurned,
          caloriesIntake,
          // date: getLocalDate(new Date()),
          date: startOfDay,
          trackerId: mainTracker.id,
        },
      });

      return dailyTracker;
    } catch (error) {
      console.error("Error creating the daily tracker", error);
      throw error;
    }
  }
  // Create weekly calorie tracker
  async createWeeklyTracker(
    userId: string,
    dayDate: string,
    totalBurned: number,
    totalIntake: number
  ) {
    try {
      const mainTracker = await prisma.caloriesTracker.findUnique({
        where: { userId: userId },
        include: { weeklyEntries: true }, // Include weekly entries for validation
      });

      if (!mainTracker) throw new Error("Main tracker not found for the user.");

      // const { start: startOfWeek, end: endOfWeek } = getCurrentWeekRange();
      const { start: startOfWeek, end: endOfWeek } =
        getCurrentWeekRangeFromDate(dayDate);

      const existingWeeklyTracker = await prisma.weeklyCalories.findFirst({
        where: {
          trackerId: mainTracker.id,
          weekStartDate: {
            gte: startOfWeek,
            lt: endOfWeek,
          },
        },
      });

      if (existingWeeklyTracker) return existingWeeklyTracker;

      const weeklyTracker = await prisma.weeklyCalories.create({
        data: {
          userId,
          weekStartDate: startOfWeek,
          weekEndDate: endOfWeek,
          totalBurned,
          totalIntake,
          trackerId: mainTracker.id,
        },
      });

      return weeklyTracker;
    } catch (error) {
      console.error("Error creating the weekly tracker", error);
      throw error;
    }
  }
  // Create main calories tracker
  async createTracker(userId: string) {
    try {
      const existingTracker = await prisma.caloriesTracker.findUnique({
        where: { userId: userId },
      });

      // if (existingTracker)
      //   throw new Error("Tracker already exists for this user.");
      if (existingTracker) return existingTracker;

      const tracker = await prisma.caloriesTracker.create({
        data: { userId },
      });

      // Optionally, initialize daily and weekly entries
      // await this.createDailyTracker(userId, 0, 0);
      // await this.createWeeklyTracker(userId, new Date(), 0, 0);

      return tracker;
    } catch (error) {
      console.error("Error creating the calories tracker", error);
      throw error;
    }
  }
  //get calories tracker
  async getCaloriesTracker(where: CaloriesTrackerWhereUniqueInput) {
    try {
      return await prisma.caloriesTracker.findUnique({
        where: where,
        include: {
          dailyEntries: true,
          weeklyEntries: { orderBy: { weekEndDate: "desc" } },
        },
      });
    } catch (error: any) {
      console.error("Something went wrong fetching the tracker", error);
      throw error;
    }
  }

  // updating or creating weekly exercise tracker
  async updateOrCreateWeeklyCaloriesTracker(
    userId: string,
    caloriesBurned: number,
    weekStartDate: string,
    weekEndDate: string
  ) {
    try {
      const tracker = await this.getWeeklyCaloriesTrackerByDates(
        userId,
        weekStartDate,
        weekEndDate
      );
      if (tracker !== null) {
        await prisma.weeklyCalories.update({
          where: { id: tracker.id },
          data: {
            totalBurned: caloriesBurned,
          },
        });
      } else if (tracker === null) {
        // fetching main calories tracker
        const mainCaloriesTracker = await this.createTracker(userId);
        await prisma.weeklyCalories.create({
          data: {
            userId: userId,
            totalBurned: caloriesBurned,
            trackerId: mainCaloriesTracker.id,
            totalIntake: 0,
            weekEndDate: weekEndDate,
            weekStartDate: weekStartDate,
          },
        });
      }
    } catch (error: unknown) {
      console.warn("Error updating or creating the exercises tracker", error);
      throw error;
    }
  }
  async updateOrCreateWeeklyIntakeCaloriesTracker(
    userId: string,
    caloriesIntake: number,
    weekStartDate: string,
    weekEndDate: string
  ) {
    try {
      const tracker = await this.getWeeklyCaloriesTrackerByDates(
        userId,
        weekStartDate,
        weekEndDate
      );

      if (tracker !== null) {
        // Build the update object with totalBurned and optionally totalIntake
        const dataToUpdate: {
          totalIntake: number;
        } = {
          totalIntake: tracker.totalIntake + caloriesIntake,
        };

        // Update the tracker with the new values
        await prisma.weeklyCalories.update({
          where: { id: tracker.id },
          data: dataToUpdate,
        });
      } else {
        // If tracker doesn't exist, create a new one
        const mainCaloriesTracker = await this.createTracker(userId);
        await prisma.weeklyCalories.create({
          data: {
            userId: userId,
            totalBurned: 0,
            trackerId: mainCaloriesTracker.id,
            totalIntake: caloriesIntake || 0,
            weekEndDate: weekEndDate,
            weekStartDate: weekStartDate,
          },
        });
      }
    } catch (error: unknown) {
      console.warn(
        "Error updating or creating the weekly calories tracker",
        error
      );
      throw error;
    }
  }
  // count days with no logged food
  async getTotalDaysWithNoFood(patiendId: string) {
    const { start, end } = getPreviousWeekRange();

    try {
      const weeklyCaloriesTracker = await prisma.weeklyCalories.findFirst({
        where: {
          userId: patiendId,
          weekStartDate: start,
          weekEndDate: end,
        },
      });
      const weeklyNutrientsTracker = await prisma.weeklyNutrients.findFirst({
        where: {
          userId: patiendId,
          weekStartDate: start,
          weekEndDate: end,
        },
      });

      // Check if both trackers exist
      if (weeklyNutrientsTracker && weeklyCaloriesTracker) {
        const dailyCalorieEntries = await prisma.dailyCalories.findMany({
          where: {
            userId: patiendId,
            date: { lte: end, gte: start },
          },
        });
        if (!weeklyNutrientsTracker.missingDaysAdded) {
          return 7 - dailyCalorieEntries.length;
        } else {
          return 0;
        }
      }
      // Return 0 if either tracker is missing
      return -1;
    } catch (error: unknown) {
      console.error("Something went wrong checking missing days", error);
    }
  }

  //update daily calories burned
  async updateDailyEntry(
    userId: string,
    calories: number,
    date: any,
    timeZone: string
  ) {
    // const today = new Date();
    // const startOfDay = new Date(today.setUTCHours(0, 0, 0, 0));
    // const endOfDay = new Date(today.setUTCHours(23, 59, 59, 999));
    const startOfDay = moment
      .tz(date, timeZone)
      .startOf("day")
      .format("YYYY-MM-DDTHH:mm:ss.SSS[+00:00]");
    const endOfDay = moment
      .tz(date, timeZone)
      .endOf("day")
      .format("YYYY-MM-DDTHH:mm:ss.SSS[+00:00]");
    try {
      // Attempt to create or get the daily tracker
      const dailyTracker = await this.createDailyTracker(
        userId,
        0,
        0,
        date,
        timeZone
      );
      // Update the weekly entry based on the daily tracker
      let existingWeeklyEntry = await prisma.weeklyCalories.findFirst({
        where: {
          userId: userId,
          weekStartDate: { lte: startOfDay },
          weekEndDate: { gte: startOfDay },
        },
      });

      // Create weekly tracker if it doesn't exist
      if (!existingWeeklyEntry) {
        existingWeeklyEntry = await this.createWeeklyTracker(
          userId,
          startOfDay,
          0,
          calories
        );
      } else {
        // Update the existing weekly entry
        await prisma.weeklyCalories.update({
          where: { id: existingWeeklyEntry.id },
          data: {
            totalIntake: existingWeeklyEntry.totalIntake + calories,
          },
        });
      }

      // Update the daily calories intake
      return await prisma.dailyCalories.update({
        where: { id: dailyTracker.id },
        data: { caloriesIntake: dailyTracker.caloriesIntake + calories },
      });
    } catch (error: any) {
      console.error("Something went wrong updating calories", error);
      throw error;
    }
  }
  // get specific calories weekly tracker by date
  async getWeeklyCaloriesTrackerByDates(
    userId: string,
    weekStartDate: string,
    weekEndDate: string
  ) {
    try {
      const tracker = await prisma.weeklyCalories.findFirst({
        where: {
          userId: userId,
          weekStartDate: weekStartDate,
          weekEndDate: weekEndDate,
        },
        select: {
          id: true,
          totalBurned: true,
          weekEndDate: true,
          weekStartDate: true,
          totalIntake: true,
        },
      });
      return tracker;
    } catch (error: unknown) {
      console.warn("Error fetching weekly tracker");
      throw error;
    }
  }
  //------------------------------food related-----------------------//
  async createFoodTracker(userId: string) {
    try {
      const existingTracker = await prisma.foodTracker.findUnique({
        where: { userId: userId },
      });
      if (!existingTracker) {
        const tracker = await prisma.foodTracker.create({
          data: { userId },
        });

        return tracker;
      }
      return existingTracker;
    } catch (error: any) {
      console.error("Error creating food tracker");
      throw error;
    }
  }
  //create daily food tracker
  async createDailyFoodTracker(userId: string, date: any, timeZone: string) {
    try {
      const mainTracker = await this.createFoodTracker(userId);

      const startOfDay = moment(date)
        .startOf("day")
        .format("YYYY-MM-DDTHH:mm:ss.SSS[+00:00]");
      const endOfDay = moment(date)
        .endOf("day")
        .format("YYYY-MM-DDTHH:mm:ss.SSS[+00:00]");
      const existingDailyTracker = await prisma.dailyFood.findFirst({
        where: {
          trackerId: mainTracker.id,
          date: startOfDay,
        },
      });

      if (existingDailyTracker) return existingDailyTracker;

      const dailyTracker = await prisma.dailyFood.create({
        data: {
          userId: userId,
          date: startOfDay,
          trackerId: mainTracker.id,
        },
      });

      return dailyTracker;
    } catch (error) {
      console.error("Error creating the daily tracker", error);
      throw error;
    }
  }
  //create food entry
  async createFoodEntry(
    userId: string,
    entries: any[],
    date: any,
    timeZone: string
  ) {
    try {
      const dailyFoodTracker = await this.createDailyFoodTracker(
        userId,
        date,
        timeZone
      );

      if (dailyFoodTracker) {
        // Phase 3: when a client sends per-ingredient rows, they are the source of
        // truth — entry totals are recomputed from them before anything is stored.
        entries = entries.map((entry: any) => {
          const ingredients = normalizeIngredientInputs(entry.ingredients);
          if (!ingredients.length) return { ...entry, ingredients: [] };
          const t = totalsFromIngredients(ingredients);
          return {
            ...entry,
            ingredients,
            calories: t.calories,
            nutrients: { ...(entry.nutrients || {}), ...t.nutrients },
            glycemicLoad: t.glycemicLoad,
            vegetableServings: t.vegetableServings,
            fruitServings: t.fruitServings,
            isProcessedFood: t.isProcessedFood,
          };
        });

        const foodEntries = await Promise.all(
          entries.map(async (entry: any) => {
            const foodEntry = await prisma.foodEntry.create({
              include: { ingredients: { orderBy: { sortOrder: "asc" } } },
              data: {
                ingredients: entry.ingredients.length
                  ? {
                      create: entry.ingredients.map((i: MealIngredientInput, idx: number) =>
                        toPrismaIngredient(i, idx)
                      ),
                    }
                  : undefined,
                description: entry.description,
                dailyFoodId: dailyFoodTracker.id,
                quantity: entry.quantity,
                calories: entry.calories,
                carbohydrates: entry.nutrients.carbohydrates,
                proteins: entry.nutrients.proteins,
                fats: entry.nutrients.fats,
                fiber: entry.nutrients.fiber,
                sodium: entry.nutrients.sodium,
                naturalSugar: entry.nutrients.naturalSugar,
                addedSugar: entry.nutrients.addedSugar,
                calcium: entry.nutrients.calcium,
                magnesium: entry.nutrients.magnesium,
                iron: entry.nutrients.iron,
                potassium: entry.nutrients.potassium,
                omega_3: entry.nutrients.omega_3,
                cholesterol: entry.nutrients.cholesterol,
                zinc: entry.nutrients.zinc,
                vitaminD: entry.nutrients.vitaminD,
                vitaminC: entry.nutrients.vitaminC,
                vitaminE: entry.nutrients.vitaminE,
                vitaminB12: entry.nutrients.vitaminB12,
                isProcessedFood: entry.isProcessedFood,
                glycemicLoad: entry.glycemicLoad,
                vegetableServings: entry.vegetableServings,
                fruitServings: entry.fruitServings,
                mealType: entry.mealType,
                portionStop: entry.portionStop ?? null,
                createdAt: date,
              },
            });

            return foodEntry;
          })
        );

        const totalCalories = entries.reduce(
          (acc: number, entry: any) => acc + entry.calories,
          0
        );

        // Check amount of processed food
        const totalProcessedFood = entries.reduce(
          (acc: number, entry: any) => acc + (entry.isProcessedFood ? 1 : 0),
          0
        );

        await this.updateDailyEntry(userId, totalCalories, date, timeZone);

        // Aggregate nutrients for daily tracking
        const reduceAmount = (section: string) => {
          return entries.reduce(
            (acc: number, entry: any) => acc + (Number(entry.nutrients?.[section]) || 0),
            0
          );
        };

        const totalGlycemicLoad = entries.reduce(
          (acc: number, entry: any) => acc + entry.glycemicLoad,
          0
        );

        const totalVegetableServings = entries.reduce(
          (acc: number, entry: any) => acc + (entry.vegetableServings || 0),
          0
        );

        const totalFruitServings = entries.reduce(
          (acc: number, entry: any) => acc + (entry.fruitServings || 0),
          0
        );

        const nutrients = {
          carbohydrates: reduceAmount("carbohydrates"),
          proteins: reduceAmount("proteins"),
          fats: reduceAmount("fats"),
          fiber: reduceAmount("fiber"),
          sodium: reduceAmount("sodium"),
          naturalSugar: reduceAmount("naturalSugar"),
          addedSugar: reduceAmount("addedSugar"),
          calcium: reduceAmount("calcium"),
          magnesium: reduceAmount("magnesium"),
          iron: reduceAmount("iron"),
          potassium: reduceAmount("potassium"),
          cholesterol: reduceAmount("cholesterol"),
          omega_3: reduceAmount("omega_3"),
          zinc: reduceAmount("zinc"),
          vitaminD: reduceAmount("vitaminD"),
          vitaminB12: reduceAmount("vitaminB12"),
          vitaminC: reduceAmount("vitaminC"),
          vitaminE: reduceAmount("vitaminE"),
        };

        await NutritionService.updateDailyWeeklyNutrientTracker(
          userId,
          nutrients,
          date,
          timeZone,
          totalProcessedFood,
          totalGlycemicLoad,
          totalVegetableServings,
          totalFruitServings
        );

        return foodEntries;
      }
    } catch (error: any) {
      console.error("Error creating food entry", error);
      throw error;
    }
  }

  /**
   * Phase 3 — replace the ingredient rows of a logged entry (portion edits),
   * recompute the entry totals from them and move the daily/weekly trackers by
   * the difference. Returns the updated entry with its ingredients.
   */
  async updateFoodEntryIngredients(
    userId: string,
    entryId: string,
    rawIngredients: any[],
    timeZone: string
  ) {
    const ingredients = normalizeIngredientInputs(rawIngredients);
    if (!ingredients.length) throw new Error("At least one ingredient is required.");
    const entry = await prisma.foodEntry.findUnique({
      where: { id: entryId },
      include: { dailyFood: true },
    });
    if (!entry) throw new Error("Food entry not found.");
    if (entry.dailyFood.userId !== userId) throw new Error("Food entry does not belong to this user.");

    const t = totalsFromIngredients(ingredients);
    const deltaCalories = t.calories - (entry.calories || 0);
    const deltaNutrients: any = {};
    for (const k of NUTRIENT_KEYS) {
      if (k === "saturatedFats") continue; // not tracked on the daily/weekly rows
      deltaNutrients[k] = t.nutrients[k] - (Number((entry as any)[k]) || 0);
    }
    const deltaProcessed = (t.isProcessedFood ? 1 : 0) - (entry.isProcessedFood ? 1 : 0);
    const deltaGl = t.glycemicLoad - (entry.glycemicLoad || 0);
    const deltaVeg = t.vegetableServings - (entry.vegetableServings || 0);
    const deltaFruit = t.fruitServings - (entry.fruitServings || 0);

    const updated = await prisma.$transaction(async (tx) => {
      await tx.mealIngredient.deleteMany({ where: { foodEntryId: entryId } });
      return tx.foodEntry.update({
        where: { id: entryId },
        include: { ingredients: { orderBy: { sortOrder: "asc" } } },
        data: {
          calories: t.calories,
          ...Object.fromEntries(
            NUTRIENT_KEYS.filter((k) => k !== "saturatedFats").map((k) => [k, t.nutrients[k]])
          ),
          glycemicLoad: t.glycemicLoad,
          vegetableServings: t.vegetableServings,
          fruitServings: t.fruitServings,
          isProcessedFood: t.isProcessedFood,
          ingredients: { create: ingredients.map((i, idx) => toPrismaIngredient(i, idx)) },
        },
      });
    });

    const date = entry.createdAt;
    if (deltaCalories !== 0) await this.updateDailyEntry(userId, deltaCalories, date, timeZone);
    await NutritionService.updateDailyWeeklyNutrientTracker(
      userId,
      deltaNutrients,
      date,
      timeZone,
      deltaProcessed,
      deltaGl,
      deltaVeg,
      deltaFruit
    );
    return updated;
  }

  // delete foodentry
  async deleteFoodEntry(userId: string, entryId: string) {
    try {
      const entry = await prisma.foodEntry.findUnique({
        where: { id: entryId },
      });

      if (!entry) {
        throw new Error("Food entry not found.");
      }

      const startOfDayString = moment(entry.createdAt)
        .startOf("day")
        // .utcOffset(0, true)
        .format("YYYY-MM-DDTHH:mm:ss.SSS[+00:00]");

      const endOfDayString = moment(entry.createdAt)
        .endOf("day")
        // .utcOffset(0, true)
        .format("YYYY-MM-DDTHH:mm:ss.SSSZ");

      const result = await prisma.$transaction(async (prisma) => {
        const dailyTracker = await prisma.dailyCalories.findFirst({
          where: {
            userId: userId,
            date: { gte: startOfDayString, lte: entry.createdAt },
          },
        });

        if (!dailyTracker) {
          throw new Error("Daily calorie tracker not found.");
        }

        const existingWeeklyEntry = await prisma.weeklyCalories.findFirst({
          where: {
            userId: userId,
            weekStartDate: { lte: entry.createdAt },
            weekEndDate: { gte: entry.createdAt },
          },
        });

        if (!existingWeeklyEntry) {
          throw new Error("Weekly calorie entry not found.");
        }

        await prisma.weeklyCalories.update({
          where: { id: existingWeeklyEntry.id },
          data: {
            totalIntake: Math.max(
              0,
              existingWeeklyEntry.totalIntake - entry.calories
            ),
          },
        });

        await prisma.dailyCalories.update({
          where: { id: dailyTracker.id },
          data: {
            caloriesIntake: Math.max(
              0,
              dailyTracker.caloriesIntake - entry.calories
            ),
          },
        });

        const dailyNutrientsTracker = await prisma.dailyNutrients.findFirst({
          where: {
            userId: userId,
            date: { gte: startOfDayString, lte: endOfDayString },
          },
        });

        const existingWeeklyNutrients = await prisma.weeklyNutrients.findFirst({
          where: {
            userId: userId,
            weekStartDate: { lte: entry.createdAt },
            weekEndDate: { gte: entry.createdAt },
          },
        });

        if (!existingWeeklyNutrients || !dailyNutrientsTracker) {
          throw new Error("Nutrient tracker not found.");
        }

        await prisma.weeklyNutrients.update({
          where: { id: existingWeeklyNutrients.id },
          data: {
            carbohydrates: Math.max(
              0,
              existingWeeklyNutrients.carbohydrates - entry.carbohydrates
            ),
            proteins: Math.max(
              0,
              existingWeeklyNutrients.proteins - entry.proteins
            ),
            fats: Math.max(0, existingWeeklyNutrients.fats - entry.fats),
            fiber: Math.max(0, existingWeeklyNutrients.fiber - entry.fiber),
            sodium: Math.max(0, existingWeeklyNutrients.sodium - entry.sodium),
            naturalSugar: Math.max(
              0,
              existingWeeklyNutrients.naturalSugar - entry.naturalSugar
            ),
            addedSugar: Math.max(
              0,
              existingWeeklyNutrients.addedSugar - entry.addedSugar
            ),
            calcium: Math.max(
              0,
              existingWeeklyNutrients.calcium - entry.calcium
            ),
            magnesium: Math.max(
              0,
              existingWeeklyNutrients.magnesium - entry.magnesium
            ),
            iron: Math.max(0, existingWeeklyNutrients.iron - entry.iron),
            potassium: Math.max(
              0,
              existingWeeklyNutrients.potassium - entry.potassium
            ),
            omega_3: Math.max(
              0,
              existingWeeklyNutrients.omega_3 - entry.omega_3
            ),
            cholesterol: Math.max(
              0,
              existingWeeklyNutrients.cholesterol - entry.cholesterol
            ),
            zinc: Math.max(0, existingWeeklyNutrients.zinc - entry.zinc),
            vitaminD: Math.max(
              0,
              existingWeeklyNutrients.vitaminD - entry.vitaminD
            ),
            vitaminC: Math.max(
              0,
              existingWeeklyNutrients.vitaminC - entry.vitaminC
            ),
            vitaminB12: Math.max(
              0,
              existingWeeklyNutrients.vitaminB12 - entry.vitaminB12
            ),
            vitaminE: Math.max(
              0,
              existingWeeklyNutrients.vitaminE - entry.vitaminE
            ),
            glycemicLoad: Math.max(
              0,
              (existingWeeklyNutrients.glycemicLoad ?? 0) -
                (entry.glycemicLoad ?? 0)
            ),
            vegetableServings: Math.max(
              0,
              (existingWeeklyNutrients.vegetableServings ?? 0) -
                (entry.vegetableServings ?? 0)
            ),
            fruitServings: Math.max(
              0,
              (existingWeeklyNutrients.fruitServings ?? 0) -
                (entry.fruitServings ?? 0)
            ),
            processedFoodCount: Math.max(
              0,
              existingWeeklyNutrients.processedFoodCount -
                (entry.isProcessedFood ? 1 : 0)
            ),
          },
        });

        await prisma.dailyNutrients.update({
          where: { id: dailyNutrientsTracker.id },
          data: {
            carbohydrates: Math.max(
              0,
              dailyNutrientsTracker.carbohydrates - entry.carbohydrates
            ),
            proteins: Math.max(
              0,
              dailyNutrientsTracker.proteins - entry.proteins
            ),
            fats: Math.max(0, dailyNutrientsTracker.fats - entry.fats),
            fiber: Math.max(0, dailyNutrientsTracker.fiber - entry.fiber),
            sodium: Math.max(0, dailyNutrientsTracker.sodium - entry.sodium),
            naturalSugar: Math.max(
              0,
              dailyNutrientsTracker.naturalSugar - entry.naturalSugar
            ),
            addedSugar: Math.max(
              0,
              dailyNutrientsTracker.addedSugar - entry.addedSugar
            ),
            calcium: Math.max(0, dailyNutrientsTracker.calcium - entry.calcium),
            magnesium: Math.max(
              0,
              dailyNutrientsTracker.magnesium - entry.magnesium
            ),
            iron: Math.max(0, dailyNutrientsTracker.iron - entry.iron),
            potassium: Math.max(
              0,
              dailyNutrientsTracker.potassium - entry.potassium
            ),
            omega_3: Math.max(0, dailyNutrientsTracker.omega_3 - entry.omega_3),
            cholesterol: Math.max(
              0,
              dailyNutrientsTracker.cholesterol - entry.cholesterol
            ),
            zinc: Math.max(0, dailyNutrientsTracker.zinc - entry.zinc),
            vitaminD: Math.max(
              0,
              dailyNutrientsTracker.vitaminD - entry.vitaminD
            ),
            vitaminC: Math.max(
              0,
              dailyNutrientsTracker.vitaminC - entry.vitaminC
            ),
            vitaminB12: Math.max(
              0,
              dailyNutrientsTracker.vitaminB12 - entry.vitaminB12
            ),
            vitaminE: Math.max(
              0,
              dailyNutrientsTracker.vitaminE - entry.vitaminE
            ),
            glycemicLoad: Math.max(
              0,
              (dailyNutrientsTracker.glycemicLoad ?? 0) -
                (entry.glycemicLoad ?? 0)
            ),
            vegetableServings: Math.max(
              0,
              (dailyNutrientsTracker.vegetableServings ?? 0) -
                (entry.vegetableServings ?? 0)
            ),
            fruitServings: Math.max(
              0,
              (dailyNutrientsTracker.fruitServings ?? 0) -
                (entry.fruitServings ?? 0)
            ),
            processedFoodCount: Math.max(
              0,
              dailyNutrientsTracker.processedFoodCount -
                (entry.isProcessedFood ? 1 : 0)
            ),
          },
        });

        await prisma.foodEntry.delete({
          where: { id: entry.id },
        });

        return true;
      });
      if (result) return true;
      return false;
    } catch (error: unknown) {
      console.error("Something went wrong deleting the entry", error);
      throw error;
    }
  }

  //create favfood
  async createFavFood(userId: string, favFoodArray: any[]) {
    try {
      const newFavFoods = await Promise.all(
        favFoodArray.map(async (favFood) => {
          return await prisma.favFood.create({
            data: {
              patientId: userId,
              description: favFood.description,
              quantity: favFood.quantity,
              calories: favFood.calories,
              carbohydrates: favFood.carbohydrates,
              proteins: favFood.proteins,
              fats: favFood.fats,
              fiber: favFood.fiber,
              sodium: favFood.sodium,
              naturalSugar: favFood.naturalSugar,
              addedSugar: favFood.addedSugar,
              calcium: favFood.calcium,
              magnesium: favFood.magnesium,
              iron: favFood.iron,
              potassium: favFood.potassium,
              omega_3: favFood.omega_3,
              cholesterol: favFood.cholesterol,
              zinc: favFood.zinc,
              vitaminD: favFood.vitaminD,
              vitaminC: favFood.vitaminC,
              vitaminB12: favFood.vitaminB12,
              vitaminE: favFood.vitaminE,
              createdAt: new Date().toISOString(),
            },
          });
        })
      );

      return newFavFoods; // Return the list of created entries
    } catch (error: any) {
      console.error("Error creating favorite food", error);
      throw error;
    }
  }

  //get favfood
  async getFavFoods(userId: string) {
    try {
      const favFoods = await prisma.favFood.findMany({
        where: { patientId: userId },
        orderBy: { createdAt: "desc" },
      });

      return favFoods;
    } catch (error: any) {
      console.error("Error fetching favorite foods", error);
      throw error;
    }
  }

  //delete multiple favfoods
  async deleteFavFoods(foodIds: string[]) {
    try {
      const deletedFavFoods = await prisma.favFood.deleteMany({
        where: { id: { in: foodIds } },
      });
      return deletedFavFoods;
    } catch (error: any) {
      console.error("Error deleting favorite foods", error);
      throw error;
    }
  }

  // get food tracker
  async getFoodTracker(where: FoodTrackerWhereUniqueInput) {
    try {
      const tracker = await prisma.foodTracker.findUnique({
        where: where,
        include: {
          dailyEntries: {
            include: {
              foodEntries: {
                include: { ingredients: { orderBy: { sortOrder: "asc" } } },
              },
            },
          },
          weeklyEntries: true,
        },
      });
      return tracker;
    } catch (error: any) {
      console.error("Error fetching food tracker", error);
      throw error;
    }
  }
}

export default new CaloriesService();
