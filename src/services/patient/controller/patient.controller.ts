import bcrypt from "bcryptjs";
import { triggerWatchOut } from "../../agent/proactive/proactive.service";
import LabsJourneyService from "../../labs_journey/model/labsJourney.model";
import { ObjectId } from "../../../utils/idValidation";
import { Request, Response } from "express";
import { UploadedFile } from "express-fileupload"; // Import UploadedFile if the package has types
import { CreatePatientRequest } from "../../../types";
import prisma from "../../../utility/prismaClient";
import { summarizePatientRecord } from "../../../utility/recordSummary";
import sendEmail from "../../../utils/emailService";
import {
  sendMulticast,
  sendSingleNotification,
} from "../../../utils/push_notifications";
import { parseLabPdf } from "../../../utils/redactPI";
import {
  extractLabReport,
  ScannedPdfError,
} from "../../lab_extraction/extractLabs";
import { Util } from "../../../utils/response";
import { generateLabDataJSON } from "../../openAI/model/openai.model";
import {
  calculatePatientOverview,
  checkExistingPatient,
  createPatient,
  createPatientInsurance,
  createPatientMobile,
  createPatientSummary,
  createSubAccount,
  createVisit,
  deleteInsuranceRecord,
  deletePatientById,
  fetchAllPatients,
  fetchPatientInsurances,
  fetchPatientLabs,
  generateRisksOverviewDatasets,
  getExistingSubAccount,
  getPatientById,
  getSubAccounts,
  patientLogin,
  updateInstacartPreferences,
  updateInsuranceRecord,
  updatePatient,
  updatePatientPassword,
  updatePatientSummarySection,
} from "../model/patient.model";
import {
  createLabReport,
  fetchCurrentLabs,
  updateLabReportDate,
  deleteLabReport,
} from "../model/patient.model";

export class PatientHandler {
  //notification test
  async testNotifications(request: Request, response: Response) {
    const { data } = request.body;
    try {
      const result = await sendMulticast(data);
      return response
        .status(200)
        .json(Util.success(result, "Notification sent successfully"));
    } catch (error: unknown) {
      return response
        .status(500)
        .json(Util.error({ error }, "Error sending notifications"));
    }
  }
  //get all patient
  async getAllPatients(request: any, response: Response) {
    const { id } = request.user;
    try {
      const patients = await fetchAllPatients({ doctorIds: { has: id } });
      if (patients) {
        return response
          .status(200)
          .json(Util.success(patients, "All patients fetched successfully"));
      }
    } catch (error: any) {
      console.error(error.message);
      response.status(500).json(Util.error({}, "Error fetching all patients"));
    }
  }

  //get patient by id
  async getPatientById(request: Request, response: Response) {
    const { patientId } = request.body;
    try {
      if (!patientId || !ObjectId.isValid(patientId)) {
        return response
          .status(400)
          .json(
            Util.error(
              {},
              "Patient id is required and must be a valid ObjectId"
            )
          );
      }
      const patient = await getPatientById(patientId);
      if (!patient)
        return response.status(404).json(Util.error({}, "Patient not found"));
      return response
        .status(200)
        .json(Util.success(patient, "Patient successfully found"));
    } catch (error: any) {
      console.error("Error fetching the patient", error);
      return response
        .status(500)
        .json(Util.error({}, "Error fetching the patient"));
    }
  }

