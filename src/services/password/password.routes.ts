import { verifyToken } from "../../utils/auth_token";
import passwordApi from "./controller/password.controller";
export default class Routes {
  app: any;
  constructor(app: any) {
    this.app = app;
  }
  appRoutes() {
    this.app.post("/api/password/generateLink", passwordApi.createLink);
    this.app.post(
      "/api/password/generateLinkDoctor",
      passwordApi.createLinkDoctor
    );
    this.app.post("/api/password/update-password", passwordApi.updatePassword);
    this.app.post(
      "/api/password/update-password-doctor",
      passwordApi.updatePasswordDoctor
    );
  }
  routesConfig() {
    this.appRoutes();
  }
}
