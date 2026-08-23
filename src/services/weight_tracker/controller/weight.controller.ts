import { Request, Response } from "express";
import Util from "../../../utils/response";
import WeightService from "../model/weight.model";
import { ObjectId } from "../../../utils/idValidation";
class WeightHandler {
  //create weight entry
  async createWeightEntry(request: any, response: Response) {
    const { id } = request.user;
    const { weight, unit } = request.body;
    console.log(weight);
    if (!weight || !unit)
      return response
        .status(400)
        .json(Util.error({}, "Weight and unit are required"));
    try {
      const weightEntry = await WeightService.createWeightEntry(
        id,
        weight,
        unit
      );
      if (weightEntry)
        return response
          .status(200)
          .json(Util.success(weightEntry, "Weight entry created successfully"));
    } catch (error: unknown) {
      console.error("Something went wrong creating the weight entry", error);
      return response
        .status(400)
        .json(Util.error({ error }, "Error creating the weight entry"));
    }
  }

  //delete weight entry
  async deleteWeightEntry(request: any, response: Response) {
    const { entryId } = request.body;
    if (!entryId || !ObjectId.isValid(entryId))
      return response
        .status(400)
        .json(
          Util.error({}, "Entry id is required and must be a valid ObjectId")
        );
    try {
      const deletedWeightEntry = await WeightService.deleteWeightEntry(entryId);
      if (deletedWeightEntry)
        return response
          .status(200)
          .json(
            Util.success(
              deletedWeightEntry,
              "Weight entry deleted successfully"
            )
          );
    } catch (error: unknown) {
      console.error("Something went wrong deleting the weight entry", error);
      return response
        .status(400)
        .json(Util.error({ error }, "Error deleting the weight entry"));
    }
  }

  // fetch weight tracker
  async fetchWeightTracker(request: any, response: Response) {
    const { id } = request.user;
    const patientId = request.body.patientId ? request.body.patientId : id;
    try {
      const weightTracker = await WeightService.getWeigthTracker(patientId);
      if (weightTracker)
        return response
          .status(200)
          .json(
            Util.success(weightTracker, "Weight tracker successfully fetched")
          );
    } catch (error: unknown) {
      console.error("Error fetching the tracker", error);
      return response
        .status(400)
        .json(Util.error({ error }, "Error fetching the tracker"));
    }
  }
}
export default new WeightHandler();
