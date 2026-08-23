import { verifyDoctorToken, verifyToken } from "../../utils/auth_token";
import bfpApi from "./controller/bfp.controller";
export default class Routes {
  app: any;
  constructor(app: any) {
    this.app = app;
  }

  appRoutes() {
    this.app.post(
      "/api/bfp/create_bfp_entry",
      verifyToken,
      bfpApi.createBFPEntry
    );
    this.app.post(
      "/api/bfp/delete_bfp_entry",
      verifyToken,
      bfpApi.deleteBFPEntry
    );
    this.app.post(
      "/api/bfp/fetch_bfp_tracker",
      verifyToken,
      bfpApi.fetchBFPTracker
    );
    this.app.post(
      "/api/bfp/fetch_bfp_tracker_doctor",
      verifyDoctorToken,
      bfpApi.fetchBFPTracker
    );
  }

  routesConfig() {
    this.appRoutes();
  }
}

module.exports = Routes;
