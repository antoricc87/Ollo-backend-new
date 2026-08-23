import express, { Request, Response } from "express";
import { Util } from "../../../utils/response";
import prisma from "../../../utility/prismaClient";
import TrackableMetricService from "../../metric/model/trackableMetrics.model";
import path from "path";
import {
  getChatGptNoteGenerator,
  getChatGptResponse,
  getChatGptClaimsSubmission,
  getChatGptMedicalCoding,
  getChatGptPreAuthLetter,
  getChatGptReferralLetter,
  getOpenAiCaloriesCalculator,
  getCaloriesFromImage,
  generateLabDataJSON,
  getCaloriesFromAudio,
  calculateMultipleMealsCaloriesAndNutrients,
} from "../model/openai.model";

const preparePrompt = (records: any, symptoms: string, patientId: string) => {
  // const filePath = path.join(
  //   __dirname,
  //   "../../..",
  //   "dummy_records",
  //   `${patientId}.json`
  // );

  // const summary = summarizePatientRecord(records, "text");
  return `
  Based on the following patient records and the reported symptoms of **${symptoms}**, provide a detailed clinical pathway for differential diagnosis, considering the patient's symptoms and medical records. Structure the output into four sections:
  
  1. **Broad list of potential conditions given the symptoms**
     - Example: List of conditions...
  
  2. **List of next steps to get to a differential diagnosis (e.g., imaging, lab tests)**
     - Example: Next steps...
  
  3. **Diagnosis considerations based on patient's medical history**
     - Example: Considerations...
  
  4. **Drugs that are contraindicated given the patient's medical history and concurrent medications**
     - Example: Contraindicated drugs...
  
  \`\`\`
  ${records}
  \`\`\`
  
  Give the complete diagnosis in max 3200 characters.
  `;
};

export class OpenAiHandler {
  //generate note
  async generateNote(request: Request, response: Response) {
    const { transcript, patientId } = request.body;
    try {
      const note = await getChatGptNoteGenerator(transcript);
      if (note) {
        return response
          .status(200)
          .json(Util.success(note, "Note successfully generated"));
      }
    } catch (error: any) {
      console.error("Error generating the note", error);
      return response
        .status(400)
        .json(Util.error({}, "Error generating the note"));
    }
  }
  //generate diagnosis
  async generateDiagnosis(request: Request, response: Response) {
    const { patientId, symptoms, records } = request.body;
    if (!patientId || !symptoms) {
      console.error("Invalid input data:", { patientId, symptoms });
      return response.status(400).json({ error: "Invalid input data" });
    }
    try {
      const prompt = preparePrompt(records, symptoms, patientId);
      const diagnosis = await getChatGptResponse(prompt);
      return response
        .status(200)
        .json(Util.success(diagnosis, "Diagnosis successfully generated"));
    } catch (error: any) {
      console.error("Error generating the note", error);
      return response
        .status(400)
        .json(Util.error({}, "Error generating the note"));
    }
  }

  //generate medical records summary
  async generateRecordsSummary(request: Request, response: Response) {
    const { patientRecords } = request.body;
    if (!patientRecords) {
      return response
        .status(404)
        .json(Util.error({}, "Patient records are required"));
    }
    try {
      const prompt = `Please provide a 500-character summary of this patient's medical history: ${patientRecords}, highlighting the following:Active Conditions,Current Medications,Allergies (indicate 'No allergies' if none),Relevant Procedures (include only major procedures),Relevant Findings from Labs (state 'No lab results in the last 6 months' if none). follow this structure The patient has [patient conditions] as active conditions. They are currently on [patient medications]. The patient has[patient allergies]. [patient major procedure]. [patient lab results].`;
      const recordSummary = await getChatGptResponse(prompt);

      if (recordSummary)
        return response
          .status(200)
          .json(
            Util.success(recordSummary, "Record summary successfully generated")
          );
    } catch (error: any) {
      console.log("Error creating the summary", error);
      return response
        .status(400)
        .json(Util.error({}, "Error generating the summary"));
    }
  }

  // Generate Medical Coding
  async generateMedicalCoding(request: Request, response: Response) {
    const { visitId, token } = request.body;

    try {
      // Retrieve the visit record from the database
      const visit = await prisma.visit.findUnique({
        where: { id: visitId },
      });

      if (!visit || !visit.postVisitNote) {
        return response
          .status(400)
          .json({ error: "Visit not found or no postVisitNote available." });
      }

      const medicalCoding = await getChatGptMedicalCoding(
        JSON.stringify(visit.postVisitNote)
      );

      // Save the generated coding back to the database
      await prisma.visit.update({
        where: { id: visitId },
        data: { postVisitCoding: medicalCoding },
      });

      return response
        .status(200)
        .json(
          Util.success(medicalCoding, "Medical coding successfully generated")
        );
    } catch (error: any) {
      console.error("Error generating medical coding", error);
      return response
        .status(400)
        .json(Util.error({}, "Error generating medical coding"));
    }
  }