  // Controller function to handle the creation of a new patient
  async createNewPatient(request: CreatePatientRequest, response: Response) {
    const { firstName, lastName, middleName, dob, gender, doctorId, email } =
      request.body;

    try {
      // Check if a patient with the same email already exists
      const existingPatient = await checkExistingPatient(email);
      if (existingPatient) {
        return response
          .status(400)
          .json(Util.error({}, "Patient with this email already exists"));
      } else {
        // Prepare the patient data
        const data = {
          firstName: firstName,
          lastName: lastName,
          middleName: middleName,
          dob: new Date(dob),
          gender: gender,
          doctorId: doctorId,
          email: email,
        };

        // Create the patient
        // const newPatient = await createPatient(data);
        const newPatient = await createPatient(request.body);

        if (newPatient) {
          //create new patient summary
          const newPatientSummary = await createPatientSummary(newPatient.id);
          // Create patient calories tracker and food tracker
          // await CaloriesService.createTracker(newPatient.id);
          // await CaloriesService.createFoodTracker(newPatient.id);

          //  Prepare and send confirmation email
          const link = `http://localhost:3000/createpassword/${newPatient.id}`;
          const subject = "Confirmation of Patient Registration";
          const body = `Dear ${firstName} ${lastName},\n\nYour registration was successful!\n\nPlease use the link below to set up your password,\n${link}\n\nBest regards,\nYour Healthcare Team`;

          await sendEmail(email, subject, body);

          // Return the created patient and patient summary as the response
          return response.status(200).json(
            Util.success(
              {
                patient: newPatient,
                patientSummary: newPatientSummary,
              },
              "Patient and PatientSummary created successfully"
            )
          );
        }
      }
    } catch (error: any) {
      console.error("Error creating the patient", error);
      return response
        .status(400)
        .json(Util.error({}, "Error creating the patient"));
    }
  }

  //create new patient from mobile
  async createNewPatientMobile(request: Request, response: Response) {
    const { email, password, timeZone } = request.body;

    try {
      // Check if a patient with the same email already exists
      const existingPatient = await checkExistingPatient(email);
      if (existingPatient) {
        return response
          .status(200)
          .json(Util.error({}, "Patient with this email already exists"));
      } else {
        // Create the patient
        const newPatient = await createPatientMobile(request.body);

        if (newPatient) {
          //create new patient summary
          const newPatientSummary = await createPatientSummary(newPatient.id);
          // Create patient calories tracker and food tracker
          // await CaloriesService.createTracker(newPatient.id);
          // await CaloriesService.createFoodTracker(newPatient.id);

          // Return the created patient and patient summary as the response
          const patient = await getPatientById(newPatient.id);
          return response
            .status(200)
            .json(
              Util.success(
                patient,
                "Patient and PatientSummary created successfully"
              )
            );
        }
      }
    } catch (error: any) {
      console.error("Error creating the patient", error);
      return response
        .status(400)
        .json(Util.error({}, "Error creating the patient"));
    }
  }

  async createSubAccount(request: any, response: Response) {
    const { id: parentPatientId } = request.user;
    const { firstName, lastName } = request.body;
    if (!firstName || !lastName)
      return response
        .status(400)
        .json(Util.error({}, "First and Last name are required"));
    try {
      const whereClause = {
        subAccountOf: parentPatientId,
        firstName: firstName,
        lastName: lastName,
      };
      const existingSubAccount = await getExistingSubAccount(whereClause);
      if (existingSubAccount) {
        return response
          .status(400)
          .json(Util.error({}, "sub account already exist with this name"));
      }
      const subAccount = await createSubAccount(request.body, parentPatientId);
      if (subAccount) {
        await createPatientSummary(subAccount.id);
        return response
          .status(201)
          .json(Util.success(subAccount, "Sub Account created Successfully"));
      }
    } catch (error: unknown) {
      return response
        .status(500)
        .json(Util.error(error, "Error creating the sub-account"));
    }
  }

  async fetchSubAccounts(request: any, response: Response) {
    const { id } = request.user;
    try {
      const subAccounts = await getSubAccounts(id);
      if (subAccounts) {
        return response
          .status(200)
          .json(Util.success(subAccounts, "Sub accounts fetched successfully"));
      }
    } catch (error: unknown) {
      return response
        .status(500)
        .json(
          Util.error(error, "Something went wrong fetching the sub account")
        );
    }
  }

