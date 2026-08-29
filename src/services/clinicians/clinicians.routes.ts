import { verifyToken } from "../../utils/auth_token";
import ClinicianHandler from "./controller/clinicians.controller";

/** Patient-token routes over the clinician directory and the caller's care team. */
export default class Routes {
  app: any;
  constructor(app: any) {
    this.app = app;
  }

  appRoutes() {
    this.app.get("/api/clinicians/directory", verifyToken, ClinicianHandler.directory);
    this.app.get("/api/clinicians/care-team", verifyToken, ClinicianHandler.careTeam);
    this.app.post("/api/clinicians/care-team", verifyToken, ClinicianHandler.addToCareTeam);
    this.app.delete("/api/clinicians/care-team/:clinicianId", verifyToken, ClinicianHandler.removeFromCareTeam);
  }

  routesConfig() {
    this.appRoutes();
  }
}

module.exports = Routes;
