import openAiApi from "./controller/openai.controller";
import { verifyDoctorToken, verifyToken } from "../../utils/auth_token";
export default class Routes {
  app: any;
  constructor(app: any) {
    this.app = app;
  }

  appRoutes() {
    this.app.post(
      "/api/openai/generate-note",
      verifyDoctorToken,
      openAiApi.generateNote
    );

    this.app.post(
      "/api/openai/generate-medical-coding",
      verifyDoctorToken,
      openAiApi.generateMedicalCoding
    );
    this.app.post(
      "/api/openai/generate-claims-submission",
      verifyDoctorToken,
      openAiApi.generateClaimsSubmission
    );
    this.app.post(
      "/api/openai/generate-referral-letter",
      verifyDoctorToken,
      openAiApi.generateReferralLetter
    );
    this.app.post(
      "/api/openai/generate-preauth-letter",
      verifyDoctorToken,
      openAiApi.generatePreAuthLetter
    );
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
