import { verify } from "crypto";
import { verifyDoctorToken, verifyToken } from "../../utils/auth_token";
import exercisesApi from "./controller/exercises.controller";

export default class Routes {
  app: any;
  constructor(app: any) {
    this.app = app;
  }
  appRoutes() {
    this.app.post(
      "/api/update_weekly_trackers",
      verifyToken,
      exercisesApi.updateOrCreateWeeklyExercisesAndCalories
    );
    this.app.post(
      "/api/exercises/fetch_tracker_weekly_only",
      verifyToken,
      exercisesApi.fetchExerciseTrackerWeeklyOnly
    );
    this.app.post(
      "/api/exercises/fetch_tracker_daily",
      verifyToken,
      exercisesApi.fetchExerciseTrackerDaily
    );
    this.app.post(
      "/api/exercises/doctor/fetch_tracker_weekly_only",
      verifyDoctorToken,
      exercisesApi.fetchExerciseTrackerWeeklyOnly
    );
  }
  routesConfig() {
    this.appRoutes();
  }
}

module.exports = Routes;