  //delete patient
  async deletePatient(request: Request, response: Response) {
    const { patientId } = request.body;
    try {
      const deletePatient = await deletePatientById(patientId);
      if (deletePatient.success) {
        return response
          .status(200)
          .json(Util.success({}, "Patient deleted successfully"));
      }
    } catch (error: any) {
      console.error("Error deleting the patient", error);
      return response
        .status(400)
        .json(Util.error({}, "Error deleting the patient"));
    }
  }
  //get patient summary
  // Fetch patient summary
  async getPatientSummary(req: Request, res: Response) {
    const { id } = req.body; // Assuming you pass 'id' of the patient in the request body

    if (!id) {
      return res.status(400).json(Util.error({}, "Patient id is required"));
    }

    try {
      // Fetch the patient summary from the database
      const patient = await prisma.patient.findUnique({
        where: { id: id },
        select: {
          patientSummary: true, // Fetch the patientSummary field from the Patient model
        },
      });

      if (!patient) {
        return res.status(404).json(Util.error({}, "Patient not found"));
      }

      const patientSummary = patient.patientSummary;

      // Process the summary if needed using summarizePatientRecord
      // Assuming `data` contains some relevant data passed along
      const { data } = req.body;
      const summary = data
        ? summarizePatientRecord(data, "json")
        : patientSummary;

      return res
        .status(200)
        .json(Util.success(summary, "Summary fetched successfully"));
    } catch (error) {
      console.error("Error getting the summary", error);
      return res.status(500).json(Util.error({}, "Error getting the summary"));
    }
  }

  //create patient visit
  async createVisit(req: any, res: Response) {
    const {
      fhirPatientId,
      patientId,
      patientSymptoms,
      postVisitNote,
      patientName,
      patientDOB,
      patientGender,
      visitType,
      visitTime,
    } = req.body;
    console.log(req.body);
    if (!fhirPatientId) {
      // <-- Add visitType to validation
      return res
        .status(400)
        .json(
          Util.error(
            {},
            "fhirPatientId, visitType, and patientSymptoms are required"
          )
        );
    }

    try {
      const data = {
        fhirPatientId,
        patientId,
        visitType,
        patientSymptoms: JSON.stringify(patientSymptoms),
        postVisitNote,
        userId: req.user.id,
        patientName,
        patientDOB,
        patientGender,
        visitTime,
      };
      const visit = await createVisit(data);
      return res
        .status(200)
        .json(Util.success(visit, "Visit successfully created"));
    } catch (error) {
      console.error("Error creating visit:", error);
      res.status(500).json(Util.error({}, "Failed creating the visit"));
    }
  }

  // API to fetch a single visit
  async getVisitbyId(req: Request, res: Response) {
    const { visitId } = req.body;
    try {
      const visit = await prisma.visit.findUnique({
        where: { id: visitId },
      });
      if (!visit) {
        return res.status(404).json(Util.error({}, "Visit not found"));
      }
      return res
        .status(200)
        .json(Util.success(visit, "Visit successfully fetched"));
    } catch (error) {
      console.error("Error fetching visit:", error);
      res.status(500).json(Util.error({}, "Failed getting the visit"));
    }
  }

  // API to fetch all visits for a specific patient
  async getPatientVisits(req: Request, res: Response) {
    const { patientId } = req.body; // Assume patientId is sent in the request body

    try {
      const visits = await prisma.visit.findMany({
        where: { fhirPatientId: patientId }, // Fetch all visits for the given patientId
      });
      if (!visits || visits.length === 0) {
        return res
          .status(404)
          .json(Util.error({}, "No visits found for this patient"));
      }
      return res
        .status(200)
        .json(Util.success(visits, "Visits successfully fetched"));
    } catch (error) {
      console.error("Error fetching visits:", error);
      res.status(500).json(Util.error({}, "Failed to get visits"));
    }
  }

  // update patient visit
  async updateVisit(req: any, res: Response) {
    const { id } = req.params;
    const {
      patientSymptoms,
      postVisitNote,
      postVisitCoding,
      postVisitBilling,
      isEnded,
    } = req.body;

    try {
      const visit = await prisma.visit.update({
        where: { id },
        data: {
          patientSymptoms: patientSymptoms
            ? JSON.stringify(patientSymptoms)
            : undefined,
          postVisitNote,
          postVisitCoding,
          postVisitBilling,
          isEnded: isEnded !== undefined ? isEnded : undefined, // Add this line to update isEnded
        },
      });
      return res
        .status(200)
        .json(Util.success(visit, "Visit successfully updated"));
    } catch (error) {
      console.error("Error updating visit:", error);
      res.status(500).json(Util.error({}, "Failed updating the visit"));
    }
  }

