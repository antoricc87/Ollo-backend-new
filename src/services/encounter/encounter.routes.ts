import { verifyToken } from "../../utils/auth_token";
import encounterApi from "./controller/encounter.controller";

/**
 * Check-in ("encounter") — patient-scoped; identity from the token only.
 * See src/services/encounter/domain for what these endpoints may and may not say.
 */
export default class Routes {
  app: any;
  constructor(app: any) {
    this.app = app;
  }

  appRoutes() {
    this.app.post("/api/encounters", verifyToken, encounterApi.start);
    this.app.get("/api/encounters", verifyToken, encounterApi.list);
    // BEFORE /:encounterId — otherwise "open" is read as an id.
    this.app.get("/api/encounters/open", verifyToken, encounterApi.open);
    this.app.get("/api/encounters/:encounterId", verifyToken, encounterApi.fetch);
    this.app.post("/api/encounters/:encounterId/answer", verifyToken, encounterApi.answer);
    this.app.get("/api/encounters/:encounterId/handout", verifyToken, encounterApi.handout);
    this.app.post("/api/encounters/:encounterId/close", verifyToken, encounterApi.close);
    this.app.post("/api/encounters/:encounterId/checkin", verifyToken, encounterApi.checkIn);
    this.app.get("/api/encounters/:encounterId/checkins", verifyToken, encounterApi.history);
  }

  routesConfig() {
    this.appRoutes();
  }
}
module.exports = Routes;
