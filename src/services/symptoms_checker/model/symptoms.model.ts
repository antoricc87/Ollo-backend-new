import dotenv from "dotenv";
import OpenAI from "openai";
import { zodResponseFormat, zodTextFormat } from "openai/helpers/zod";
import { createSummaryToAnalyze } from "../../../utility/Patient Summaries/usePatientSummaries";

import {
  diagnosisResponseSchema,
  questionSchemaArray,
} from "../schemas/symptoms.schema";

dotenv.config();

//initiating openai instance
const apiKey = process.env.REACT_APP_OPENAI_API_KEY;
const openai = new OpenAI({
  apiKey: apiKey || "",
});

class SymptomsService {
  //generate tailored questions for final diagnosis
  // async generateFollowUpQuestions(symptoms: string, patientSummary: any) {
  //   const processedSummary = processSummary(patientSummary);

  //   const prompt = `
  //     Symptoms: ${symptoms}
  //     Patient's History:
  //     Active Conditions: ${processedSummary.conditions.join(", ")}
  //     Medications: ${processedSummary.medications.join(", ")}
  //     Procedures: ${processedSummary.procedures.join(", ")}
  //     Allergies: ${processedSummary.allergies
  //       .map((a) => a.substance)
  //       .join(", ")}

  //     You are a primary care doctor. Based on the symptoms and history, generate up to 10 close-ended or multiple-choice questions
  //     to narrow the diagnosis. Format:
  //     {
  //       "questions": [
  //         {
  //           "question": "Do you have a fever?",
  //           "options": ["Yes", "No", "Not sure"]
  //         }
  //       ]
  //     }
  //   `;

  //   try {
  //     const response = await openai.beta.chat.completions.parse({
  //       model: "gpt-4o-mini",
  //       messages: [{ role: "system", content: prompt }],
  //       response_format: zodResponseFormat(
  //         questionSchemaArray,
  //         "symptoms_response_array_schema"
  //       ),
  //     });

  //     return response.choices[0].message.parsed;
  //   } catch (error) {
  //     console.error("Error generating questions:", error);
  //     throw error;
  //   }
  // }

