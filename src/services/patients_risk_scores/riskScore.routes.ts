import { verify } from "crypto";
import { verifyToken } from "../../utils/auth_token";

export default class Routes {
  app: any;

  constructor(app: any) {
    this.app = app;
  }

  appRoutes() {
    this.app.post("/api/patient/:id/cv-risk-scores",verifyToken, );
    this.app.post("/api/patient/:id/calculate-cv-risk", verifyToken, );
  }
  routesConfig() {
    this.appRoutes();
  }
}

module.exports = Routes;
