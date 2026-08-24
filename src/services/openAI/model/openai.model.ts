// openaiService.ts
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import dotenv from "dotenv";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import path from "path";
import os from "os";
import { randomUUID } from "crypto";
import pdfParse from "pdf-parse";
import { promisify } from "util";
import { z } from "zod";
import { calculateAgeFromDob } from "../../../utils/calculateAgefromDob";
import { getPatientById } from "../../patient/model/patient.model";
import { labDataResponseTool, parsedLabSchema } from "../schemas/openai.schema";
import {
  analyzeMeal,
  toLegacyMultiMeal,
  toLegacySingleMeal,
} from "../../meal_analysis/mealAnalysis.service";
import * as legacyCalories from "./legacy/calories.legacy";

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);
dotenv.config();

const apiKey = process.env.REACT_APP_OPENAI_API_KEY;
const openai = new OpenAI({
  apiKey: apiKey || "",
});

export const getChatGptNoteGenerator = async (prompt: string) => {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a medical assistant. Generate a structured SOAP note based on the conversation transcript, following this template.
          Subjective:
          - This [patient's age] yr old [patient gender] presents for
          - History of present illness symptoms
          - Review of symptoms
          - Past Medical History
          - Current medications
          - Allergies
          - Social history
          - Family history

          Objective:
          - General: Patient's general appearance, orientation, mood, and affect
          - Skin, Hair, Nails, HEENT, Heart, Lungs, Abdomen, Back, Rectal, Extremities, Musculoskeletal, Neurologic, Psychiatric

          Assessment:
          - Diagnosis and differential diagnosis

          Plan:
          - Laboratory, X-rays, Medications, Patient Education, Other, Follow-up

          `,
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    });
    if (
      response &&
      response.choices &&
      response.choices[0] &&
      response.choices[0].message &&
      response.choices[0].message.content
    ) {
      return response.choices[0].message.content.trim();
    } else {
      throw new Error("Invalid response structure");
    }
  } catch (error) {
    console.error("error generating the note");
    throw error;
  }
};

export const getChatGptResponse = async (prompt: string) => {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a medical assistant designed to help physicians analyze patient medical records and symptoms to provide a pre-clinical summary. Your responses should be clear, concise, and evidence-based, with a focus on facilitating patient diagnosis and management. You should prioritize patient safety, confidentiality, and adhere to medical guidelines. Provide summaries that highlight key findings, potential diagnoses, and suggest next steps or further investigations as appropriate.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      max_tokens: 1000,
    });

    if (
      response &&
      response.choices &&
      response.choices[0] &&
      response.choices[0].message &&
      response.choices[0].message.content
    ) {
      return response.choices[0].message.content.trim();
    } else {
      throw new Error("Invalid response structure");
    }
  } catch (error) {
    console.error("Error fetching ChatGPT response:", error);
    throw error;
  }
};

// generate medical coding
export const getChatGptMedicalCoding = async (transcript: string) => {
  const prompt = `
  Based on the following clinical note, generate the appropriate ICD-10 and CPT codes:
  \`\`\`
  ${transcript}
  \`\`\`
  Provide the codes in a clear format with brief descriptions of each.
  For the marckdownn language only use ** not ##.
  `;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a medical coding assistant. Your task is to translate medical services, procedures, and diagnoses into standardized codes for billing and insurance claims.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      max_tokens: 500,
    });

    if (
      response &&
      response.choices &&
      response.choices[0] &&
      response.choices[0].message &&
      response.choices[0].message.content
    ) {
      return response.choices[0].message.content.trim();
    } else {
      throw new Error("Invalid response structure");
    }
  } catch (error) {
    console.error("Error generating medical coding:", error);
    throw error;
  }
};
// generate claim submission
export const getChatGptClaimsSubmission = async (transcript: string) => {
  const prompt = `
  Based on the following clinical note and medical codes, generate a claims submission that can be sent to an insurance company for reimbursement:
  \`\`\`
  ${transcript}
  \`\`\`
  Ensure the submission includes a breakdown of services, corresponding codes, and appropriate charge information.
  `;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are an expert in medical billing. Your task is to create a detailed claims submission for insurance reimbursement based on provided clinical notes and medical coding.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      max_tokens: 1000,
    });

    if (
      response &&
      response.choices &&
      response.choices[0] &&
      response.choices[0].message &&
      response.choices[0].message.content
    ) {
      return response.choices[0].message.content.trim();
    } else {
      throw new Error("Invalid response structure");
    }
  } catch (error) {
    console.error("Error generating claims submission:", error);
    throw error;
  }
};

