import { verifyToken } from "../../utils/auth_token";
import DexcomHandler from "./controller/dexcom.controller";
export default class Routes {
  app: any;
  constructor(app: any) {
    this.app = app;
  }

  appRoutes() {
    this.app.get(
      "/api/dexcom/auth-url",
      verifyToken,
      DexcomHandler.getDexcomAuthToken
    );
    this.app.get("/api/dexcom/callback", DexcomHandler.handleDexcomCallback);
    this.app.post(
      "/api/dexcom/get_egvs",
      verifyToken,
      DexcomHandler.fetchDexcomEGVS
    );
    this.app.post(
      "/api/dexcom/refresh-token",
      verifyToken,
      DexcomHandler.refreshDexcomToken
    );
  }
  routesConfig() {
    this.appRoutes();
  }
}
