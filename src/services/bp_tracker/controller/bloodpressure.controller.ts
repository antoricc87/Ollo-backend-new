import { ObjectId } from "../../../utils/idValidation";
import { Request, Response } from "express";
import Util from "../../../utils/response";
import BloodPressureService from "../model/bloodpressure.model";

class BloodPressureHandler {
  async fetchDailyTracker(request: any, response: Response) {
    const { id } = request.user;
    const patientId = request.body.patientId ? request.body.patientId : id;
    try {
      const tracker = await BloodPressureService.fetchDailyBPTracker(patientId);
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
      const tracker = await BloodPressureService.fetchWeeklyBPTracker(id);
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

  async createBPEntry(request: any, response: Response) {
    const { id } = request.user;
    const { systolic, diastolic, pulse, date } = request.body;

    if (!systolic || !diastolic || !date)
      return response
        .status(400)
        .json(
          Util.error({}, "Systolic, diastolic values, and date are required")
        );
    try {
      const bpEntry = await BloodPressureService.createBPEntry(
        id,
        date,
        systolic,
        diastolic,
        pulse
      );
      if (bpEntry)
        return response
          .status(200)
          .json(
            Util.success(bpEntry, "Blood Pressure entry successfully created")
          );
    } catch (error: unknown) {
      return response
        .status(400)
        .json(Util.error({ error }, "Error creating BP entry"));
    }
  }

  async deleteBPEntry(request: Request, response: Response) {
    const { entryId } = request.body;
    if (!entryId || !ObjectId.isValid(entryId))
      return response
        .status(400)
        .json(
          Util.error({}, "EntryId is required and must be a valid object id")
        );
    try {
      const deletedEntry = await BloodPressureService.deleteBPEntry(entryId);
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

export default new BloodPressureHandler();