  async generateInitialAssessment(symptoms: string, patientSummary: string) {
    const prompt = `
      You are an experienced primary care physician reviewing a patient's medical history before their visit. 
      
      ### Patient Data:
      ${patientSummary}
  
      ### Reported Symptoms:
      ${symptoms}
  
      ### Instructions:
      - **Analyze the provided patient history and tracker data holistically**.
      - **Identify key highlights** from the patient's medical history (conditions, medications, procedures).
      - **Examine health trends: Examine the trackers (blood pressure, glucose, nutrient tracker) and highlight and comment any relevant value.**
      - **Look for potential correlations** between symptoms and the patient's medical data.
      - **Summarize your findings concisely**.
  
      ### Response Format:
      Provide a **short and structured** initial assessment, highlighting key findings. Format:
      """
      [Initial Assessment]
      - Medical History Highlights: (e.g., "History of hypertension, currently taking Lisinopril")
      - Tracker Insights: (e.g., "Blood pressure fluctuating, glucose levels stable")
      - Symptom Correlations: (e.g., "Dizziness may be linked to recent blood pressure drop")
      - Areas for Further Inquiry: (e.g., "Assess dietary sodium intake impact on hypertension")
      """
    `;

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: prompt }],
      });

      return response.choices[0].message.content.trim();
    } catch (error) {
      console.error("Error generating initial assessment:", error);
      throw error;
    }
  }

  async generateInitialQuestionsWithId(
    symptoms: string,
    patientId: string,
    previousAnswers: any[] = []
  ) {
    const patientSummary = await createSummaryToAnalyze(patientId, 4);
    const initialAssessment = await this.generateInitialAssessment(
      symptoms,
      JSON.stringify(patientSummary)
    );

    console.log("📡 Received previous answers:", previousAnswers);
    console.log("📡 Initial Assessment:", initialAssessment);

    // Extract already-asked questions to avoid duplicates
    const answeredQuestions = previousAnswers.map((q) =>
      q.question.toLowerCase()
    );

    // Ensure AI is aware of already collected answers
    const formattedAnswers = previousAnswers
      .map((q) => `${q.question}: ${q.answer}`)
      .join("\n");

    // Set a maximum number of total questions
    const MAX_TOTAL_QUESTIONS = 4;
    if (previousAnswers.length >= MAX_TOTAL_QUESTIONS) {
      console.log("🚨 Maximum question limit reached. Triggering diagnosis...");
      return { questions: [] };
    }

    console.log("📌 Generating new follow-up questions...");

    const prompt = `
      You are an experienced internal medicine physician generating an initial set of questions to the patient to get to a potential diagnosis based on an initial assessment and symptoms. 

      ### Patient Data:
      ${initialAssessment}
  
      ### Symptoms Reported:
      ${symptoms}
  
      ### Previous Answers:
      ${formattedAnswers}
  
      ### Instructions:
      - ** Based on the initial assessment generate a list of 5 questions that can help initially narrow down a potential diagnosis. If symptoms suggest a high-risk condition, prioritize ruling out dangerous differentials.
      - ** Do NOT ask questions that are relative to data already available in the initial assessment ${initialAssessment}  
      - **Do NOT ask questions that are slight variations of previous ones.**
      - **Only generate questions that introduce NEW insights.**
      - **Do NOT ask about general symptoms. Instead, target specific differential diagnoses.**
  
      **Response Format:**
      {
        "questions": [
          {
            "question": "Do you have swelling in other areas besides your legs?",
            "options": ["Yes", "No", "Not sure"]
          },
          {
            "question": "Have you experienced rapid weight gain in the past few weeks?",
            "options": ["Yes", "No", "Not sure"]
          }
        ]
      }
    `;

    try {
      const response = await openai.responses.parse({
        model: "gpt-4o-mini",
        input: [{ role: "system", content: prompt }],
        text: {
          format: zodTextFormat(
            questionSchemaArray,
            "symptoms_response_array_schema"
          ),
        },
      });

      return response.output_parsed;
    } catch (error) {
      console.error("❌ Error generating follow-up questions:", error);
      throw error;
    }
  }

  async generateMiddleAssessment(
    symptoms: string,
    initialAssessment: string,
    previousAnswers: any[] = []
  ) {
    console.log("📡 Generating Middle Assessment...");

    const formattedAnswers = previousAnswers
      .map((q) => `${q.question}: ${q.answer}`)
      .join("\n");

    console.log("Previous answers", formattedAnswers);

    const middleAssessmentPrompt = `
      You are an experienced physician analyzing a patient's evolving clinical picture.
  
      ### Initial Assessment:
      ${initialAssessment}
  
      ### Symptoms Reported:
      ${symptoms}
  
      ### Answers Collected So Far:
      ${formattedAnswers}
  
      ### Instructions:
      - **Summarize the patient's condition so far, considering their history, symptoms, and answers.**
      - **Make a summary of the answers provided so far and the meanings of these answers, if any.**
      - **Highlight which conditions have been ruled out and which should be further investigated.**
      - **Indicate the next best area to focus questions on.**
  
      **Response Format:**
      """
      [Middle Assessment]
      - Summary of patient’s condition so far...
      - Summary of patient's answers so far...
      - Conditions ruled out: ...
      - Suggested focus for next questions: ...
      """
    `;

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: middleAssessmentPrompt }],
      });

      const middleAssessment = response.choices[0].message.content.trim();
      console.log("✅ Middle Assessment Generated:", middleAssessment);
      return middleAssessment;
    } catch (error) {
      console.error("❌ Error generating Middle Assessment:", error);
      throw error;
    }
  }

  async generateFollowUpQuestionsWithId(
    symptoms: string,
    patientId: string,
    previousAnswers: any[] = []
  ) {
    const patientSummary = await createSummaryToAnalyze(patientId, 4);
    const initialAssessment = await this.generateInitialAssessment(
      symptoms,
      JSON.stringify(patientSummary)
    );

    console.log("📡 Received previous answers:", previousAnswers);

    // 🔹 Call `generateMiddleAssessment` before generating new questions
    const middleAssessment = await this.generateMiddleAssessment(
      symptoms,
      initialAssessment,
      previousAnswers
    );

    // Generate Follow-Up Questions Based on Middle Assessment
    const formattedAnswers = previousAnswers
      .map((q) => `${q.question}: ${q.answer}`)
      .join("\n");

    console.log("📡 Generating Follow-Up Questions...");
    console.log("📌 Middle Assessment:", middleAssessment);
    console.log(
      "📌 Previous Answers:",
      JSON.stringify(previousAnswers, null, 2)
    );

    const prompt = `
      You are an experienced internal medicine physician generating an initial set of questions to the patient to get to a potential diagnosis based on an initial assessment and symptoms. 

    ### Middle Assessment:
    ${middleAssessment}
  
      ### Symptoms Reported:
      ${symptoms}
  
      ### Previous Answers:
      ${formattedAnswers}
  
      ### Instructions:
      - ** Based on the middle assessment generate a list of 5 follow up questions that can help further narrow down a potential diagnosis. 
      - ** Do NOT ask questions that are relative to data already available in the middle assessment ${middleAssessment}  
      - **Do NOT ask questions that are slight variations of previous ones.**
      - **Only generate questions that introduce NEW insights.**
      - **Do NOT ask about general symptoms. Instead, target specific differential diagnoses.**
  
      **Response Format:**
      {
        "questions": [
          {
            "question": "Do you have swelling in other areas besides your legs?",
            "options": ["Yes", "No", "Not sure"]
          },
          {
            "question": "Have you experienced rapid weight gain in the past few weeks?",
            "options": ["Yes", "No", "Not sure"]
          }
        ]
      }
    `;

    try {
      const response = await openai.responses.parse({
        model: "gpt-4o-mini",
        input: [{ role: "system", content: prompt }],
        text: {
          format: zodTextFormat(
            questionSchemaArray,
            "symptoms_response_array_schema"
          ),
        },
      });

      return response.output_parsed;
    } catch (error) {
      console.error("❌ Error generating follow-up questions:", error);
      throw error;
    }
  }

  //generate diagnosis based on symptoms and asked questions
  // Generate diagnosis based on symptoms, middle assessment, and follow-up answers
  async generateDiagnosisFromQuestions(
    symptoms: string,
    patientId: any,
    previousAnswers: any
  ) {
    console.log("📡 Fetching patient summary...");
    const patientSummary = await createSummaryToAnalyze(patientId, 4);

    console.log("📡 Generating middle assessment before final diagnosis...");
    const middleAssessment = await this.generateMiddleAssessment(
      symptoms,
      JSON.stringify(patientSummary),
      previousAnswers
    );

    // 🔹 Format patient data into a structured context
    const patientContext = `
    ### Middle Assessment Summary:
    ${middleAssessment}

    ### Symptoms Reported:
    ${symptoms}

    ### Answered Follow-Up Questions:
    ${previousAnswers.map((q) => `${q.question}: ${q.answer}`).join("\n")}
  `;

    const systemMessage = `
    You are a primary care physician reviewing a patient's case and generating a final diagnostic report.

    ### Patient Data:
    ${patientContext}

    ### Instructions:
    - **Analyze the full clinical picture**: symptoms, history, tracker data, and patient responses.
    - **Determine the most likely diagnosis** and differential diagnoses.
    - **Explain how the patient's history and responses support your conclusions**.
    - **Suggest tests to confirm the diagnosis** (if necessary).
    - **Provide relevant treatment recommendations**.
    
    
    The response must be in JSON format with the following fields:
      - "mostLikelyDiagnosis" (string): The most probable diagnosis.
      - "differentialDiagnosis" (array of strings): Other possible diagnoses.
      - "recommendations" (string): Suggestions for treatment or care.
      - "potentialTests" (array of strings): Diagnostic tests to confirm or explore further.

      Symptoms: ${symptoms}

      Patient's History & Follow-Up Questions:
      ${patientContext}
    `;

    const userMessage =
      "Generate the diagnosis report in the format described above.";

    try {
      const response = await openai.responses.parse({
        model: "gpt-4o-mini",
        input: [
          { role: "system", content: systemMessage },
          { role: "user", content: userMessage },
        ],
        text: {
          format: zodTextFormat(
            diagnosisResponseSchema,
            "detailed_diagnosis_response_schema"
          ),
        },
      });

      // Return the parsed response
      return response.output_parsed;
    } catch (error: unknown) {
      console.error("Something went wrong generating diagnosis", error);
      throw error;
    }
  }
}
export default new SymptomsService();
