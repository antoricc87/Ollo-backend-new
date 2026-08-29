import openAiApi from "./controller/openai.controller";
import { verifyToken } from "../../utils/auth_token";
export default class Routes {
  app: any;
  constructor(app: any) {
    this.app = app;
  }

  appRoutes() {

    this.app.post(
      "/api/openai/calculatecalories",
      verifyToken,
      openAiApi.generateCaloriesAmount
    );
    this.app.post(
      "/api/openai/caloriesFromImage",
      verifyToken,
      openAiApi.generateCaloriesFromImage
    );
    this.app.post(
      "/api/openai/caloriesFromAudio",
      verifyToken,
      openAiApi.generateCaloriesFromAudio
    );

  }

  routesConfig() {
    this.appRoutes();
  }
}

module.exports = Routes;