  // Generate Claims Submission
  async generateClaimsSubmission(request: Request, response: Response) {
    const { visitId, token } = request.body;

    try {
      // Retrieve the visit record from the database
      const visit = await prisma.visit.findUnique({
        where: { id: visitId },
      });

      if (!visit || !visit.postVisitNote) {
        return response
          .status(400)
          .json({ error: "Visit not found or no postVisitNote available." });
      }

      const claimsSubmission = await getChatGptClaimsSubmission(
        JSON.stringify(visit.postVisitNote)
      );

      // Save the generated billing back to the database
      await prisma.visit.update({
        where: { id: visitId },
        data: { postVisitBilling: claimsSubmission },
      });

      return response
        .status(200)
        .json(
          Util.success(
            claimsSubmission,
            "Claims submission successfully generated"
          )
        );
    } catch (error: any) {
      console.error("Error generating claims submission", error);
      return response
        .status(400)
        .json(Util.error({}, "Error generating claims submission"));
    }
  }

  // Generate Referral Letter
  async generateReferralLetter(request: Request, response: Response) {
    const { reasonForReferral, postVisitNote, specialistType } = request.body;

    try {
      const referralLetter = await getChatGptReferralLetter(
        reasonForReferral,
        postVisitNote,
        specialistType
      );

      if (referralLetter) {
        return response
          .status(200)
          .json(
            Util.success(
              referralLetter,
              "Referral letter generated successfully"
            )
          );
      }
    } catch (error: any) {
      console.error("Error generating referral letter", error);
      return response
        .status(400)
        .json(Util.error({}, "Error generating referral letter"));
    }
  }

  // Generate Pre-auth Letter
  async generatePreAuthLetter(request: Request, response: Response) {
    const { postVisitNote, procedureName, procedureCPTCode, justification } =
      request.body;

    try {
      const preAuthLetter = await getChatGptPreAuthLetter(
        postVisitNote,
        procedureName,
        procedureCPTCode,
        justification
      );

      if (preAuthLetter) {
        return response
          .status(200)
          .json(
            Util.success(
              preAuthLetter,
              "Pre-auth letter generated successfully"
            )
          );
      }
    } catch (error: any) {
      console.error("Error generating pre-auth letter", error);
      return response
        .status(400)
        .json(Util.error({}, "Error generating pre-auth letter"));
    }
  }
  //generate total amount of intake calories from  food description
  async generateCaloriesAmount(request: any, response: Response) {
    const { foodDescription } = request.body;
    const { id } = request.user;

    try {
      if (!foodDescription) {
        return response
          .status(404)
          .json(Util.error({}, "Please insert food description"));
      }
      const openAiResponse = await getOpenAiCaloriesCalculator(
        foodDescription,
        id
      );
      if (openAiResponse) {
        return response
          .status(200)
          .json(
            Util.success(openAiResponse, "Calories calculated successfully")
          );
      }
    } catch (error: any) {
      console.error("Something went wrong calculating calories", error);
      throw error;
    }
  }
  async generateCaloriesAmountTest(request: any, response: Response) {
    const { foodDescription } = request.body;
    const { id } = request.user;

    try {
      if (!foodDescription) {
        return response
          .status(404)
          .json(Util.error({}, "Please insert food description"));
      }
      const openAiResponse = await calculateMultipleMealsCaloriesAndNutrients(
        foodDescription,
        id
      );
      if (openAiResponse) {
        return response
          .status(200)
          .json(
            Util.success(openAiResponse, "Calories calculated successfully")
          );
      }
    } catch (error: any) {
      console.error("Something went wrong calculating calories", error);
      throw error;
    }
  }

  //generate calories amount from image
  async generateCaloriesFromImage(request: any, response: Response) {
    const { base64Image, description } = request.body;
    const { id } = request.user;
    try {
      const calories = await getCaloriesFromImage(base64Image, description, id);
      if (calories) {
        return response
          .status(200)
          .json(Util.success(calories, "Calories successful generated"));
      }
    } catch (error: unknown) {
      return response
        .status(400)
        .json(Util.error({ error }, "Error generating calories"));
    }
  }
  //generate calories amount from audio
  async generateCaloriesFromAudio(request: any, response: Response) {
    const { base64Audio } = request.body;
    const { id } = request.user;
    try {
      const calories = await getCaloriesFromAudio(base64Audio, id);
      if (calories) {
        return response
          .status(200)
          .json(Util.success(calories, "Calories successful generated"));
      }
    } catch (error: unknown) {
      return response
        .status(400)
        .json(
          Util.error({ error }, "Error generating the calories from audio")
        );
    }
  }

  async generateLabData(request: Request, response: Response) {
    const { labText, patientId } = request.body; // `labText` is the parsed lab data text

    try {
      const labDataJSON = await generateLabDataJSON(labText, patientId);

      if (labDataJSON) {
        return response
          .status(200)
          .json(
            Util.success(labDataJSON, "Lab data JSON generated successfully")
          );
      }
    } catch (error: any) {
      console.error("Error generating lab data JSON:", error);
      return response
        .status(400)
        .json(Util.error({}, "Error generating lab data JSON"));
    }
  }
}

export default new OpenAiHandler();
