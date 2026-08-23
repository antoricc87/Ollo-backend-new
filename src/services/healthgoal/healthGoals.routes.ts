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
    this.app.post(
      "/api/healthGoals/createHealthGoal",
      verifyToken,
      healthGoalsApi.createHealthGoal
    );

    // Update a health goal
    this.app.put(
      "/api/healthGoals/updateHealthGoal",
      verifyToken,
      healthGoalsApi.updateHealthGoal
    );

    // Delete a health goal
    this.app.delete(
      "/api/healthGoals/deleteHealthGoal/:id",
      verifyToken,
      healthGoalsApi.deleteHealthGoal
    );
    //fetch active health goals
    this.app.post(
      "/api/healthGoals/fetchInProgressHealthGoals",
      verifyToken,
      healthGoalsApi.getInProgressHealthGoals
    );
    // fetch health goal by id
    this.app.post(
      "/api/healthGoals/fetchHealthGoalById",
      verifyToken,
      healthGoalsApi.getHealthGoalById
    );

    //create health goals from mobile app
    this.app.post(
      "/api/healthGoals/generateHealthGoalsMobile",
      verifyToken,
      healthGoalsApi.generateHealthGoalsMobile
    );
    // generate trackable healthGoals
    this.app.post(
      "/api/healthGoals/generateTrackableHealthGoals",
      verifyToken,
      healthGoalsApi.generateTrackableHealthGoals
    );
    this.app.post(
      "/api/healthGoals/generateTrackableWellnessGoals",
      verifyToken,
      healthGoalsApi.generateTrackableWellnessGoals
    );
    // generate main healthGoal
    this.app.post(
      "/api/healthGoals/generateMainHealthGoal",
      verifyToken,
      healthGoalsApi.generateMainHealthGoal
    );
    this.app.post(
      "/api/healthGoals/createHealthGoalsWithMetrics",
      verifyToken,
      healthGoalsApi.createHealthGoalWithMetrics
    );
    //calculating caloric amount
    this.app.post(
      "/api/healthGoals/calculateCaloricAmount",
      verifyToken,
      healthGoalsApi.generateCaloricAmount
    );
    //generate monthly medical report
    this.app.post(
      "/api/healthGoals/generateMonthlyReport",
      verifyToken,
      healthGoalsApi.generateMonthlyMedicalReport
    );
  }

  routesConfig() {
    this.appRoutes();
  }
}

module.exports = Routes;
