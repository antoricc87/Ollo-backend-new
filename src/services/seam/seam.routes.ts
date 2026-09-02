import SeamHandler from "./controller/seam.controller";
import { logSeamAccess, requireClinician, requireSeamKey } from "./seam.auth";

/**
 * `/api/seam/*` — service-to-service API for the clinician service.
 * Bearer service key on every route; clinician header + grant check on
 * patient-scoped ones. Nothing here accepts a patient JWT.
 */
export default class Routes {
  app: any;
  constructor(app: any) {
    this.app = app;
  }

  appRoutes() {
    this.app.get("/api/seam/health", logSeamAccess("health"), requireSeamKey, SeamHandler.health);
    this.app.get("/api/seam/whoami", logSeamAccess("whoami"), requireSeamKey, requireClinician, SeamHandler.whoami);
  }

  routesConfig() {
    this.appRoutes();
  }
}

module.exports = Routes;
