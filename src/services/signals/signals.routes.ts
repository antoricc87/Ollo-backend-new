import { verifyToken } from "../../utils/auth_token";
import signalsApi from "./controller/signals.controller";

/**
 * Signals (Sep 2026) — patient-scoped; identity from the token only.
 * `POST /nightly` is how overnight vitals reach the server at all: HealthKit
 * lives on the phone, so before this the backend was blind to sleep and HRV.
 */
export default class Routes {
  app: any;
  constructor(app: any) {
    this.app = app;
  }

  appRoutes() {
    this.app.post("/api/signals/nightly", verifyToken, signalsApi.syncNightly);
    this.app.get("/api/signals/findings", verifyToken, signalsApi.list);
    this.app.post("/api/signals/scan", verifyToken, signalsApi.scan);
    // The Signals page (Nov 17 2026): every card built on the server (domain/view.ts).
    this.app.get("/api/signals/overview", verifyToken, signalsApi.overview);
    this.app.get("/api/signals/item/:key", verifyToken, signalsApi.item);
    this.app.post("/api/signals/findings/:id/thread", verifyToken, signalsApi.thread);
  }

  routesConfig() {
    this.appRoutes();
  }
}
module.exports = Routes;
