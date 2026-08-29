import { verifyToken } from "../../utils/auth_token";
import weightApi from "./controller/weight.controller";
export default class Routes {
  app: any;
  constructor(app: any) {
    this.app = app;
  }
  appRoutes() {
    this.app.post(
      "/api/weight/create_weight_entry",
      verifyToken,
      weightApi.createWeightEntry
    );
    this.app.post(
      "/api/weight/delete_weight_entry",
      verifyToken,
      weightApi.deleteWeightEntry
    );
    this.app.post(
      "/api/weight/fetch_weight_tracker",
      verifyToken,
      weightApi.fetchWeightTracker
    );
  }
  routesConfig() {
    this.appRoutes();
  }
}

module.exports = Routes;
