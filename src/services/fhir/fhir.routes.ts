import express from "express";
import FhirHandler from "./controller/fhir.controller";
import { verifyToken } from "../../utils/auth_token";

export default class Routes {
  app: any;
  constructor(app: any) {
    this.app = app;
  }

  appRoutes() {
    this.app.get("/api/fhir/launch", FhirHandler.authorize);
    this.app.get("/api/app", FhirHandler.ready);
    this.app.post("/api/fhir/patient", FhirHandler.getPatient);
    this.app.get("/api/fhir/get-patients", FhirHandler.getPatients);
  }

  routesConfig() {
    this.appRoutes();
  }
}
