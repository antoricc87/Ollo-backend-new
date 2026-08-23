import { verifyDoctorToken, verifyToken } from "../../utils/auth_token";
import reportsApi from "./controller/reports.controller";
export default class Routes {
  app: any;
  constructor(app: any) {
    this.app = app;
  }
  appRoutes() {
    this.app.post(
      "/api/reports/generateWeeklyReport",
      verifyToken,
      reportsApi.generateWeeklyReport
    );
    this.app.get(
      "/api/reports/fetchReportsById",
      verifyToken,
      reportsApi.fetchPatientReports
    );
    this.app.post(
      "/api/reports/deleteReportsById",
      verifyToken,
      reportsApi.deleteReportById
    );
    this.app.post(
      "/api/reports/doctor/generateCheckupReport",
      verifyDoctorToken,
      reportsApi.generateCheckupReport
    );
  }
  routesConfig() {
    this.appRoutes();
  }
}
