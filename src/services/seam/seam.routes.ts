import SeamHandler from "./controller/seam.controller";
import { logSeamAccess, requireClinician, requireGrant, requireSeamKey } from "./seam.auth";

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
    this.app.put("/api/seam/clinicians/:externalId", logSeamAccess("clinician.upsert"), requireSeamKey, SeamHandler.upsertClinician);
    // Patient-scoped reads (S2): key → clinician → active grant → handler. Access-logged first so denials show up too.
    this.app.get("/api/seam/patients", logSeamAccess("patients"), requireSeamKey, requireClinician, SeamHandler.patients);
    const scoped = (resource: string, handler: any) => [logSeamAccess(resource), requireSeamKey, requireClinician, requireGrant("id"), handler];
    this.app.get("/api/seam/patients/:id/snapshot", ...scoped("snapshot", SeamHandler.snapshot));
    this.app.get("/api/seam/patients/:id/labs/current", ...scoped("labs.current", SeamHandler.labsCurrent));
    this.app.get("/api/seam/patients/:id/labs/risk", ...scoped("labs.risk", SeamHandler.labsRisk));
    this.app.get("/api/seam/patients/:id/plan", ...scoped("plan", SeamHandler.plan));
    this.app.get("/api/seam/patients/:id/trackers", ...scoped("trackers", SeamHandler.trackers));
    this.app.get("/api/seam/whoami", logSeamAccess("whoami"), requireSeamKey, requireClinician, SeamHandler.whoami);
  }

  routesConfig() {
    this.appRoutes();
  }
}

module.exports = Routes;
