import { ObjectId } from "../../../utils/idValidation";
import Util from "../../../utils/response";
import e, { Request, Response } from "express";
import NutritionService from "../model/nutrition.model";
import { getPatientById } from "../../patient/model/patient.model";
class NutritionHandler {
  //generate portions
  async generatePortions(request: Request, response: Response) {
    const { patientId, mealType, ingredients } = request.body;

    // Validate required fields
    if (!patientId || !ObjectId.isValid(patientId)) {
      return response
        .status(400)
        .json(
          Util.error({}, "PatientId is required and must be a valid ObjectId")
        );
    }

    if (!mealType) {
      return response
        .status(400)
        .json(
          Util.error(
            {},
            "MealType is required (e.g., breakfast, lunch, dinner)"
          )
        );
    }

    if (
      !ingredients ||
      !Array.isArray(ingredients) ||
      ingredients.length === 0
    ) {
      return response
        .status(400)
        .json(
          Util.error(
            {},
            "Ingredients are required and must be a non-empty array"
          )
        );
    }

    try {
      // Fetch patient summary
      const patient = await getPatientById(patientId);
      if (!patient) {
        return response.status(404).json(Util.error({}, "Patient not found"));
      }

      const caloricAmount = patient.patientSummary.caloricAmount;
      if (!caloricAmount) {
        return response
          .status(400)
          .json(Util.error({}, "Patient caloric amount is not defined"));
      }

      // Generate portions using OpenAI API
      const portions = await NutritionService.generatePortionsFromAI(
        mealType,
        caloricAmount,
        ingredients
      );

      return response
        .status(200)
        .json(Util.success(portions, "Portions generated successfully"));
    } catch (error) {
      console.error("Error generating portions", error);
      return response
        .status(500)
        .json(Util.error({ error }, "Error generating portions"));
    }
  }

  //fetch nutrient tracker
  async fetchNutrientsTracker(request: any, response: Response) {
    const { id } = request.user;
    const { patientId } = request.query;
    try {
      const whereClause = { userId: patientId || id };
      const tracker = await NutritionService.getNutrientsTracker(whereClause);
      if (tracker !== null) {
        return response
          .status(200)
          .json(Util.success(tracker, "Tracker successfully fetched"));
      } else {
        return response
          .status(200)
          .json(Util.success(tracker, "Tracker not found or does not exist"));
      }
    } catch (error: unknown) {
      return response
        .status(500)
        .json(Util.error({ error }, "Error fetching the tracker"));
    }
  }