  //delete patient visit
  async deleteVisit(req: Request, res: Response) {
    const { id } = req.params;

    try {
      await prisma.visit.delete({
        where: { id },
      });
      return res
        .status(200)
        .json(Util.success({}, "Visit successfully deleted"));
    } catch (error) {
      console.error("Error deleting visit:", error);
      res.status(500).json(Util.error({}, "Failed to delete visit"));
    }
  }

  //get all visits
  async getAllVisits(req: any, res: Response) {
    try {
      const visits = await prisma.visit.findMany({
        where: { userId: req.user.id },
      });
      if (visits) {
        return res
          .status(200)
          .json(Util.success(visits, "Visits successfully fetched"));
      }
    } catch (error: any) {
      console.error("Error fetching visits", error);
      res.status(500).json(Util.error({}, "Error fetching visits"));
    }
  }

  // Create a new referral
  async createReferral(request: Request, response: Response) {
    const {
      visitId,
      patientId,
      userId,
      receivingProviderName,
      receivingProviderSpecialty,
      reason,
      referralLetter,
    } = request.body;

    try {
      // Ensure the correct data types are passed
      const referral = await prisma.referral.create({
        data: {
          visitId: visitId as string,
          patientId: patientId as string,
          userId: userId as string,
          receivingProviderName: receivingProviderName as string,
          receivingProviderSpecialty: receivingProviderSpecialty as string,
          reason: reason as string,
          referralLetter: referralLetter as string,
        },
      });
      return response
        .status(200)
        .json(Util.success(referral, "Referral letter created successfully"));
    } catch (error: any) {
      console.error("Error creating referral letter", error);
      return response
        .status(500)
        .json(Util.error({}, "Failed to create referral letter"));
    }
  }

  // Create a new pre-auth
  async createPreAuth(request: Request, response: Response) {
    const {
      visitId,
      patientId,
      userId,
      procedureName,
      procedureCPTCode,
      reason,
      preAuthLetter,
    } = request.body;

    try {
      const preAuth = await prisma.preAuth.create({
        data: {
          visitId: visitId as string,
          patientId: patientId as string,
          userId: userId as string,
          procedureName: procedureName as string,
          procedureCPTCode: procedureCPTCode as string,
          reason: reason as string,
          preAuthLetter: preAuthLetter as string,
        },
      });
      return response
        .status(200)
        .json(Util.success(preAuth, "Pre-auth letter created successfully"));
    } catch (error: any) {
      console.error("Error creating pre-auth letter", error);
      return response
        .status(500)
        .json(Util.error({}, "Failed to create pre-auth letter"));
    }
  }

  // Get all referrals for a patient
  async getReferrals(request: Request, response: Response) {
    const { patientId } = request.params;

    try {
      const referrals = await prisma.referral.findMany({
        where: { patientId },
      });
      if (!referrals || referrals.length === 0) {
        return response
          .status(404)
          .json(Util.error({}, "No referrals found for this patient"));
      }
      return response
        .status(200)
        .json(Util.success(referrals, "Referrals fetched successfully"));
    } catch (error: any) {
      console.error("Error fetching referrals", error);
      return response
        .status(500)
        .json(Util.error({}, "Failed to fetch referrals"));
    }
  }

  // Get all pre-auths for a patient
  async getPreAuths(request: Request, response: Response) {
    const { patientId } = request.params;

    try {
      const preAuths = await prisma.preAuth.findMany({
        where: { patientId },
      });
      if (!preAuths || preAuths.length === 0) {
        return response
          .status(404)
          .json(Util.error({}, "No pre-auths found for this patient"));
      }
      return response
        .status(200)
        .json(Util.success(preAuths, "Pre-auths fetched successfully"));
    } catch (error: any) {
      console.error("Error fetching pre-auths", error);
      return response
        .status(500)
        .json(Util.error({}, "Failed to fetch pre-auths"));
    }
  }

