import { verifyToken } from "../../utils/auth_token";
import workoutApi from "./controller/workouts.controller";

/**
 * Workout sessions — patient-scoped; identity from the token only.
 * The phone syncs HealthKit summaries here; Ollie's log_workout tool writes
 * through the same WorkoutService.
 */
export default class Routes {
  app: any;
  constructor(app: any) {
    this.app = app;
  }

  appRoutes() {
    this.app.get("/api/workouts", verifyToken, workoutApi.list);
    this.app.post("/api/workouts/sync", verifyToken, workoutApi.sync);
    this.app.get("/api/workouts/:sessionId", verifyToken, workoutApi.get);
    this.app.delete("/api/workouts/:sessionId", verifyToken, workoutApi.remove);
  }

  routesConfig() {
    this.appRoutes();
  }
}
module.exports = Routes;
