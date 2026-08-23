import { Request, Response, NextFunction } from "express";
import smart from "fhirclient";
import { Util } from "../../../utils/response";
import { FhirSettings } from "../../../types";

const smartSettings: FhirSettings = {
  clientId: "my-client-id",
  redirectUri: "/api/app",
  scope: "launch/patient patient/*.read openid fhirUser",
  iss: "https://launch.smarthealthit.org/v/r4/sim/eyJrIjoiMSIsImIiOiJzbWFydC03Nzc3NzA1In0/fhir",
};
//launching fhir
export const authorize = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    await smart(req, res).authorize(smartSettings);
    next();
  } catch (error) {
    next(error);
  }
};
//init fhir
export const ready = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const client = await smart(req, res).ready();
    handler(client, res);
  } catch (error) {
    console.error("Error during client initialization:", error);
    res.status(500).json(Util.error({}, "Failed to initialize client"));
  }
};

const handler = async (client: any, res: Response) => {
  try {
    const data = await (client.patient.id
      ? client.patient.read()
      : client.request("Patient"));
    res.json(data);
  } catch (error) {
    console.error("Error fetching patient data:", error);
    res.status(500).json(Util.error({}, "Failed to fetch patient data"));
  }
};
