import { verifyToken } from "../../utils/auth_token";
import FCMTokenApi from "./controller/fcm_token.controller";
export default class Routes {
  app: any;
  constructor(app: any) {
    this.app = app;
  }

  appRoutes() {
    this.app.post(
      "/api/FCM/handleFCMToken",
      verifyToken,
      FCMTokenApi.handleCreateRefreshFCMToken
    );
  }

  routesConfig() {
    this.appRoutes();
  }
}

module.exports = Routes;
