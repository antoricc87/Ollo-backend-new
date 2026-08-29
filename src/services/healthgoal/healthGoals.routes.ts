import { verifyDoctorToken, verifyToken } from "../../utils/auth_token";
import healthGoalsApi from "../healthgoal/controller/healthGoals.controller";

export default class Routes {
  app: any;

  constructor(app: any) {
    this.app = app;
  }

  appRoutes() {
    // Fetch all health goals by visit ID
    this.app.post(
      "/api/healthGoals/fetchHealthGoals",
      verifyDoctorToken,
      healthGoalsApi.getHealthGoals
    );

    // Create a new health goal

    // Update a health goal

    // Delete a health goal
    //fetch active health goals
    // fetch health goal by id

    //create health goals from mobile app
    // generate trackable healthGoals
    // generate main healthGoal
    //calculating caloric amount
    //generate monthly medical report
  }

  routesConfig() {
    this.appRoutes();
  }
}

module.exports = Routes;