// ---------------------------------------------------------------------------
// Meal analysis (Phase 1). All four calorie entry points delegate to the
// unified analyzeMeal service. MEAL_ANALYSIS_ENGINE=legacy restores the
// previous prompts (see ./legacy/calories.legacy.ts).
// ---------------------------------------------------------------------------
const useLegacyEngine = () => process.env.MEAL_ANALYSIS_ENGINE === "legacy";

/** App: typed description → single-meal shape `{ meals: Ingredient[], mealName, mealType }`. */
export const getOpenAiCaloriesCalculator = async (
  foodDescription: string,
  patientId: string
) => {
  if (useLegacyEngine()) {
    return legacyCalories.getOpenAiCaloriesCalculator(foodDescription, patientId);
  }
  const result = await analyzeMeal({ text: foodDescription }, { patientId });
  return toLegacySingleMeal(result);
};

/** Chat agent: description with meal/date cues → `{ meals: [{ ingredients, mealName, mealType, mealDate }], dateReference, dateConfidence }`. */
export const calculateMultipleMealsCaloriesAndNutrients = async (
  foodDescription: string,
  patientId: string
): Promise<{
  meals: any[];
  dateReference: string | null;
  dateConfidence: number;
}> => {
  if (useLegacyEngine()) {
    return legacyCalories.calculateMultipleMealsCaloriesAndNutrients(
      foodDescription,
      patientId
    );
  }
  const result = await analyzeMeal({ text: foodDescription }, { patientId });
  return toLegacyMultiMeal(result);
};

/** App: meal photo (data URL) + optional caption → single-meal shape. */
export const getCaloriesFromImage = async (
  base64Image: string,
  description: string,
  patientId: string
) => {
  if (useLegacyEngine()) {
    return legacyCalories.getCaloriesFromImage(base64Image, description, patientId);
  }
  const result = await analyzeMeal(
    { imageDataUrl: base64Image, caption: description },
    { patientId }
  );
  return toLegacySingleMeal(result);
};

/** App: voice note → transcript → single-meal shape (transcript echoed back). */
export const getCaloriesFromAudio = async (
  base64Audio: string,
  patientId: string
) => {
  if (useLegacyEngine()) {
    return legacyCalories.getCaloriesFromAudio(base64Audio, patientId);
  }
  const transcript = await speechToText(base64Audio);
  const result = await analyzeMeal({ text: transcript }, { patientId });
  return { ...toLegacySingleMeal(result), transcript };
};

export const speechToText = async (base64Audio: string) => {
  const tempId = randomUUID();
  const tempRawPath = path.join(os.tmpdir(), `ollo-audio-${tempId}.raw`);
  const tempConvertedPath = path.join(os.tmpdir(), `ollo-audio-${tempId}.mp3`);
  try {
    // Convert Base64 to binary and write to a temporary raw file
    const audioBuffer = Buffer.from(
      base64Audio.replace(/^data:audio\/\w+;base64,/, ""),
      "base64"
    );
    await writeFile(tempRawPath, audioBuffer);

    // Convert to MP3 using ffmpeg
    await new Promise<void>((resolve, reject) => {
      ffmpeg(tempRawPath)
        .toFormat("mp3")
        .on("error", reject)
        .on("end", resolve)
        .save(tempConvertedPath);
    });

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tempConvertedPath),
      model: "gpt-4o-mini-transcribe",
    });

    return transcription.text;
  } catch (error: unknown) {
    console.error("Error transcribing the audio", error);
    throw error;
  } finally {
    await unlink(tempRawPath).catch(() => {});
    await unlink(tempConvertedPath).catch(() => {});
  }
};

