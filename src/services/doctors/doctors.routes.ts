import { verifyToken } from "../../utils/auth_token";
import DoctorHandler from "./controller/doctors.controller";
export default class Routes {
  app: any;
  constructor(app: any) {
    this.app = app;
  }

  appRoutes() {
    this.app.get(
      "/api/doctors/fetch_all_doctors",
      verifyToken,
      DoctorHandler.fetchAllDoctors
    );
    this.app.get(
      "/api/doctors/fetch_doctors_and_availabilities",
      verifyToken,
      DoctorHandler.fetchDoctorsAndAvailabilities
    );
    this.app.get(
      "/api/doctors/fetch_my_doctors",
      verifyToken,
      DoctorHandler.getPatientDoctors
    );
  }

  routesConfig() {
    this.appRoutes();
  }
}

module.exports = Routes;
