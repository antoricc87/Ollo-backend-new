import { verifyToken } from "../../utils/auth_token";
import labsApi from "./controller/labsJourney.controller";

/**
 * Labs journey — patient-scoped; identity from the token only.
 */
export default class Routes {
  app: any;
  constructor(app: any) {
    this.app = app;
  }

  appRoutes() {
    this.app.get("/api/labs/panel", verifyToken, labsApi.fetchPanel);
    this.app.get("/api/labs/risk", verifyToken, labsApi.fetchRisk);
    this.app.get("/api/labs/journey", verifyToken, labsApi.fetchJourney);
    this.app.post("/api/labs/journey", verifyToken, labsApi.startJourney);
    this.app.put("/api/labs/journey", verifyToken, labsApi.updateJourney);
    this.app.put("/api/labs/insurance", verifyToken, labsApi.setInsurance);
  }

  routesConfig() {
    this.appRoutes();
  }
}
module.exports = Routes;
