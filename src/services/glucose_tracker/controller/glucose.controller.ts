import { ObjectId } from "../../../utils/idValidation";
import { Request, Response } from "express";
import Util from "../../../utils/response";
import GlucoseService from "../model/glucose.model";

class GlucoseHandler {
  async fetchDailyTracker(request: any, response: Response) {
    const { id } = request.user;
    const patientId = request.body.patientId ? request.body.patientId : id;
    try {
      const tracker = await GlucoseService.fetchDailyGlucoseTracker(patientId);
      if (tracker)
        return response
          .status(200)
          .json(Util.success(tracker, "Tracker successfully fetched"));
    } catch (error: unknown) {
      return response
        .status(400)
        .json(Util.error({ error }, "Error fetching the tracker"));
    }
  }
  async fetchWeeklyTracker(request: any, response: Response) {
    const { id } = request.user;
    try {
      const tracker = await GlucoseService.fetchWeeklyGlucoseTracker(id);
      if (tracker)
        return response
          .status(200)
          .json(Util.success(tracker, "Tracker successfully fetched"));
    } catch (error: unknown) {
      return response
        .status(400)
        .json(Util.error({ error }, "Error fetching the tracker"));
    }
  }
  async createGlucoseEntry(request: any, response: Response) {
    const { id } = request.user;
    const { value, date } = request.body;
    if (!value || !date)
      return response
        .status(400)
        .json(Util.error({}, "glucose value and date are required"));
    try {
      const glucoseEntry = await GlucoseService.createGlucoseEntry(
        id,
        date,
        value
      );
      if (glucoseEntry)
        return response
          .status(200)
          .json(
            Util.success(glucoseEntry, "Glucose entry successfully created")
          );
    } catch (error: unknown) {
      return response
        .status(400)
        .json(Util.error({ error }, "Error creating glucose entry"));
    }
  }
  async deleteGlucoseEntry(request: Request, response: Response) {
    const { entryId } = request.body;
    if (!entryId || !ObjectId.isValid(entryId))
      return response
        .status(400)
        .json(
          Util.error({}, "EntryId is required and must be a valid onject id")
        );
    try {
      const deletedEntry = await GlucoseService.deleteGlucoseEntry(entryId);
      if (deletedEntry)
        return response
          .status(200)
          .json(Util.success(deletedEntry, "Entry successfully deleted"));
    } catch (error: unknown) {
      return response
        .status(400)
        .json(Util.error({ error }, "Error deleting the entry"));
    }
  }
}

export default new GlucoseHandler();