  //--------------patient facing app---------------//
  //check existing patient
  async checkForExistingPatient(req: Request, res: Response) {
    try {
      const patient = await checkExistingPatient(req.body.email);
      if (!patient)
        return res.status(400).json(Util.error({}, "Patient not found"));
      return res
        .status(200)
        .json(Util.success(patient, "Patient succesfully fetched"));
    } catch (error: any) {
      return res.status(400).json(Util.error({}, error));
    }
  }
  //update patient
  async updatePatientPasswordById(req: Request, res: Response) {
    const { password, patientId } = req.body;
    if (!patientId || !ObjectId.isValid(patientId))
      return res
        .status(400)
        .json(
          Util.error({}, "Patient id is required and must be a valid ObjectId")
        );

    try {
      const saltRounds = 10;
      const salt = await bcrypt.genSalt(saltRounds);
      const hashedPassword = await bcrypt.hash(password, salt);
      const updatedPatient = await updatePatientPassword(patientId, {
        password: hashedPassword,
      });
      if (updatedPatient)
        return res
          .status(200)
          .json(Util.success(updatedPatient, "Patient successfully updated"));
    } catch (error: any) {
      return res.status(400).json(Util.error({}, error));
    }
  }
  //patient login
  async patientLogin(req: Request, res: Response) {
    const { email, password } = req.body;
    try {
      const patientData = await patientLogin(email, password);
      if (patientData)
        return res
          .status(200)
          .json(Util.success(patientData, "Patient logged in successfully"));
    } catch (error: any) {
      return res.status(400).json(Util.error({}, error.message));
    }
  }
  //update patient
  async updatePatientById(req: Request, res: Response) {
    const { patientId, patientData } = req.body;
    if (!patientId || !ObjectId.isValid(patientId)) {
      return res
        .status(400)
        .json(
          Util.error({}, "Patient id is required and must be a valid ObjectId")
        );
    }
    const updatedPatient = await updatePatient(patientId, patientData);
    if (updatedPatient) {
      return res
        .status(200)
        .json(Util.success(updatedPatient, "Patient updated successfully"));
    }
    try {
    } catch (error: any) {
      return res.status(400).json(Util.error({}, "Error updating the patient"));
    }
  }

  //update summary section
  async updatePatientSummary(req: Request, res: Response) {
    try {
      const { section, patientId, summaryData } = req.body;
      if (!patientId || !section) {
        return res
          .status(400)
          .json(Util.error({}, "Patient id or section is missing"));
      }
      const updatedPatient = await updatePatientSummarySection(
        patientId,
        section,
        summaryData
      );
      if (updatedPatient) {
        return res
          .status(200)
          .json(Util.success(updatedPatient, "Patient updated successfully"));
      }
    } catch (error: any) {
      console.error("Error occured while updating summary section");
    }
  }

