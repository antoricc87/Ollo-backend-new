import { Tool } from "langchain/tools";
import { getPatientById } from "../../patient/model/patient.model";
import { getCurrentWeekRange } from "../../../utils/formatDate";
import CaloriesService from "../../calories_tracker/model/calories.model";
import NutritionService from "../../nutrition/model/nutrition.model";
import { ChatOpenAI } from "@langchain/openai";
import { BaseMessage } from "@langchain/core/messages";
import { createSummaryToAnalyze } from "../../../utility/Patient Summaries/usePatientSummaries";

export class RecommendedTestGeneratorTool extends Tool {
  name = "recommended_medical_tests_generator";
  description =
    "Generate a list of recommended medical tests to be done based on the patient personal and health data";
  constructor(private patientId: string) {
    super();
  }

  // _call method where the tool fetches data and generates a response
  async _call() {
    // Log the patientId to verify it's passed correctly
    console.log(
      "Tests recommendationTool has been called with patientId:",
      this.patientId
    );

    // Fetch patient data
    const patient = await getPatientById(this.patientId);

    // Log the patient data to confirm it's fetched correctly
    if (!patient) {
      console.log("No patient data found for patientId:", this.patientId);
      return "No patient data found.";
    }

    // Destructure the necessary patient data for generating the meal plan
    const { familyHistory, allergies, conditions } = patient.patientSummary;

    // Generate the meal plan string using the fetched data
    const recommendedTests = `Generate a list of recommended medical tests for the patient to take, based on their health status :
      Allergies:${JSON.stringify(allergies)}
      Conditions:${JSON.stringify(conditions)}
      Family History:${JSON.stringify(familyHistory)}
      Gender:${patient.gender}
      DOB:${patient.dob}
      `;
    return recommendedTests;
  }
}

export class HealthFallbackTool extends Tool {
  name = "fallback_response";
  description =
    "Provides a personalized response  to the user query, using the patient health data.";

  constructor(private patientId: string) {
    super();
  }

  async _call(input: string) {
    console.log("FallbackTool activated. Handling general query.");

    const patient = await getPatientById(this.patientId);

    if (!patient) {
      console.log("No patient data found for patientId:", this.patientId);
      return `I'm here to assist you with any general health, nutrition, or fitness inquiries. How can I help today?`;
    }
    // Fetch user's nutrient tracking data
    const whereClause = { userId: this.patientId };
    const { start, end } = getCurrentWeekRange();

    const nutrientsTracker = await NutritionService.getNutrientsTracker(
      whereClause
    );
    const caloriesTracker = await CaloriesService.getCaloriesTracker(
      whereClause
    );
    const currentWeekNutrients = nutrientsTracker.weeklyEntries.find(
      (entry: any) => {
        return entry.startOfWeek.split("T")[0] === start.split("T")[0];
      }
    );
    const currentWeekCalories = caloriesTracker.weeklyEntries.find(
      (entry: any) => {
        return entry.startOfWeek.split("T")[0] === start.split("T")[0];
      }
    );

    if (!nutrientsTracker) {
      console.log(
        "No nutrient tracking data found for patientId:",
        this.patientId
      );
      return "No nutrient tracking data found.";
    }

    const { carbohydratesLimit, proteinsLimit, fatsLimit } = nutrientsTracker;

    const { conditions, nutrition, medications, familyHistory, allergies } =
      patient.patientSummary;

    return `Respond to the user query, if needed personalize the response using the patient health and wellness data.
      - **Health Conditions & Allergies**: ${JSON.stringify(
        conditions
      )} | ${JSON.stringify(allergies)}
      - **Patient Family History**:${familyHistory}
      - **Patient medications**:${medications}
      Patient Nutrition Preferences: ${JSON.stringify(nutrition)}
       - **Caloric Balance**: Analyze the user's **weekly calorie intake (${
         currentWeekCalories.totalIntake
       } kcal)** compared to their **recommended daily intake (${
      patient.patientSummary.caloricAmount
    } kcal)**.
      - **Macronutrient Balance**:
        - Carbohydrates: ${carbohydratesLimit}g
        - Proteins: ${proteinsLimit}g
        - Fats: ${fatsLimit}g
      - **Weekly Nutrient Intake**: ${JSON.stringify(currentWeekNutrients)}
      `;
  }
}

export class RetrievePatientData extends Tool {
  name = "retrieve_patient_data";
  description = "Retrieve patient medical summary upon request";

  constructor(private patientId: string) {
    super();
  }
  async _call() {
    console.log(
      "patient data retrieval called with patientId:",
      this.patientId
    );
    const patientSummary = await createSummaryToAnalyze(this.patientId, 3);
    console.log(patientSummary);

    return `Here's the patient summary to help you making medical decision.
    - Patient Summary: ${JSON.stringify(patientSummary)}
    `;
  }
}
