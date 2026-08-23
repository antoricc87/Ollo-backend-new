import { verifyToken } from "../../utils/auth_token";
import trackableMetricsApi from "../metric/controller/trackableMetrics.controller";

export default class Routes {
  app: any;

  constructor(app: any) {
    this.app = app;
  }

  appRoutes() {
    // Fetch trackable metrics by healthGoalId
    this.app.post(
      "/api/trackableMetrics/fetchTrackableMetrics",
      verifyToken,
      trackableMetricsApi.getTrackableMetrics
    );

    // Create a new trackable metric
    this.app.post(
      "/api/trackableMetrics/createTrackableMetric",
      verifyToken,
      trackableMetricsApi.createTrackableMetric
    );

    // Update a trackable metric
    this.app.put(
      "/api/trackableMetrics/updateTrackableMetric",
      verifyToken,
      trackableMetricsApi.updateTrackableMetric
    );

    // Delete a trackable metric
    this.app.delete(
      "/api/trackableMetrics/deleteTrackableMetric",
      verifyToken,
      trackableMetricsApi.deleteTrackableMetric
    );

    //create trackable metric
    this.app.post(
      "/api/trackableMetrics/createTrackableEntry",
      verifyToken,
      trackableMetricsApi.createMetricEntry
    );

    // get dietary trackables metrics
    this.app.get(
      "/api/trackableMetrics/getDietaryMetrics",
      verifyToken,
      trackableMetricsApi.getDietaryMetrics
    );
  }

  routesConfig() {
    this.appRoutes();
  }
}

module.exports = Routes;