  async uploadPatientLab(req: any, res: Response) {
    const { firstName, lastName, dob, patientId, collectedAt } = req.body;
    const { id } = req.user;
    const patientIdToUse = patientId ? patientId : id;
    const file = req.files?.file as UploadedFile;
    if (!file) {
      return res.status(400).json({ error: "No file uploaded" });
    }
    try {
      let labDataJSON: any;
      let detectedCollectedAt: Date | null = null;
      let extraction: any = undefined;
      if (process.env.LAB_EXTRACTION_ENGINE === "legacy") {
        // Old path: pdf-parse text → gpt-4o-mini prompt (no validation)
        const parsed = await parseLabPdf(file, firstName, lastName, dob);
        detectedCollectedAt = parsed.detectedCollectedAt;
        labDataJSON = await generateLabDataJSON(parsed.redactedText, patientIdToUse);
      } else {
        // Layout-aware extraction with code-side validation (see lab_extraction/)
        const result = await extractLabReport(file.data, {
          firstName,
          lastName,
          dob,
          patientId: patientIdToUse,
        });
        detectedCollectedAt = result.collectedAt;
        extraction = result.extraction;
        labDataJSON = {
          labResults: result.labResults,
          labReport: result.labReport,
          recommendations: result.recommendations,
        };
      }

      // Ensure labDataJSON is structured as expected
      if (labDataJSON && Array.isArray(labDataJSON.labResults)) {
        // Priority: explicit date from the client > date read off the PDF > null
        // (null is treated as upload time until the user confirms a date).
        const explicit = collectedAt ? new Date(collectedAt) : null;
        const resolvedCollectedAt =
          explicit && !isNaN(explicit.getTime())
            ? explicit
            : detectedCollectedAt;
        const report = await createLabReport(
          patientIdToUse,
          labDataJSON,
          resolvedCollectedAt
        );
        // Ollie: event-driven note about the new report (fire-and-forget, respects the user's preferences).
        const flaggedCount = labDataJSON.labResults.filter((l: any) => l.isOutOfRange).length;
        // Labs journey: a new report resolves any open journey (fire-and-forget).
        void LabsJourneyService.markResulted(patientIdToUse).catch(() => undefined);
        void triggerWatchOut(patientIdToUse, `new lab report uploaded on ${new Date().toISOString().slice(0, 10)} (${labDataJSON.labResults.length} values, ${flaggedCount} outside the reference range)`);
        const responsePayload = {
          ...labDataJSON,
          reportId: report.id,
          collectedAt: report.collectedAt ?? report.createdAt,
          collectedAtDetected: !!resolvedCollectedAt,
          reviewCount: labDataJSON.labResults.filter((l: any) => l.needsReview).length,
          extraction,
        };
        if (patientId) {
          const patientFCM = await prisma.userFCMToken.findUnique({
            where: { userId: patientId },
          });
          const notificationData = {
            title: `Your Lab Results Are Ready`,
            body: `Hi there! Your recent lab results are now available in the app. Tap to review your results and personalized recommendations.`,
            token: patientFCM.FCMToken,
          };
          sendSingleNotification(notificationData);
        }
        return res
          .status(200)
          .json(
            Util.success(responsePayload, "Lab data successfully generated")
          );
      } else {
        console.error(
          "Expected labDataJSON to contain labResults array, received:",
          labDataJSON
        );
        return res
          .status(400)
          .json({ success: false, message: "Lab data format is incorrect." });
      }
    } catch (error) {
      if (error instanceof ScannedPdfError) {
        return res.status(422).json({ success: false, message: error.message });
      }
      console.error("Error processing lab report:", error);
      return res
        .status(500)
        .json({ success: false, message: "Error processing lab report" });
    }
  }

  async calculatePatientOverview(req: Request, res: Response) {
    const { patientId } = req.body;
    if (!patientId)
      return res.status(400).json(Util.error({}, "Patient id is missing"));
    try {
      const risksData = await generateRisksOverviewDatasets(patientId);
      const { diabeteData, biologicalAgeData, cvRiskData } = risksData;
      const patientOverview = await calculatePatientOverview(
        diabeteData,
        cvRiskData,
        biologicalAgeData
      );
      if (patientOverview) {
        return res
          .status(201)
          .json(Util.success(patientOverview, "Overview created successfully"));
      }
    } catch (error) {
      console.error("Error calculating patient overview:", error);
      return res
        .status(500)
        .json({ success: false, message: "Internal Server Error" });
    }
  }

  async updateInstacartPreferences(req: any, res: Response) {
    const { id } = req.user;
    const { instacartData } = req.body;
    if (!instacartData)
      return res.status(400).json(Util.error({}, "Instacart data is required"));
    try {
      const updatedData = await updateInstacartPreferences(instacartData, id);
      if (updatedData)
        return res
          .status(200)
          .json(
            Util.success(updatedData, "Instacart data updated successfully")
          );
    } catch (error: unknown) {
      return res
        .status(500)
        .json(Util.error({ error }, "Error updating instacart preferences"));
    }
  }

  async fetchPatientLabs(req: any, res: Response) {
    const { id } = req.user;
    try {
      const labResults = await fetchPatientLabs(id);
      if (labResults)
        return res
          .status(200)
          .json(Util.success(labResults, "Labs fetched successfully"));
    } catch (error: unknown) {
      return res.status(500).json(Util.error(error, "Erro fetching the labs"));
    }
  }

  /** Latest value per biomarker across all reports + the report list. */
  async fetchCurrentLabs(req: any, res: Response) {
    const { id } = req.user;
    try {
      const current = await fetchCurrentLabs(id);
      return res
        .status(200)
        .json(Util.success(current, "Current labs fetched successfully"));
    } catch (error: unknown) {
      console.error("Error fetching current labs", error);
      return res
        .status(500)
        .json(Util.error(error, "Error fetching current labs"));
    }
  }