// generate referral letter
export const getChatGptReferralLetter = async (
  reasonForReferral: string,
  postVisitNote: string,
  specialistType: string
) => {
  const prompt = `
  Please generate a referral letter based on the following anonymized medical note:

  - **Reason for Referral**: ${reasonForReferral}
  - **Post-Visit Note**: ${postVisitNote}
  - **Referral to Specialist in**: ${specialistType}

  The letter should be formal, concise, and emphasize the need for specialist consultation. Do not include any identifiable patient information, and use placeholders where needed.
  `;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a medical administrative assistant helping a physician draft a referral letter.",
        },
        { role: "user", content: prompt },
      ],
      max_tokens: 500,
    });

    return response.choices[0].message?.content?.trim() ?? "";
  } catch (error) {
    console.error("Error generating referral letter:", error);
    throw error;
  }
};
// Generate Pre-auth Letter
export const getChatGptPreAuthLetter = async (
  postVisitNote: string,
  procedureName: string,
  procedureCPTCode: string,
  justification: string
) => {
  const prompt = `
  Please generate a pre-authorization letter based on the following anonymized information:

  - **Post-Visit Note**: ${postVisitNote}
  - **Proposed Treatment/Procedure**: ${procedureName} (CPT Code: ${procedureCPTCode})
  - **Medical Justification**: ${justification}

  The letter should include a request for authorization and emphasize the necessity of the procedure. Do not include any identifiable patient information, and use placeholders where needed.
  `;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a medical administrative assistant helping a physician draft a pre-authorization letter.",
        },
        { role: "user", content: prompt },
      ],
      max_tokens: 500,
    });

    return response.choices[0].message?.content?.trim() ?? "";
  } catch (error) {
    console.error("Error generating pre-auth letter:", error);
    throw error;
  }
};
//generate amount of specific nutrient value
// Define the schema for the array response, but wrapped in an object
const entriesResponseSchema = z.object({
  entries: z.array(
    z.object({
      trackableMetricId: z.string(),
      value: z.number(),
    })
  ),
});

