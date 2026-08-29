import { triggerWatchOut } from "../../agent/proactive/proactive.service";
import LabsJourneyService from "../../labs_journey/model/labsJourney.model";
import { ObjectId } from "../../../utils/idValidation";
import { Request, Response } from "express";
import { UploadedFile } from "express-fileupload"; // Import UploadedFile if the package has types
import prisma from "../../../utility/prismaClient";
import { summarizePatientRecord } from "../../../utility/recordSummary";
import { sendSingleNotification } from "../../../utils/push_notifications";
import { parseLabPdf } from "../../../utils/redactPI";
import {
  extractLabReport,
  ScannedPdfError,
} from "../../lab_extraction/extractLabs";
import { Util } from "../../../utils/response";
import { generateLabDataJSON } from "../../openAI/model/openai.model";
import {
  checkExistingPatient,
  createPatientInsurance,
  createPatientMobile,
  createPatientSummary,
  createSubAccount,
  deleteInsuranceRecord,
  deletePatientById,
  fetchPatientInsurances,
  fetchPatientLabs,
  getExistingSubAccount,
  getPatientById,
  getSubAccounts,
  patientLogin,
  updateInstacartPreferences,
  updateInsuranceRecord,
  updatePatient,
  updatePatientSummarySection,
} from "../model/patient.model";
import {
  createLabReport,
  fetchCurrentLabs,
  updateLabReportDate,
  deleteLabReport,
} from "../model/patient.model";

export class PatientHandler {
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
