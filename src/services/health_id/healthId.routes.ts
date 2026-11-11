import { verifyToken } from "../../utils/auth_token";
import healthIdApi from "./controller/healthId.controller";

/**
 * Health ID — who the person is and what they want from Ollo
 * (../docs/onboarding-health-id-plan.md). Patient-scoped; identity from the
 * token only. Facts come from the record; these routes edit the story.
 */
export default class Routes {
  app: any;
  constructor(app: any) {
    this.app = app;
  }

  appRoutes() {
    this.app.get("/api/health-id", verifyToken, healthIdApi.fetch);
    this.app.put("/api/health-id/sections/:section", verifyToken, healthIdApi.editSection);
    this.app.delete("/api/health-id", verifyToken, healthIdApi.reset);
    this.app.post("/api/health-id/story", verifyToken, healthIdApi.understand);
    this.app.post("/api/health-id/story/confirm", verifyToken, healthIdApi.confirm);
    this.app.post("/api/onboarding/complete", verifyToken, healthIdApi.complete);
  }

  routesConfig() {
    this.appRoutes();
  }
}
module.exports = Routes;
