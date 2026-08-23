import { verifyToken } from "../../utils/auth_token";
import UtilsHandler from "./utils.controller";
export default class Routes {
  app: any;
  constructor(app: any) {
    this.app = app;
  }
  appRoutes() {
    this.app.post("/api/utils/parsePDF", UtilsHandler.parsePDF);

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
    this.app.post(
      "/api/utils/validateCode",
      verifyToken,
      UtilsHandler.validatePromoCode
    );
    this.app.post(
      "/api/utils/getFoodInfo",
      verifyToken,
      UtilsHandler.getFoodProductInfo
    );
    this.app.post("/transcribe", UtilsHandler.transcribe);
  }
  routesConfig() {
    this.appRoutes();
  }
}

module.exports = Routes;
