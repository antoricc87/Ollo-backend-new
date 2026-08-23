import { Request, Response } from "express";
import ExercisesService from "../model/exercises.model";
import { Util } from "../../../utils/response";
import { ObjectId } from "../../../utils/idValidation";

class ExercisesHandler {
  //update or create calories and exercises weekly tracker
  async updateOrCreateWeeklyExercisesAndCalories(
    request: any,
    response: Response
  ) {
    const { id } = request.user;
    const { entries } = request.body;
    if (!entries)
      return response
        .status(404)
        .json(Util.error({}, "Weekly entries are required"));
    try {
      const result = await ExercisesService.updateWeeklyExercisesAndCalories(
        id,
        entries
      );
      if (result)
        return response
          .status(200)
          .json(Util.success({}, "Weekly trackers updated successfully"));
    } catch (error: unknown) {
      return response
        .status(500)
        .json(Util.error({ error }, "Error updating the trackers"));
    }
  }
  //fetching Exercises tracker only with weekly entries
  async fetchExerciseTrackerDaily(request: any, response: Response) {
    const { id } = request.user;
    try {
      const tracker = await ExercisesService.getWeeklyAndDailyExercisesTracker({
        userId: id,
      });
      return response
        .status(200)
        .json(Util.success(tracker ?? null, "Tracker successfully fetched"));
    } catch (error: unknown) {
      return response
        .status(500)
        .json(Util.error({}, "Error fetching the exercise tracker"));
    }
  }

  async fetchExerciseTrackerWeeklyOnly(request: Request, response: Response) {
    const { patientId } = request.body;
    if (!patientId || !ObjectId.isValid(patientId))
      return response
        .status(404)
        .json(
          Util.error({}, "Patient id is required and must be a valid object id")
        );
    try {
      const where = { userId: patientId };
      const tracker = await ExercisesService.getWeeklyExercisesTracker(where);
      if (tracker)
        return response
          .status(200)
          .json(Util.success(tracker, "Tracker successfully fetched"));
    } catch (error: unknown) {
      return response
        .status(500)
        .json(Util.error({ error }, "Error fetching the tracker"));
    }
  }
}

export default new ExercisesHandler();
