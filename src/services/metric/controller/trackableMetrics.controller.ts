import { Request, Response } from "express";
import TrackableMetricService from "../model/trackableMetrics.model";
import { Util } from "../../../utils/response";
import { ObjectId } from "../../../utils/idValidation";

export class TrackableMetricHandler {
  // Fetch trackable metrics by healthGoalId
  async getTrackableMetrics(request: Request, response: Response) {
    const { healthGoalId } = request.body;
    try {
      const where = { healthGoalId: healthGoalId };
      const trackableMetrics = await TrackableMetricService.getTrackableMetrics(
        where
      );

      if (trackableMetrics) {
        return response
          .status(200)
          .json(
            Util.success(
              trackableMetrics,
              "Trackable metrics successfully fetched"
            )
          );
      }
    } catch (error: any) {
      console.error("Error fetching the trackable metrics", error);
      return response
        .status(400)
        .json(Util.error({ error }, "Error fetching the trackable metrics"));
    }
  }

  // Create a new trackable metric
  async createTrackableMetric(request: any, response: Response) {
    const {
      healthGoalId,
      description,
      targetValue,
      currentValue,
      unit,
      value,
      category,
      frequency,
      reviewDate,
      patientId,
    } = request.body;

    try {
      const newTrackableMetric =
        await TrackableMetricService.createTrackableMetric({
          healthGoalId,
          description,
          targetValue,
          currentValue,
          unit,
          value,
          category,
          frequency,
          reviewDate,
          patientId,
        });
      return response
        .status(201)
        .json(
          Util.success(
            newTrackableMetric,
            "Trackable metric successfully created"
          )
        );
    } catch (error: any) {
      console.error("Error creating the trackable metric", error);
      return response
        .status(400)
        .json(Util.error({ error }, "Error creating the trackable metric"));
    }
  }

  // Update a trackable metric
  async updateTrackableMetric(request: Request, response: Response) {
    const {
      id,
      description,
      targetValue,
      currentValue,
      unit,
      category,
      frequency,
      reviewDate,
    } = request.body;
    try {
      const updatedTrackableMetric =
        await TrackableMetricService.updateTrackableMetric(id, {
          description,
          targetValue,
          currentValue,
          unit,
          category,
          frequency,
          reviewDate,
        });
      return response
        .status(200)
        .json(
          Util.success(
            updatedTrackableMetric,
            "Trackable metric successfully updated"
          )
        );
    } catch (error: any) {
      console.error("Error updating the trackable metric", error);
      return response
        .status(400)
        .json(Util.error({ error }, "Error updating the trackable metric"));
    }
  }

  // Delete a trackable metric
  async deleteTrackableMetric(request: Request, response: Response) {
    const { id } = request.body;
    try {
      const deletedTrackableMetric =
        await TrackableMetricService.deleteTrackableMetric(id);
      return response
        .status(200)
        .json(
          Util.success(
            deletedTrackableMetric,
            "Trackable metric successfully deleted"
          )
        );
    } catch (error: any) {
      console.error("Error deleting the trackable metric", error);
      return response
        .status(400)
        .json(Util.error({ error }, "Error deleting the trackable metric"));
    }
  }

  // Get dietary trackable metrics
  async getDietaryMetrics(request: any, response: Response) {
    const { userId } = request.user.id;
    try {
      const metrics = await TrackableMetricService.getDietaryTrackableMetrics(
        userId
      );
      if (metrics)
        return response
          .status(200)
          .json(Util.success(metrics, "Metrics fetched successfully"));
    } catch (error: unknown) {
      return response
        .status(400)
        .json(Util.error({ error }, "Error fetching the metrics"));
    }
  }

  //------------------------metric entrie related--------------------------//
  async createMetricEntry(request: Request, response: Response) {
    const { data } = request.body;
    try {
      // checking that trackablemetricid is not missing
      if (!data.trackableMetricId || !ObjectId.isValid(data.trackableMetricId))
        return response
          .status(400)
          .json(
            Util.error(
              {},
              "TrackableMetricId is required and must be a valid object id"
            )
          );
      // checking that the entry's value is not missing
      if (!data.value)
        return response
          .status(400)
          .json(Util.error({}, "Value is required for the entry"));
      // creating entry
      const entry = await TrackableMetricService.createMetricEntry(data);
      if (entry)
        return response
          .status(200)
          .json(Util.success(entry, "Entry successfully created"));
    } catch (error: unknown) {
      response
        .status(400)
        .json(Util.error({ error }, "Error creating the entry"));
    }
  }
}

export default new TrackableMetricHandler();
