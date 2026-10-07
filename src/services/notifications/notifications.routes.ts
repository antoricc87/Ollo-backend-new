import { verifyToken } from "../../utils/auth_token";
import api from "./controller/notifications.controller";

/**
 * Devices + notifications (Oct 2026, docs/notifications-plan.md §3).
 * Replaces POST /api/FCM/handleFCMToken.
 */
export default class Routes {
  app: any;
  constructor(app: any) {
    this.app = app;
  }

  appRoutes() {
    this.app.post("/api/devices", verifyToken, api.register);
    this.app.get("/api/devices", verifyToken, api.devices);
    this.app.delete("/api/devices/:token", verifyToken, api.unregister);
    this.app.get("/api/notifications", verifyToken, api.list);
    this.app.post("/api/notifications/test", verifyToken, api.test);
    this.app.post("/api/notifications/:id/opened", verifyToken, api.opened);
  }

  routesConfig() {
    this.appRoutes();
  }
}
module.exports = Routes;
