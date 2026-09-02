import { verifyToken } from "../../utils/auth_token";
import mealPlanApi from "./controller/meal_plan.controller";

/**
 * Saved meal plans (Aug 2026) — patient-scoped; identity from the token only.
 */
export default class Routes {
  app: any;
  constructor(app: any) {
    this.app = app;
  }

  appRoutes() {
    this.app.get("/api/meal-plan/active", verifyToken, mealPlanApi.fetchActive);
    this.app.post("/api/meal-plan", verifyToken, mealPlanApi.create);
    this.app.put("/api/meal-plan/:planId/meals/:mealId", verifyToken, mealPlanApi.replaceMeal);
    this.app.put("/api/meal-plan/:planId/status", verifyToken, mealPlanApi.updateStatus);
  }

  routesConfig() {
    this.appRoutes();
  }
}
module.exports = Routes;