export async function generateLabDataJSON(labText: string, patientId: string) {
  // 1. Fetch patient and extract fields safely
  const patient = await getPatientById(patientId);
  const gender = patient.gender ?? "unknown";
  const age = calculateAgeFromDob(patient.dob);
  const conditions: string[] =
    patient.patientSummary?.conditions?.map((c) => c.condition.name) ?? [];
  const allergies: string[] =
    patient.patientSummary?.allergies?.map((a) => a.allergy.substance) ?? [];
  const medications: string[] =
    patient.patientSummary?.medications?.map((m) => m.medication.name) ?? [];
  // 2. Count how many lab result lines are present
  const labLines = labText
    .split(/\r?\n/)
    .filter((line) => /\w+\s*[:-]\s*[\d.,]+/.test(line));
  const expectedTestCount = labLines.length;
  console.log(expectedTestCount);
  // 3. System prompt with explicit instructions & schema
  const systemMessage = `
You are a Primary Healthcare professional. 
Always respond with valid JSON matching this TypeScript schema exactly:

interface LabInsight {
  labResults: Array<{
    testType: string;        // e.g. "WBC"
    category: string;        // e.g. "Hematology"
    result: string;          // raw value as string, e.g. "4.3"
    referenceRange: string;  // e.g. "3.4-10.8 x10E3/uL"
    isOutOfRange: boolean;   // true if result outside referenceRange
    units: string;           // e.g. "x10E3/uL"
    aboutTestType: string;   // a short description that explains the lab test.
  }>;
  labReport: string;
  recommendations: {
    nutrition: string;
    exercise: string;
  };
}

// CRITICAL REQUIREMENTS:
1. You MUST include ALL lab results in the labResults array - both normal AND abnormal values
2. Parse EVERY line of lab data provided, regardless of whether the result is normal or abnormal
3. The labResults array should contain exactly ${expectedTestCount} entries (one for each lab test)
3. Do not skip any lab results, even if they appear normal
4. Be extremely cautious when distinguishing between the test result and the reference range.
  - The Result is always the specific measurement or outcome for the patient (e.g., a single value like 149, 13.9, 3.84 L, or a categorical outcome like NON-REACTIVE).
  - The Reference Range describes the expected or normal values, often expressed as inequalities (<, >, ≤, ≥) or ranges (X–Y).
  - Do not put a range or inequality into the Result field.
  - If the text is ambiguous, prefer leaving Result = null rather than incorrectly copying the range.
  Always ensure Result and Range are distinct and never identical.
6. SPECIAL HANDLING for labs with current vs previous result values:
  - When you see patterns that contains current and previous value where the first number is current and second number is previous:
    * Current result = FIRST number only 
    * Previous result = SECOND number only  
    * Do NOT combine them 
    * Use clinical reasoning to determine which number is current vs previous:
      - For triglycerides: Normal range is typically 0-150 mg/dL, so 49 is logical as current, 61 as previous
      - For glucose: Normal range is 70-100 mg/dL, so smaller numbers are usually current
      - For cholesterol: Total cholesterol normal is <200 mg/dL, so smaller numbers are usually current
      - When in doubt, the FIRST number is typically current, SECOND number is previous
      - If the numbers don't make clinical sense (e.g., 496 for triglycerides would be extremely high), 
        then the first number is current and second is previous 
    * Do NOT include any part of the previous value in the current result
  - When in doubt, prefer the smaller/first number as current result
  - Examples:
    * "496109/04/2024" → current: 49, previous: 61
    * "556510/08/2024" → current: 55, previous: 65  
    * "123456" → current: 12, previous: 34, data: 56
// Write a structured, patient-friendly summary of the overall labs .

// For each individual abnormal value, use this format:
// “Your [test name] is [value] ([reference range]). [Explain what this result means and the potential clinical implications]. [Briefly suggest next steps, e.g., medical follow-up, lifestyle review, or retesting if appropriate].”

// After listing individual results, add a short synthesis paragraph IF the combination of abnormalities suggests a possible clinical pattern (e.g., metabolic syndrome, iron-deficiency anemia, early kidney disease, inflammation).
// The synthesis should:
  // - Group related abnormalities together (e.g. A1c + triglycerides + HDL = possible metabolic syndrome)
  // - Explain what the pattern may indicate
  // - Use cautious, non-diagnostic phrasing like “This pattern may suggest...” or “These results could be consistent with...”
  // - Suggest reasonable next steps (e.g. discussing risk factors, lifestyle changes, or monitoring)

// Example synthesis:
// “Taken together, your elevated Hemoglobin A1c, high triglycerides, and low HDL cholesterol may be consistent with a pattern seen in metabolic syndrome. This is a cluster of risk factors that can increase the likelihood of developing diabetes and heart disease. Your provider may want to review your overall cardiovascular and metabolic risk and consider early interventions.”

// If no clear pattern emerges, skip the synthesis and only include the itemized explanations.


}

  recommendations: {
    nutrition: string;
    // Provide personalized dietary recommendations based on the abnormal lab result(s).
    // Always prioritize abnormalities with strong clinical guidance (e.g. high LDL, low HDL, high A1c, high triglycerides).
    // Link each food suggestion directly to a specific lab finding (e.g. high LDL).
    // Briefly explain how the food helps — or how avoiding it helps (e.g. "limit phosphorus in CKD to reduce kidney stress").
    // Only provide dietary advice if there is clear, evidence-based, clinically meaningful guidance related to the lab result.
    // If diet is sometimes relevant but depends on further context (e.g. iodine for TSH, iron for anemia), use conditional phrasing:
    // “If iodine deficiency is confirmed…” or “If iron deficiency is the cause…”
    // If no dietary changes are supported for the finding (e.g. ANA, STD results),give some generic nutrition advice provided by national institutions.
    // Do not include vague or generic advice like “eat healthy” or “maintain a balanced diet”.
    // Avoid giving nutrition advice for lab values where diet is not directly implicated (e.g. TSH, WBC, infections).

    exercise: string;
    // Provide 1–2 specific exercise recommendations tied directly to the lab abnormality.
    // Mention the type (e.g. aerobic, resistance), frequency (e.g. 30 minutes 5x/week), and benefit (e.g. "aerobic exercise helps improve insulin sensitivity").
    // ONLY provide exercise guidance if there is clinical evidence that physical activity impacts the lab abnormality or its symptoms.
    // Do NOT include general wellness advice like “exercise supports overall health.”
    // If exercise is not directly relevant (e.g. TSH, CRP, infection markers), give some generic exercise advice provided by national institutions.
  };
}

// Examples for Diagnostic Uncertainty:
If labs suggest a condition (e.g. anemia, hypothyroidism) but don’t confirm it, use conditional phrasing in recommendations.

Examples:

// Anemia
"nutrition": "If iron deficiency is confirmed, include more iron-rich foods such as lentils, red meat, or spinach to improve hemoglobin.",
"exercise": "Light walking may help circulation, but avoid intense activity until anemia is evaluated."

// Hypothyroidism (TSH > 4.5)
"nutrition": "If iodine deficiency is suspected, foods like fish or seaweed may support thyroid hormone production. However, excess iodine can worsen autoimmune thyroid conditions.",
"exercise": "Light aerobic activity may help energy and mood once medically cleared. It does not directly affect thyroid levels."

// CRP elevated
"nutrition": "No specific foods lower CRP directly, but a diet rich in leafy greens, berries, and fatty fish may reduce chronic inflammation.",
"exercise": "Gentle activity like walking or yoga may help with inflammation unless symptoms suggest illness. Consult your provider."

// Infection (e.g. positive Chlamydia, high WBC)
"nutrition": "There are no specific dietary recommendations for this result. Please follow up with your provider.",
"exercise": "There are no exercise-based strategies known to affect this result. Medical treatment is required."

// Lipids or Prediabetes
"nutrition": "Reducing saturated fat, added sugar, and increasing fiber may help lower LDL and triglycerides, and improve glucose levels.",
"exercise": "Regular aerobic activity (e.g. brisk walking 30 mins/day, 5x/week) can improve insulin sensitivity and support heart health."

// Prioritization Guidance:
- Do not limit recommendations to just 1 or 2 lab results. Instead, prioritize based on what’s most clinically significant (e.g. lipid abnormalities > borderline anemia).
- For results like TSH, CRP, or liver enzymes, be cautious and refer to provider follow-up unless a clear dietary/exercise link is known."
 };
}

// Use these specific names for certain lab results:
make sure to name the total colesterol lab ***TCL***
const labTestEnum = {
  "High Density Lipoprotein": "HDL",
  "Total Cholesterol": "TCL",
  "Cholesterol, Total": "TCL",
  "Triglycerides": "Triglycerides",
  "Glucose": "Glucose",
  "Albumin": "Albumin",
  "Creatinine": "Creatinine",
  "C-Reactive Protein": "CRP",
  "Red Cell Distribution Width": "RDW",
  "White Blood Cell Count": "WBC",
  "Mean Corpuscular Volume": "MCV",
  "Lymphocyte Count": "Lympocite",
  "Lymphs Absolute": "Lympocite Absolute",
  "Alkaline Phosphatase": "Alkaline Phosphatase"
};


// Final Output Requirements:

1. Parse carefully each line in order to create all the entries in **labResults**.
2. For each **aboutTestType**, write exactly one patient‐friendly sentence.
3. After **labResults**, produce **labReport** calling out any out‐of‐range or borderline values.
4. Then fill **recommendations.nutrition** and **recommendations.exercise** with advice tailored to those findings.
5. Do NOT emit any extra keys or free‐form text outside this JSON structure.
6. Never assume a diagnosis unless clearly supported by multiple values.
7. When unsure, use conditional language and defer to a medical provider for interpretation or next steps.
8. IMPORTANT: The labReport field should contain a structured summary, NOT the raw lab text. Focus on abnormal and borderline results and their clinical significance.
`.trim();

  // 4. User payload with patient data and lab text
  const userPayload = {
    patient: { gender, age, conditions, allergies, medications },
    labText: labText,
    expectedTestCount,
  };

  // 5. Invoke the model deterministically with a high token limit
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    // max_tokens: 8192,
    messages: [
      { role: "system", content: systemMessage },
      { role: "user", content: JSON.stringify(userPayload) },
    ],
    tools: [labDataResponseTool],
    tool_choice: {
      type: "function",
      function: { name: "generateLabDataResponse" },
    },
  });

  // 6. Return the parsed, typed JSON
  const toolCall = completion.choices[0].message.tool_calls?.[0];
  if (!toolCall) {
    throw new Error("No structured output returned");
  }

  return JSON.parse(toolCall.function.arguments);
}
export async function generateLabDataJSONFromBase64(
  base64Pdf: string,
  patientId: string
) {
  // 1. Decode base64 into Buffer
  const pdfBuffer = Buffer.from(base64Pdf, "base64");

  // 2. Extract text from PDF
  const parsedData = await pdfParse(pdfBuffer);
  const labText = parsedData.text.trim();

  // 3. Fetch patient and extract fields safely
  const patient = await getPatientById(patientId);
  const gender = patient.gender ?? "unknown";
  const age = calculateAgeFromDob(patient.dob);
  const conditions: string[] =
    patient.patientSummary?.conditions?.map((c) => c.condition.name) ?? [];
  const allergies: string[] =
    patient.patientSummary?.allergies?.map((a) => a.allergy.substance) ?? [];
  const medications: string[] =
    patient.patientSummary?.medications?.map((m) => m.medication.name) ?? [];

  // 4. Count lab result lines
  const labLines = labText
    .split(/\r?\n/)
    .filter((line) => /\w+\s*[:-]\s*[\d.,]+/.test(line));
  const expectedTestCount = labLines.length;

  // 5. Build the system prompt (same as before)
  const systemMessage = `
  You are a Primary Healthcare professional. 
  Always respond with valid JSON matching this TypeScript schema exactly:
  
  interface LabInsight {
    labResults: Array<{
      testType: string;        // e.g. "WBC"
      category: string;        // e.g. "Hematology"
      result: string;          // raw value as string, e.g. "4.3"
      referenceRange: string;  // e.g. "3.4-10.8 x10E3/uL"
      isOutOfRange: boolean;   // true if result outside referenceRange
      units: string;           // e.g. "x10E3/uL"
      aboutTestType: string;   // a short description that explains the lab test.
    }>;
    labReport: string;
    recommendations: {
      nutrition: string;
      exercise: string;
    };
  }
  
  // CRITICAL REQUIREMENTS:
  1. You MUST include ALL lab results in the labResults array - both normal AND abnormal values
  2. Parse EVERY line of lab data provided, regardless of whether the result is normal or abnormal
  3. The labResults array should contain exactly ${expectedTestCount} entries (one for each lab test)
  3. Do not skip any lab results, even if they appear normal
  
  // Write a structured, patient-friendly summary of the overall labs .
  
  // For each individual abnormal value, use this format:
  // “Your [test name] is [value] ([reference range]). [Explain what this result means and the potential clinical implications]. [Briefly suggest next steps, e.g., medical follow-up, lifestyle review, or retesting if appropriate].”
  
  // After listing individual results, add a short synthesis paragraph IF the combination of abnormalities suggests a possible clinical pattern (e.g., metabolic syndrome, iron-deficiency anemia, early kidney disease, inflammation).
  // The synthesis should:
    // - Group related abnormalities together (e.g. A1c + triglycerides + HDL = possible metabolic syndrome)
    // - Explain what the pattern may indicate
    // - Use cautious, non-diagnostic phrasing like “This pattern may suggest...” or “These results could be consistent with...”
    // - Suggest reasonable next steps (e.g. discussing risk factors, lifestyle changes, or monitoring)
  
  // Example synthesis:
  // “Taken together, your elevated Hemoglobin A1c, high triglycerides, and low HDL cholesterol may be consistent with a pattern seen in metabolic syndrome. This is a cluster of risk factors that can increase the likelihood of developing diabetes and heart disease. Your provider may want to review your overall cardiovascular and metabolic risk and consider early interventions.”
  
  // If no clear pattern emerges, skip the synthesis and only include the itemized explanations.
  
  
  }
  
    recommendations: {
      nutrition: string;
      // Provide personalized dietary recommendations based on the abnormal lab result(s).
      // Always prioritize abnormalities with strong clinical guidance (e.g. high LDL, low HDL, high A1c, high triglycerides).
      // Link each food suggestion directly to a specific lab finding (e.g. high LDL).
      // Briefly explain how the food helps — or how avoiding it helps (e.g. "limit phosphorus in CKD to reduce kidney stress").
      // Only provide dietary advice if there is clear, evidence-based, clinically meaningful guidance related to the lab result.
      // If diet is sometimes relevant but depends on further context (e.g. iodine for TSH, iron for anemia), use conditional phrasing:
      // “If iodine deficiency is confirmed…” or “If iron deficiency is the cause…”
      // If no dietary changes are supported for the finding (e.g. ANA, STD results), say:
      // “There are no specific dietary recommendations for this result. Please consult your healthcare provider.”
      // Do not include vague or generic advice like “eat healthy” or “maintain a balanced diet”.
      // Avoid giving nutrition advice for lab values where diet is not directly implicated (e.g. TSH, WBC, infections).
  
      exercise: string;
      // Provide 1–2 specific exercise recommendations tied directly to the lab abnormality.
      // Mention the type (e.g. aerobic, resistance), frequency (e.g. 30 minutes 5x/week), and benefit (e.g. "aerobic exercise helps improve insulin sensitivity").
      // ONLY provide exercise guidance if there is clinical evidence that physical activity impacts the lab abnormality or its symptoms.
      // Do NOT include general wellness advice like “exercise supports overall health.”
      // If exercise is not directly relevant (e.g. TSH, CRP, infection markers), say:
      // “There are no exercise-based strategies known to affect this result. Medical follow-up is recommended.”
    };
  }
  
  // Examples for Diagnostic Uncertainty:
  If labs suggest a condition (e.g. anemia, hypothyroidism) but don’t confirm it, use conditional phrasing in recommendations.
  
  Examples:
  
  // Anemia
  "nutrition": "If iron deficiency is confirmed, include more iron-rich foods such as lentils, red meat, or spinach to improve hemoglobin.",
  "exercise": "Light walking may help circulation, but avoid intense activity until anemia is evaluated."
  
  // Hypothyroidism (TSH > 4.5)
  "nutrition": "If iodine deficiency is suspected, foods like fish or seaweed may support thyroid hormone production. However, excess iodine can worsen autoimmune thyroid conditions.",
  "exercise": "Light aerobic activity may help energy and mood once medically cleared. It does not directly affect thyroid levels."
  
  // CRP elevated
  "nutrition": "No specific foods lower CRP directly, but a diet rich in leafy greens, berries, and fatty fish may reduce chronic inflammation.",
  "exercise": "Gentle activity like walking or yoga may help with inflammation unless symptoms suggest illness. Consult your provider."
  
  // Infection (e.g. positive Chlamydia, high WBC)
  "nutrition": "There are no specific dietary recommendations for this result. Please follow up with your provider.",
  "exercise": "There are no exercise-based strategies known to affect this result. Medical treatment is required."
  
  // Lipids or Prediabetes
  "nutrition": "Reducing saturated fat, added sugar, and increasing fiber may help lower LDL and triglycerides, and improve glucose levels.",
  "exercise": "Regular aerobic activity (e.g. brisk walking 30 mins/day, 5x/week) can improve insulin sensitivity and support heart health."
  
  // Prioritization Guidance:
  - Do not limit recommendations to just 1 or 2 lab results. Instead, prioritize based on what’s most clinically significant (e.g. lipid abnormalities > borderline anemia).
  - For results like TSH, CRP, or liver enzymes, be cautious and refer to provider follow-up unless a clear dietary/exercise link is known."
   };
  }
  
  // Use these specific names for certain lab results:
  make sure to name the total colesterol lab ***TCL***
  const labTestEnum = {
    "High Density Lipoprotein": "HDL",
    "Total Cholesterol": "TCL",
    "Cholesterol, Total": "TCL",
    "Triglycerides": "Triglycerides",
    "Glucose": "Glucose",
    "Albumin": "Albumin",
    "Creatinine": "Creatinine",
    "C-Reactive Protein": "CRP",
    "Red Cell Distribution Width": "RDW",
    "White Blood Cell Count": "WBC",
    "Mean Corpuscular Volume": "MCV",
    "Lymphocyte Count": "Lympocite",
    "Lymphs Absolute": "Lympocite Absolute",
    "Alkaline Phosphatase": "Alkaline Phosphatase"
  };
  
  
  // Final Output Requirements:
  
  1. Parse carefully each line in order to create all the entries in **labResults**.
  2. For each **aboutTestType**, write exactly one patient‐friendly sentence.
  3. After **labResults**, produce **labReport** calling out any out‐of‐range or borderline values.
  4. Then fill **recommendations.nutrition** and **recommendations.exercise** with advice tailored to those findings.
  5. Do NOT emit any extra keys or free‐form text outside this JSON structure.
  6. Never assume a diagnosis unless clearly supported by multiple values.
  7. When unsure, use conditional language and defer to a medical provider for interpretation or next steps.
  8. IMPORTANT: The labReport field should contain a structured summary, NOT the raw lab text. Focus on abnormal and borderline results and their clinical significance.
  `.trim();

  // 6. Build the user payload
  const userPayload = {
    patient: { gender, age, conditions, allergies, medications },
    labText,
    expectedTestCount,
  };

  // 7. Call the model
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    messages: [
      { role: "system", content: systemMessage },
      { role: "user", content: JSON.stringify(userPayload) },
    ],
    tools: [labDataResponseTool],
    tool_choice: {
      type: "function",
      function: { name: "generateLabDataResponse" },
    },
  });

  // 8. Parse structured output
  const toolCall = completion.choices[0].message.tool_calls?.[0];
  if (!toolCall) {
    throw new Error("No structured output returned");
  }

  return JSON.parse(toolCall.function.arguments);
}