  /** PATCH /labs/:id — set or correct a report's collection (test) date. */
  async updateLabReportDate(req: any, res: Response) {
    const { id } = req.user;
    const { id: reportId } = req.params;
    const { collectedAt } = req.body ?? {};
    const date = collectedAt ? new Date(collectedAt) : null;
    if (!reportId || !date || isNaN(date.getTime()))
      return res
        .status(400)
        .json(Util.error({}, "A valid collectedAt date is required"));
    if (date.getTime() > Date.now() + 86400000)
      return res
        .status(400)
        .json(Util.error({}, "collectedAt cannot be in the future"));
    try {
      const report = await updateLabReportDate(id, reportId, date);
      return res
        .status(200)
        .json(Util.success(report, "Lab report date updated"));
    } catch (error: any) {
      const notFound = error?.message === "Lab report not found";
      return res
        .status(notFound ? 404 : 500)
        .json(Util.error(error, notFound ? error.message : "Error updating lab report"));
    }
  }

  /** DELETE /labs/:id — remove a report the patient uploaded by mistake. */
  async deleteLabReport(req: any, res: Response) {
    const { id } = req.user;
    const { id: reportId } = req.params;
    try {
      await deleteLabReport(id, reportId);
      return res.status(200).json(Util.success({}, "Lab report deleted"));
    } catch (error: any) {
      const notFound = error?.message === "Lab report not found";
      return res
        .status(notFound ? 404 : 500)
        .json(Util.error(error, notFound ? error.message : "Error deleting lab report"));
    }
  }

  // Create new patient insurance
  async createPatientInsurance(req: Request, res: Response) {
    const {
      patientId,
      insuranceProvider,
      planType,
      fullPlanName,
      allowsAnyPCP,
    } = req.body;

    try {
      const insurance = await createPatientInsurance({
        patientId,
        insuranceProvider,
        planType,
        fullPlanName,
        allowsAnyPCP,
      });

      return res
        .status(201)
        .json(Util.success(insurance, "Insurance record created successfully"));
    } catch (error: any) {
      console.error("Error creating insurance:", error);
      return res
        .status(400)
        .json(Util.error({}, "Error creating insurance record"));
    }
  }

  // Get all insurance entries for a patient
  async getPatientInsurances(req: Request, res: Response) {
    const { patientId } = req.body;

    if (!patientId || !ObjectId.isValid(patientId)) {
      return res
        .status(400)
        .json(Util.error({}, "Valid patientId is required"));
    }

    try {
      const insurances = await fetchPatientInsurances(patientId);
      return res
        .status(200)
        .json(Util.success(insurances, "Insurance records fetched"));
    } catch (error: any) {
      console.error("Error fetching insurances:", error);
      return res
        .status(500)
        .json(Util.error({}, "Error fetching insurance records"));
    }
  }

  // Update insurance entry
  async updatePatientInsurance(req: Request, res: Response) {
    const { id, insuranceProvider, planType, fullPlanName, allowsAnyPCP } =
      req.body;

    if (!id || !ObjectId.isValid(id)) {
      return res
        .status(400)
        .json(Util.error({}, "Valid insurance id is required"));
    }

    try {
      const insurance = await updateInsuranceRecord({
        id,
        insuranceProvider,
        planType,
        fullPlanName,
        allowsAnyPCP,
      });

      return res
        .status(200)
        .json(Util.success(insurance, "Insurance updated successfully"));
    } catch (error: any) {
      console.error("Error updating insurance:", error);
      return res.status(400).json(Util.error({}, "Error updating insurance"));
    }
  }

  // Delete insurance entry
  async deletePatientInsurance(req: Request, res: Response) {
    const { id } = req.body;

    if (!id || !ObjectId.isValid(id)) {
      return res
        .status(400)
        .json(Util.error({}, "Valid insurance id is required"));
    }

    try {
      await deleteInsuranceRecord(id);
      return res.status(200).json(Util.success({}, "Insurance record deleted"));
    } catch (error: any) {
      console.error("Error deleting insurance:", error);
      return res.status(400).json(Util.error({}, "Error deleting insurance"));
    }
  }
}

export default new PatientHandler();
