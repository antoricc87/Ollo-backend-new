import waitlistApi from "./waitlist.controller";

/**
 * Landing-page waitlist — PUBLIC (no token). Rate-limited per IP in the
 * controller; browser access is limited by the CORS allow-list in app-config.
 */
export default class Routes {
  app: any;
  constructor(app: any) {
    this.app = app;
  }

  appRoutes() {
    this.app.post("/api/waitlist", waitlistApi.join);
  }

  routesConfig() {
    this.appRoutes();
  }
}
