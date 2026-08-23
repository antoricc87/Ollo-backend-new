import { Request, Response } from "express";
import Util from "../../../utils/response";
import SymptomsService from "../model/symptoms.model";
class SymptomsHandler {
  async generateInitialQuestions(request: Request, response: Response) {
    const { symptoms, patientId } = request.body;
    if (!symptoms || !patientId) {
      return response
        .status(400)
        .json(Util.error({}, "Symptoms and patient id are required"));
    }
    try {
      const questions = await SymptomsService.generateInitialQuestionsWithId(
        symptoms,
        patientId
      );
      if (questions) {
        return response
          .status(200)
          .json(
            Util.success({ questions }, "Questions successfully generated")
          );
      }
    } catch (error: unknown) {
      return response
        .status(400)
        .json(Util.error({ error }, "Error generating the questions"));
    }
  }

  async generateFollowUpQuestions(request: Request, response: Response) {
    const { symptoms, patientId, previousAnswers } = request.body;
    if (!symptoms || !patientId) {
      return response
        .status(400)
        .json(Util.error({}, "Symptoms and patient id are required"));
    }
    try {
      const questions = await SymptomsService.generateFollowUpQuestionsWithId(
        symptoms,
        patientId,
        previousAnswers
      );
      if (questions) {
        return response
          .status(200)
          .json(
            Util.success({ questions }, "Questions successfully generated")
          );
      }
    } catch (error: unknown) {
      return response
        .status(400)
        .json(Util.error({ error }, "Error generating the questions"));
    }
  }

  async generatePossibleDiagnosis(request: Request, response: Response) {
    const { symptoms, patientId, questions } = request.body;
    // ✅ Log request before validation
    console.log("📥 Received API Request:");
    console.log("Symptoms:", symptoms);
    console.log("Patient ID:", patientId);
    console.log("Questions:", JSON.stringify(questions, null, 2));

    if (!symptoms || !patientId || !questions) {
      return response
        .status(400)
        .json(
          Util.error(
            {},
            "Symptoms, patient summary and answered questions are required"
          )
        );
    }
    try {
      const diagnosis = await SymptomsService.generateDiagnosisFromQuestions(
        symptoms,
        patientId,
        questions
      );
      if (diagnosis) {
        return response
          .status(200)
          .json(Util.success(diagnosis, "Diagnosis successfully generated"));
      }
    } catch (error: unknown) {
      return response
        .status(400)
        .json(Util.error({ error }, "Error generating diagnosis"));
    }
  }
}
export default new SymptomsHandler();