/**
 * Extracts lab results from text and returns them as plain text, one result per line.
 * Each line: resultName, result, referenceRange (if present, else blank)
 * Uses normal OpenAI API call (not structured output).
 * The model must use ONE of the following as a separator between lines: \n, |, or ;; (do not mix).
 */
export async function formatLabDataText(labText: string) {
  const systemMessage = `
You are a Primary Healthcare professional. Extract all laboratory results from the provided text. For each lab result, return a single line in the following format:

<resultName>: <result> (<referenceRange>)

- resultName: the name of the lab test (e.g., HBC, Glucose, etc.)
- result: the value/result of the test (as a string, e.g., "13.2")
- referenceRange: the reference range for the test (as a string, e.g., "12.0-16.0 g/dL")

If a reference range is not present for a result, leave the parentheses empty, e.g.,
Glucose: 100 ()

IMPORTANT: Use the following as a separator between each lab result line: newline (\\n),  Use the same separator for all lines and do not mix them. Do not include any extra text, explanation, or formatting. Only output one lab result per line, separated by your chosen separator, and nothing else.`;

  const userPayload = labText.trim();

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemMessage },
      { role: "user", content: userPayload },
    ],
    temperature: 0,
    max_tokens: 512,
  });

  if (
    response &&
    response.choices &&
    response.choices[0] &&
    response.choices[0].message &&
    response.choices[0].message.content
  ) {
    return response.choices[0].message.content.trim();
  } else {
    throw new Error("Invalid response structure");
  }
}

