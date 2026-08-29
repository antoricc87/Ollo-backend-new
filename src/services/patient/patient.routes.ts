import patientApi from "./controller/patient.controller";
import { verifyToken } from "../../utils/auth_token";

/**
 * Patient-facing routes only. The physician-portal routes that used to live
 * here (fetchpatients, doctor/getpatientbyid, createpatient, visits, referral,
 * preauth, doctor/uploadPatientlab, doctor/patientoverview) were removed on
 * 2026-08-29 — see CLAUDE.md "Physician surface retired".
 */
export default class Routes {
  app: any;

  constructor(app: any) {
    this.app = app;
  }

  appRoutes() {
    this.app.post(
      "/api/patients/getpatientbyid",
      verifyToken,
      patientApi.getPatientById
    );
    this.app.post(
      "/api/patients/createsubaccount",
      verifyToken,
      patientApi.createSubAccount
    );
    this.app.get(
      "/api/patients/fetchsubaccounts",
      verifyToken,
      patientApi.fetchSubAccounts
    );
    this.app.post(
      "/api/patients/createpatientmobile",
      patientApi.createNewPatientMobile
    );
    this.app.delete(
      "/api/patients/deletePatient",
      verifyToken,
      patientApi.deletePatient
    );
    this.app.post(
      "/api/patients/patient-summary",
      verifyToken,
      patientApi.getPatientSummary
    );
    this.app.post(
      "/api/patients/updatePatient",
      verifyToken,
      patientApi.updatePatientById
    );
    this.app.post(
      "/api/patients/updatePatientSection",
      verifyToken,
      patientApi.updatePatientSummary
    );
    this.app.post("/api/patients/patientlogin", patientApi.patientLogin);
    this.app.post(
      "/api/patients/uploadlab",
      verifyToken,
      patientApi.uploadPatientLab
    );
    this.app.post(
      "/api/patients/updateInstacartPreferences",
      verifyToken,
      patientApi.updateInstacartPreferences
    );
    this.app.get(
      "/api/patients/fetchLabs",
      verifyToken,
      patientApi.fetchPatientLabs
    );
    this.app.get(
      "/api/patients/labs/current",
      verifyToken,
      patientApi.fetchCurrentLabs
    );
    this.app.patch(
      "/api/patients/labs/:id",
      verifyToken,
      patientApi.updateLabReportDate
    );
    this.app.delete(
      "/api/patients/labs/:id",
      verifyToken,
      patientApi.deleteLabReport
    );
  }
  routesConfig() {
    this.appRoutes();
  }
}

module.exports = Routes;
