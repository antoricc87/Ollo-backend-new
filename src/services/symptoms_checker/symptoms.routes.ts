import { verifyToken } from "../../utils/auth_token";
import SymptomsApi from "./controller/symptoms.controller";
export default class Routes {
  app: any;
  constructor(app: any) {
    this.app = app;
  }
  appRoutes() {
    this.app.post(
      "/api/symptoms_checker/generate_initial_questions",
      verifyToken,
      SymptomsApi.generateInitialQuestions
    );
    this.app.post(
      "/api/symptoms_checker/generate_followup_questions",
      verifyToken,
      SymptomsApi.generateFollowUpQuestions
    );
    this.app.post(
      "/api/symptoms_checker/generate_diagnosis",
      verifyToken,
      SymptomsApi.generatePossibleDiagnosis
    );
  }
  routesConfig() {
    this.appRoutes();
  }
}

module.exports = Routes;
