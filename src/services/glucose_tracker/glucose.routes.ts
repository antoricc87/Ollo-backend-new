import { verifyToken } from "../../utils/auth_token";
import glucoseApi from "./controller/glucose.controller";
export default class Routes {
  app: any;
  constructor(app: any) {
    this.app = app;
  }

  appRoutes() {
    this.app.post(
      "/api/glucose/create_glucose_entry",
      verifyToken,
      glucoseApi.createGlucoseEntry
    );
    this.app.post(
      "/api/glucose/fetch_daily_tracker",
      verifyToken,
      glucoseApi.fetchDailyTracker
    );
    this.app.get(
      "/api/glucose/fetch_weekly_tracker",
      verifyToken,
      glucoseApi.fetchWeeklyTracker
    );
    this.app.post(
      "/api/glucose/delete_glucose_entry",
      verifyToken,
      glucoseApi.deleteGlucoseEntry
    );
  }
  routesConfig() {
    this.appRoutes();
  }
}

module.exports = Routes;
