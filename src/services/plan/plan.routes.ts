import { verifyToken } from "../../utils/auth_token";
import planApi from "./controller/plan.controller";

/**
 * Health Plan v1 — patient-scoped; identity from the token only.
 */
export default class Routes {
  app: any;
  constructor(app: any) {
    this.app = app;
  }

  appRoutes() {
    this.app.get("/api/plan/active", verifyToken, planApi.fetchActivePlan);
    this.app.post("/api/plan/propose", verifyToken, planApi.proposePlan);
    this.app.post("/api/plan", verifyToken, planApi.createPlan);
    this.app.put("/api/plan/:planId/targets", verifyToken, planApi.replaceTargets);
    this.app.put("/api/plan/:planId/watchouts", verifyToken, planApi.replaceWatchOuts);
    this.app.put("/api/plan/:planId/status", verifyToken, planApi.updateStatus);
  }

  routesConfig() {
    this.appRoutes();
  }
}
module.exports = Routes;
