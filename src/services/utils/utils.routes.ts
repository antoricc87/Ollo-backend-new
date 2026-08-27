import { verifyToken } from "../../utils/auth_token";
import UtilsHandler from "./utils.controller";
export default class Routes {
  app: any;
  constructor(app: any) {
    this.app = app;
  }
  appRoutes() {

    this.app.post(
      "/api/utils/getAffordableTests",
      verifyToken,
      UtilsHandler.getAffordableCareTests
    );
    this.app.post(
      "/api/utils/getInstacartRetailers",
      verifyToken,
      UtilsHandler.getInstacartRetailers
    );
  }
  routesConfig() {
    this.appRoutes();
  }
}

module.exports = Routes;
