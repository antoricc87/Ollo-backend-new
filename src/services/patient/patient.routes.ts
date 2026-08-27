import { verify } from "crypto";
import patientApi from "./controller/patient.controller";
import { verifyDoctorToken, verifyToken } from "../../utils/auth_token";

export default class Routes {
  app: any;

  constructor(app: any) {
    this.app = app;
  }

  appRoutes() {
    this.app.post(
      "/api/fetchpatients",
      verifyDoctorToken,
      patientApi.getAllPatients
    );
    this.app.post(
      "/api/patients/doctor/getpatientbyid",
      verifyDoctorToken,
      patientApi.getPatientById
    );
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
    //create patient for doctor
    this.app.post(
      "/api/patients/createpatient",
      verifyToken,
      patientApi.createNewPatient
    );
    //create patient directly from mobile
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
      "/api/createvisit",
      verifyDoctorToken,
      patientApi.createVisit
    );
    this.app.post("/api/getvisit", verifyToken, patientApi.getVisitbyId);
    this.app.post(
      "/api/doctor/getvisit",
      verifyDoctorToken,
      patientApi.getVisitbyId
    );
    this.app.post(
      "/api/getpatientvisits",
      verifyToken,
      patientApi.getPatientVisits
    );
    this.app.put(
      "/api/updatevisit/:id",
      verifyDoctorToken,
      patientApi.updateVisit
    );
    this.app.delete(
      "/api/deletevisit/:id",
      verifyToken,
      patientApi.deleteVisit
    );
    this.app.post(
      "/api/getallvisits",
      verifyDoctorToken,
      patientApi.getAllVisits
    );

    // Routes for referral letters
    this.app.post(
      "/api/referral",
      verifyDoctorToken,
      patientApi.createReferral
    );
    this.app.get(
      "/api/referral/:patientId",
      verifyToken,
      patientApi.getReferrals
    );

    // Routes for pre-auth letters
    this.app.post("/api/preauth", verifyDoctorToken, patientApi.createPreAuth);
    this.app.get(
      "/api/preauth/:patientId",
      verifyToken,
      patientApi.getPreAuths
    );

    //-------------Patient Facing App---------------------//
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
      "/api/patients/doctor/uploadPatientlab",
      verifyDoctorToken,
      patientApi.uploadPatientLab
    );
    this.app.post(
      "/api/patients/doctor/patientoverview",
      verifyDoctorToken,
      patientApi.calculatePatientOverview
    );
    this.app.post(
      "/api/patients/patientoverview",
      verifyToken,
      patientApi.calculatePatientOverview
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
    // Patient Insurance Routes
    this.app.post(
      "/api/patients/insurance/create",
      verifyToken,
      patientApi.createPatientInsurance
    );
    this.app.post(
      "/api/patients/insurance/getall",
      verifyToken,
      patientApi.getPatientInsurances
    );
    this.app.put(
      "/api/patients/insurance/update",
      verifyToken,
      patientApi.updatePatientInsurance
    );
    this.app.delete(
      "/api/patients/insurance/delete",
      verifyToken,
      patientApi.deletePatientInsurance
    );
  }
  routesConfig() {
    this.appRoutes();
  }
}

module.exports = Routes;
