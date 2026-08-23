import { verifyToken } from "../../utils/auth_token";
import UserGeneratedDataHandler from "./controller/user_generated_data.controlle";
export default class Routes {
  app: any;
  constructor(app: any) {
    this.app = app;
  }

  appRoutes() {
    this.app.get(
      "/api/userGeneratedData/fetchAdultsMealplan",
      verifyToken,
      UserGeneratedDataHandler.fetchAdultsMealPlans
    );
    this.app.get(
      "/api/userGeneratedData/fetchSubAccountMealplans",
      verifyToken,
      UserGeneratedDataHandler.fetchSubAccountMealPlans
    );
  }

  routesConfig() {
    this.appRoutes();
  }
}

module.exports = Routes;
