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
    this.app.get("/api/workouts", verifyToken, workoutApi.list); // ?from&to&status=completed|planned|all
    this.app.post("/api/workouts/sync", verifyToken, workoutApi.sync);
    // Training week (planned rows under a header) + single planned workouts — fixed paths before :sessionId
    this.app.get("/api/workouts/plan/active", verifyToken, workoutApi.planActive);
    this.app.post("/api/workouts/plan", verifyToken, workoutApi.planCreate);
    this.app.put("/api/workouts/plan/:planId/status", verifyToken, workoutApi.planStatus);
    this.app.post("/api/workouts/planned", verifyToken, workoutApi.planned);
    this.app.get("/api/training-profile", verifyToken, workoutApi.profileGet);
    this.app.put("/api/training-profile", verifyToken, workoutApi.profilePut);
    this.app.get("/api/workouts/:sessionId", verifyToken, workoutApi.get);
    this.app.post("/api/workouts/:sessionId/complete", verifyToken, workoutApi.complete);
    this.app.delete("/api/workouts/:sessionId", verifyToken, workoutApi.remove);
  }

  routesConfig() {
    this.appRoutes();
  }
}
module.exports = Routes;
