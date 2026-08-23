// export default new FhirHandler(smartSettings);
import express, { Request, Response, NextFunction } from "express";
import smart from "fhirclient";
import { Util } from "../../../utils/response";
import { FhirSettings } from "../../../types";

declare global {
  namespace Express {
    interface Request {
      fhirClient: any;
    }
  }
}

// Generate a random state parameter for security
const generateState = () => Math.random().toString(36).substring(2);

const smartSettings: FhirSettings = {
  clientId: "my-client-id",
  redirectUri: "http://localhost:3000/app",
  scope: "launch/patient patient/*.read openid fhirUser",
  iss: "https://launch.smarthealthit.org/v/r4/sim/eyJrIjoiMSIsImIiOiJzbWFydC03Nzc3NzA1In0/fhir",
  state: generateState(),
};

class FhirHandler {
  private smartSettings: FhirSettings;

  constructor(settings: FhirSettings) {
    this.smartSettings = settings;
  }

  authorize = async (req: Request, res: Response, next: NextFunction) => {
    try {
      await smart(req, res).authorize(this.smartSettings);
      next();
    } catch (error) {
      next(error);
    }
  };

  ready = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const client = await smart(req, res).ready();
      this.handler(client, res);
    } catch (error) {
      console.error("Error during client initialization:", error);
      res.status(500).json(Util.error({}, "Failed to initialize client"));
    }
  };

  private handler = async (client: any, res: Response) => {
    try {
      const data = await (client.patient.id
        ? client.patient.read()
        : client.request("Patient"));
      return res
        .status(200)
        .json(Util.success(data, "data fetched successfully"));
    } catch (error) {
      console.error("Error fetching patient data:", error);
      res.status(500).json(Util.error({}, "Failed to fetch patient data"));
    }
  };

  getPatient = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { patient_id } = req.body;
      const client = await smart(req, res).ready();
      const patientData = await client.request(`Patient/${patient_id}`);
      const conditionsData = await client.request(
        `Condition?patient=${patient_id}`
      );
      const medicationsData = await client.request(
        `MedicationRequest?patient=${patient_id}`
      );
      const labsData = await client.request(
        `Observation?patient=${patient_id}&category=laboratory`
      );
      const vitalsData = await client.request(
        `Observation?patient=${patient_id}&category=vital-signs`
      );
      const allergies = await client.request(
        `AllergyIntolerance?patient=${patient_id}`
      );

      const fullPatientData = {
        patient_data: patientData,
        patient_allergies: allergies,
        patient_conditions: conditionsData,
        patient_medications: medicationsData,
        patient_labs: labsData,
        patient_vitals: vitalsData,
      };
      res
        .status(200)
        .json(
          Util.success(fullPatientData, "Patient data fetched successfully")
        );
    } catch (error) {
      console.error("Error fetching patient data:", error);
      res.status(500).json(Util.error({}, "Failed to fetch patient data"));
    }
  };

  getPatients = async (req: Request, res: Response) => {
    try {
      const client = await smart(req, res).ready();
      const count = req.query.count || 10;
      const patientsData = await client.request(`Patient?_count=${count}`);
      res
        .status(200)
        .json(Util.success(patientsData, "Patients data fetched successfully"));
    } catch (error) {
      console.error("Error fetching patients data:", error);
      res.status(500).json(Util.error({}, "Failed to fetch patient data"));
    }
  };
}

export default new FhirHandler(smartSettings);
