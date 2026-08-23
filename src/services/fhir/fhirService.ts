import { Request, Response, NextFunction } from 'express';
import smart from 'fhirclient';
import dotenv from 'dotenv';

dotenv.config();

const smartSettings = {
  clientId: process.env.CLIENT_ID || 'your-client-id',
  redirectUri: '/api/app',
  scope: 'launch/patient patient/*.read openid fhirUser',
  iss: 'https://launch.smarthealthit.org/v/r4/sim/eyJrIjoiMSIsImIiOiJzbWFydC03Nzc3NzA1In0/fhir'
};



export const authorize = (req: Request, res: Response, next: NextFunction) => {
  smart(req, res).authorize(smartSettings).catch(next);
};

export const ready = (req: Request, res: Response, next: NextFunction) => {
  smart(req, res).ready()
    .then(client => handler(client, res))
    .catch(error => {
      console.error('Error during client initialization:', error);
      res.status(500).send('Failed to initialize client');
    });
};

const handler = async (client: any, res: Response) => {
  try {
    const data = await (client.patient.id ? client.patient.read() : client.request('Patient'));
    res.json(data);
  } catch (error) {
    console.error('Error fetching patient data:', error);
    res.status(500).send('Failed to fetch patient data');
  }
};

export const getPatient = async (req: Request, res: Response) => {
  try {
    const client = await smart(req, res).ready();
    const patientId = 'a74651a6-8141-4c7e-91b5-a43ce80e6b92'; // Use a valid patient ID
    const patientData = await client.request(`Patient/${patientId}`);
    res.json(patientData);
  } catch (error) {
    console.error('Error fetching patient data:', error);
    res.status(500).send('Failed to fetch patient data');
  }
};