  async fetchWeeklyNutrientsInRange(req: any, res: any) {
    const { id } = req.user;
    const { patientId, startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "startDate and endDate are required",
      });
    }

    try {
      const userId = patientId || id;

      const data = await NutritionService.getWeeklyNutrientsForInterval({
        userId,
        start: new Date(startDate),
        end: new Date(endDate),
      });

      return res.status(200).json({
        success: true,
        message: "Weekly nutrient data fetched successfully",
        data,
      });
    } catch (error) {
      console.error("Error in fetchWeeklyNutrientsInRange:", error);
      return res.status(500).json({
        success: false,
        message: "Error fetching weekly nutrients",
        error,
      });
    }
  }

  //delete nutrient tracker
  async deleteNutriensTracker(request: any, response: Response) {
    const { id } = request.user;
    try {
      const whereClause = { userId: id };
      const result = await NutritionService.deleteNutrientsTracker(whereClause);

      if (result) {
        return response
          .status(200)
          .json(Util.success({}, "Tracker deleted successfully"));
      }
    } catch (error: unknown) {
      return response
        .status(500)
        .json(Util.error({ error }, "Error deleting the tracker"));
    }
  }

  // create fav meal
  async createFavMeal(request: any, response: Response) {
    const { foodEntries, description, mealType } = request.body;
    const { id: userId } = request.user;

    if (!foodEntries || !description) {
      return response
        .status(400)
        .json(Util.error({}, "Food entries and description are required"));
    }

    try {
      const favMeal = await NutritionService.createFavMeal(
        foodEntries,
        userId,
        description,
        mealType
      );

      if (favMeal) {
        return response
          .status(200)
          .json(Util.success(favMeal, "Fav Meal successfully generated"));
      }
    } catch (error: unknown) {
      return response
        .status(400)
        .json(Util.error({ error }, "Error creating the fav meal"));
    }
  }

  //delete fav meal
  async deleteFavMeal(request: Request, response: Response) {
    const { favMealId } = request.body;
    if (!favMealId || !ObjectId.isValid(favMealId))
      return response
        .status(404)
        .json(
          Util.error(
            {},
            "Fav meal id is required and must be a valid object id"
          )
        );
    try {
      const deletedFavMeal = await NutritionService.deleteFavMeal(favMealId);
      if (deletedFavMeal)
        return response
          .status(200)
          .json(Util.success(deletedFavMeal, "Fav meal deleted successfully"));
    } catch (error: unknown) {
      return response
        .status(400)
        .json(Util.error({ error }, "Error deleting the fav meal"));
    }
  }
  // fetch fav meal
  async fetchFavMeals(request: any, response: Response) {
    const { id } = request.user;
    try {
      const where = {
        where: { userId: id },
        include: {
          ingredients: {
            include: { ingredients: { orderBy: { sortOrder: "asc" as const } } },
          },
        },
      };
      const favMeals = await NutritionService.getFavMeals(where);
      if (favMeals) {
        return response
          .status(200)
          .json(Util.success(favMeals, "Fav meals fetched successfully"));
      }
    } catch (error: unknown) {
      return response
        .status(400)
        .json(Util.error({ error }, "Error fetching the tracker"));
    }
  }

  // add generated nutrients and calories
  async addGeneratedNutrientsAndCalories(request: any, response: Response) {
    const { id } = request.user;
    const { scale, missingDays } = request.body;
    if (!scale || !missingDays)
      return response
        .status(400)
        .json(Util.error({}, "Scale and missing days are required"));
    try {
      const result = await NutritionService.addGeneratedValues(
        id,
        scale,
        missingDays
      );
      if (result) {
        return response
          .status(200)
          .json(Util.success({}, "Trackers updated successfully"));
      }
    } catch (error: unknown) {
      return response
        .status(400)
        .json(Util.error({ error }, "Error updating the trackers"));
    }
  }

  //generate caloric amount and optimal nutrients amount
  async generateOptimalCaloricAmountAndNutrients(
    request: any,
    response: Response
  ) {
    const { id } = request.user;
    const { tdee, goals, pace } = request.body;
    try {
      // First, generate optimal caloric intake and macronutrient distribution
      const caloricResult = await NutritionService.generateOptimalCalories(
        id,
        tdee ?? 0,
        goals,
        pace
      );

      // Pass the result to generateNutrientsTotalAmountAndCalories
      const generatedValues =
        await NutritionService.generateNutrientsTotalAmountAndCalories(
          caloricResult,
          id
        );

      if (generatedValues) {
        return response
          .status(200)
          .json(
            Util.success(
              generatedValues,
              "Optimal values generated successfully"
            )
          );
      }
    } catch (error: unknown) {
      return response
        .status(400)
        .json(Util.error({ error }, "Error generating optimal values"));
    }
  }

  //generate caloric amount and optimal calories
  // async generateOptimalCalories(request: any, response: Response) {
  //   const { id } = request.user;
  //   const { tdee } = request.body;
  //   try {
  //     const generatedValues = await NutritionService.generateOptimalCalories(
  //       id,
  //       tdee ?? 0
  //       // healthGoals,
  //       // pace
  //     );
  //     if (generatedValues) {
  //       return response
  //         .status(200)
  //         .json(
  //           Util.success(
  //             generatedValues,
  //             "Optiml values generated successfully"
  //           )
  //         );
  //     }
  //   } catch (error: unknown) {
  //     return response
  //       .status(400)
  //       .json(Util.error({ error }, "Error generating optimal values"));
  //   }
  // }

}

export default new NutritionHandler();
