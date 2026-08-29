import { verifyToken } from "../../utils/auth_token";
import bloodPressureApi from "./controller/bloodpressure.controller";

export default class Routes {
  app: any;
  constructor(app: any) {
    this.app = app;
  }

  appRoutes() {
    this.app.post(
      "/api/blood_pressure/create_bp_entry",
      verifyToken,
      bloodPressureApi.createBPEntry
    );
    this.app.post(
      "/api/blood_pressure/fetch_daily_tracker",
      verifyToken,
      bloodPressureApi.fetchDailyTracker
    );
    this.app.get(
      "/api/blood_pressure/fetch_weekly_tracker",
      verifyToken,
      bloodPressureApi.fetchWeeklyTracker
    );
    this.app.post(
      "/api/blood_pressure/delete_bp_entry",
      verifyToken,
      bloodPressureApi.deleteBPEntry
    );
  }

  routesConfig() {
    this.appRoutes();
  }
}

module.exports = Routes;