export async function formatLabData(labText: string) {
  // 3. System prompt with explicit instructions & schema
  const systemMessage = `
You are a Primary Healthcare professional. Extract all laboratory results from the provided text and return them as a JSON array. For each lab result, include:
- resultName: the name of the lab test (e.g., HBC, Glucose, etc.)
- result: the value/result of the test (as a string, e.g., "13.2")
- referenceRange: the reference range for the test (as a string, e.g., "12.0-16.0 g/dL")

Return only valid JSON in this format:
[
  {
    "resultName": "HBC",
    "result": "13.2",
    "referenceRange": "12.0-16.0 g/dL"
  },
  ...
]
If a reference range is not present for a result, set referenceRange to an empty string.
Do not include any extra text or explanation outside the JSON array.
`;

  // 4. User payload with lab text
  const userPayload = {
    labText: labText.trim(),
  };

  // 5. Invoke the model deterministically with a high token limit
  const completion = await openai.responses.parse({
    model: "gpt-4o-mini",
    temperature: 0,
    input: [
      { role: "system", content: systemMessage },
      { role: "user", content: JSON.stringify(userPayload) },
    ],
    text: {
      format: zodTextFormat(parsedLabSchema, "parsed_lab_schema"),
    },
  });

  // 6. Return the parsed, typed JSON
  const labs = completion.output_parsed;
  return labs;
}
