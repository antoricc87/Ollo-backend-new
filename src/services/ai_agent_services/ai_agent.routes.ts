import { verifyToken } from "../../utils/auth_token";
import AIAgentHandler from "./controller/ai_agent.controller";

export default class Routes {
  app: any;
  constructor(app: any) {
    this.app = app;
  }

  appRoutes() {
    this.app.post(
      "/api/ai_agent/callNutritionAgent",
      verifyToken,
      AIAgentHandler.callNutritionAgent
    );
    this.app.post(
      "/api/ai_agent/callFitnessAgent",
      verifyToken,
      AIAgentHandler.callFitnessAgent
    );
    this.app.post(
      "/api/ai_agent/callHealthAgent",
      verifyToken,
      AIAgentHandler.callHealthAgent
    );
    this.app.post(
      "/api/ai_agent/callGeneralAgent",
      verifyToken,
      AIAgentHandler.callGeneralAgent
    );
  }
  routesConfig() {
    this.appRoutes();
  }
}

module.exports = Routes;
