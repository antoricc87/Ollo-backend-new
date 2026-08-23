import { Request, Response } from "express";
import CaloriesService from "../model/calories.model";
import { Util } from "../../../utils/response";
import { ObjectId } from "../../../utils/idValidation";
import { getLocalDate } from "../../../utils/localDate";

export class CaloriesHandler {
  //fetch daily entries from tracker id
  async getCaloriesTracker(request: Request, response: Response) {
    const { patientId } = request.body;
    try {
      const where = { userId: patientId };
      const tracker = await CaloriesService.getCaloriesTracker(where);

      if (tracker) {
        return response
          .status(200)
          .json(Util.success(tracker, "Tracker successfully fetched"));
      }
    } catch (error: any) {
      console.error("Error fetching the tracker", error);
      return response
        .status(400)
        .json(Util.error({ error }, "Error fetching the tracker"));
    }
  }
  // get number of days a user has not logged food
  async getDaysWithoutFood(request: any, response: Response) {
    const { id } = request.user;
    try {
      const missingDays = await CaloriesService.getTotalDaysWithNoFood(id);
      if (missingDays)
        return response
          .status(200)
          .json(
            Util.success({ missingDays }, "Missing days generated successfully")
          );
    } catch (error: unknown) {
      return response
        .status(400)
        .json(Util.error({ error }, "Error getting the missing days"));
    }
  }
  //------------------------food related--------------------------//

  async createFoodEntry(request: any, response: Response) {
    const { entries, userId, timeZone, date } = request.body;

    if (!entries || !userId) {
      return response
        .status(400)
        .json(
          Util.error({}, "UserId or food entry data is missing or invalid")
        );
    }

    try {
      const foodEntry = await CaloriesService.createFoodEntry(
        userId,
        entries,
        date,
        timeZone
      );

      if (foodEntry) {
        return response
          .status(200)
          .json(Util.success(foodEntry, "Food entry successfully created"));
      }
    } catch (error: unknown) {
      return response
        .status(400)
        .json(Util.error({ error }, "Error creating food entry"));
    }
  }

  //delete food entry
  async deleteFoodEntry(request: any, response: Response) {
    const { id } = request.user;
    const { entryId, userId } = request.body;
    try {
      const result = await CaloriesService.deleteFoodEntry(userId, entryId);
      if (result)
        return response
          .status(200)
          .json(Util.success({}, "Food entry deleted successfully"));
    } catch (error: unknown) {
      return response
        .status(400)
        .json(Util.error({ error }, `Error deleting the entry,${error}`));
    }
  }

  //create favfood
  async createFavFood(request: Request, response: Response) {
    const { userId, favFood } = request.body;

    try {
      if (!userId || !favFood || !Array.isArray(favFood)) {
        return response
          .status(400)
          .json(Util.error({}, "UserId or food data is missing or invalid"));
      }

      const newFavFoods = await CaloriesService.createFavFood(userId, favFood);

      if (newFavFoods) {
        return response
          .status(200)
          .json(
            Util.success(newFavFoods, "Favorite foods successfully created")
          );
      }
    } catch (error: any) {
      console.error("Error creating favorite foods", error);
      return response
        .status(400)
        .json(Util.error({ error }, "Error creating favorite foods"));
    }
  }

  //delete favfood(s)
  async deleteFavFoods(request: Request, response: Response) {
    const { foodIds } = request.body;

    try {
      // Ensure foodIds is an array and contains at least one element
      if (!foodIds || !Array.isArray(foodIds) || foodIds.length === 0) {
        return response
          .status(400)
          .json(
            Util.error(
              {},
              "Food IDs are required and should be a non-empty array"
            )
          );
      }

      // Call the service to delete multiple foods
      const result = await CaloriesService.deleteFavFoods(foodIds);

      return response
        .status(200)
        .json(Util.success(result, "Favorite food(s) successfully deleted"));
    } catch (error: any) {
      console.error("Error deleting favorite food(s)", error);
      return response
        .status(400)
        .json(Util.error({ error }, "Error deleting favorite food(s)"));
    }
  }

  async getFavFoods(request: Request, response: Response) {
    const { userId } = request.body;

    try {
      if (!userId) {
        return response.status(400).json(Util.error({}, "UserId is missing"));
      }

      const favFoods = await CaloriesService.getFavFoods(userId);

      if (favFoods) {
        return response
          .status(200)
          .json(Util.success(favFoods, "Favorite foods fetched successfully"));
      }
    } catch (error: any) {
      console.error("Error fetching favorite foods", error);
      return response
        .status(400)
        .json(Util.error({ error }, "Error fetching favorite foods"));
    }
  }

  // get food tracker by id
  async fetchFoodTrackerById(request: Request, response: Response) {
    const { userId } = request.body;
    try {
      if (!userId || !ObjectId.isValid(userId))
        return response
          .status(400)
          .json(Util.error({}, "Invalid or missing userId"));

      const where = { userId: userId };
      const tracker = await CaloriesService.getFoodTracker(where);
      if (tracker)
        return response
          .status(200)
          .json(Util.success(tracker, "Tracker fetched successfully"));
    } catch (error: any) {
      return response
        .status(400)
        .json(Util.error(error, "Error fetching the tracker"));
    }
  }
}

export default new CaloriesHandler();
