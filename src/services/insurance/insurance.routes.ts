import { verifyToken } from "../../utils/auth_token";
import insuranceApi from "./controller/insurance.controller";

/**
 * Insurance — the member's own card and plan summary. Patient-scoped; identity
 * from the token only. `PUT /api/labs/insurance` (insurer + plan type from the
 * labs journey) writes the same row.
 */
export default class Routes {
  app: any;
  constructor(app: any) {
    this.app = app;
  }

  appRoutes() {
    this.app.get("/api/insurance", verifyToken, insuranceApi.fetch);
    this.app.put("/api/insurance", verifyToken, insuranceApi.save);
    this.app.delete("/api/insurance", verifyToken, insuranceApi.remove);
    this.app.post("/api/insurance/card/read", verifyToken, insuranceApi.readCard);
    this.app.post("/api/insurance/benefits", verifyToken, insuranceApi.uploadBenefits);
    this.app.delete("/api/insurance/benefits", verifyToken, insuranceApi.removeBenefits);
    this.app.post("/api/insurance/estimate", verifyToken, insuranceApi.estimate);
  }

  routesConfig() {
    this.appRoutes();
  }
}
module.exports = Routes;
