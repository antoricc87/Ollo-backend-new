import moment from "moment";
import OpenAI from "openai";
import prisma from "../../../utility/prismaClient";
import { getCurrentWeekRange } from "../../../utils/formatDate";
import CaloriesService from "../../calories_tracker/model/calories.model";
import ExercisesService from "../../exercises_tracker/model/exercises.model";
import TrackableMetricMetricService from "../../metric/model/trackableMetrics.model";
import NutrientsService from "../../nutrition/model/nutrition.model";
import { getPatientById } from "../../patient/model/patient.model";
import {
  CaloricNeed,
  HealthGoalCategories,
  HealthGoalSchema,
  patientHealthReportSchema,
  ValueEnum,
  healthGoalsTool,
  caloricNeedTool,
  patientHealthReportTool,
} from "../schemas/healthGoals.schemas";
const { start, end } = getCurrentWeekRange();

const apiKey = process.env.REACT_APP_OPENAI_API_KEY;
const openai = new OpenAI({
  apiKey: apiKey || "",
});

class HealthGoalService {
  //get health goal by id
  async getHealthGoalById(id: string, date: string) {
    try {
      const trimmedDate = date.trim();

      // Validate the date string
      const dateObject = new Date(trimmedDate);
      if (isNaN(dateObject.getTime())) {
        throw new RangeError("Invalid time value");
      }

      // Set the start and end of the day
      const startOfDay = new Date(dateObject);
      startOfDay.setUTCHours(0, 0, 0, 0);

      const endOfDay = new Date(dateObject);
      endOfDay.setUTCHours(23, 59, 59, 999);
      return await prisma.healthGoal.findUnique({
        where: { id: id },
        include: {
          trackableMetrics: {
            include: {
              metricEntries: {
                where: {
                  entryDate: {
                    gte: startOfDay.toISOString(),
                    lte: endOfDay.toISOString(),
                  },
                },
              },
            },
          },
        },
      });
    } catch (error: unknown) {
      console.error("Error fetching the health goal");
      throw error;
    }
  }

  // Get health goals by visitId or patientId
  async getHealthGoals(where: any) {
    try {
      return await prisma.healthGoal.findMany({
        where: where,
        include: {
          trackableMetrics: {
            include: { metricEntries: true },
          },
          // Optionally include the patient or other relations if needed
        },
      });
    } catch (error: any) {
      console.error("Something went wrong fetching the health goals", error);
      throw error;
    }
  }

  //get in progress healthgoal
  async getInProgressHealthGoals(patientId: string) {
    return await prisma.healthGoal.findMany({
      where: {
        patientId,
        NOT: {
          status: {
            in: ["ACHIEVED", "NOT_ACHIEVED", "PENDING"],
          },
        },
      },
      include: {
        trackableMetrics: true,
      },
    });
  }

  // Create a health goal
  async createHealthGoal(data: any) {
    try {
      return await prisma.healthGoal.create({
        data: {
          patientId: data.patientId,
          visitId: data.visitId,
          description: data.description,
          status: data.status,
          reviewDate: data.reviewDate,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    } catch (error: any) {
      console.error("Error creating the health goal", error);
      throw error;
    }
  }
  //create healthgoal and metrics
  async createHealthGoalWithMetrics(healthGoalData: any, data: any) {
    console.log(data);
    try {
      if (healthGoalData.category === "WELLNESS") {
        await prisma.healthGoal.updateMany({
          where: {
            patientId: data.patientId,
            category: "WELLNESS",
            status: "IN_PROGRESS",
          },
          data: {
            status: "NOT_ACHIEVED",
          },
        });
      }

      const healthGoal = await prisma.healthGoal.create({
        data: {
          patientId: data.patientId,
          category: healthGoalData.category,
          targetValue: healthGoalData.targetValue,
          startingValue: healthGoalData.startingValue,
          endDate: healthGoalData.endDate,
          // visitId: data.visitId,
          description: healthGoalData.description,
          status: data.status,
          reviewDate: data.reviewDate,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      if (healthGoal) {
        for (const metric of healthGoalData.metrics) {
          const metricData = {
            healthGoalId: healthGoal.id,
            description: metric.description,
            targetValue: metric.targetValue,
            currentValue: metric.currentValue,
            unit: metric.unit,
            value: metric.value,
            category: metric.category,
            frequency: metric.frequency,
            reviewDate: metric.reviewDate,
            patientId: data.patientId,
          };
          await TrackableMetricMetricService.createTrackableMetric(metricData);
        }
      }
    } catch (error: any) {
      console.error("Error creating the health goal", error);
      throw error;
    }
  }

  // Update a health goal
  async updateHealthGoal(id: string, data: any) {
    try {
      return await prisma.healthGoal.update({
        where: { id: id },
        data: {
          description: data.description,
          status: data.status,
          reviewDate: data.reviewDate,
          patientId: data.patientId, // Allow updating patientId if needed
          updatedAt: new Date(),
        },
      });
    } catch (error: any) {
      console.error("Error updating the health goal", error);
      throw error;
    }
  }

  // Delete a health goal
  async deleteHealthGoal(id: string) {
    try {
      return await prisma.healthGoal.delete({
        where: { id: id },
      });
    } catch (error: any) {
      console.error("Error deleting the health goal", error);
      throw error;
    }
  }

  //generate health goal from mobile app
  async mobileGenerateHealthGoals(patientSummary: string, goals: string[]) {
    const valueEnumList = ValueEnum.options.join(", ");
    const healthGoalCategory = HealthGoalCategories.options.join(", ");
    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are an AI assistant tasked with generating structured health goals. Respond strictly in JSON format adhering to the provided schema for health goals and trackable metrics.`,
          },
          {
            role: "user",
            content: `
            Based on the following patient summary and their goals, generate multiple health goals:
            Patient summary:
            ${patientSummary}
            Patient Goals:
            ${goals}

            Please provide:
            - Health goals having no more than 3 trackable metrics each.
            - The value field should use only values from this enum list: ${valueEnumList}.
            - Each metric should include:
              - description
              - target value
              - value (1 or 2 words summarizing the description)
              - category (DIET, EXERCISE, MEDICATION, MONITORING, LIFESTYLE, SUPPLEMENTS) in uppercase
              - frequency (always daily)
            - Out of the 3 metrics:
              - At least 2 must have DIET as the category.
              - At least 1 must have EXERCISE as the category.

            Example of a health goal: "Lose body weight."
            Example of a trackable metric: "Limit daily carbohydrate intake to 150g, target value <150, unit g, category DIET, value carbohydrates, frequency daily."

            Provide separate lists for foods to avoid and foods to increase.
            `,
          },
        ],
        tools: [healthGoalsTool],
        tool_choice: {
          type: "function",
          function: { name: "generateHealthGoals" },
        },
      });

      const toolCall = completion.choices[0].message.tool_calls?.[0];
      if (!toolCall) {
        throw new Error("No structured output returned");
      }

      const healthGoals = JSON.parse(toolCall.function.arguments);

      return healthGoals;
    } catch (error: unknown) {
      console.error("Error generating health goals:", error);
      throw error;
    }
  }
  //main health goal generation
  async generateMainHealthGoal(patientId: string) {
    const patient = await getPatientById(patientId);
    const patientSummary = JSON.stringify(patient.patientSummary);
    const valueEnumList = ValueEnum.options.join(", ");
    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are an AI assistant tasked with generating structured health goals. Respond strictly in JSON format adhering to the provided schema for health goals and trackable metrics.`,
          },
          {
            role: "user",
            content: `
            Based on the following patient summary, generate a main health goal:
            Patient summary:
            ${patientSummary}
            
            Please follow this instructions:
            - The health goals should have as many trackable metrics as needed.
            - The value field should use only values from this enum list: ${valueEnumList}.
            - Each trackable metric must take in consideration the patient health status and conditions.
            - Each metric should include:
              - description
              - target value
              - value (1 or 2 words summarizing the description)
              - category (DIET, EXERCISE, MEDICATION, MONITORING, LIFESTYLE, SUPPLEMENTS) in uppercase
              - frequency (always daily)
            - Metrics should include:
              - Nutrition based metrics, having DIET as the category.
              - Exercise based metrics, having EXERCISE as the category.
              - Compliance based metrics (if the patient is taking medications), having MEDICATION as the category.
              - Monitoring based metrics (if the patient has any conditions like diabete or hypertension), having MONITORING as the catgeory.
            Example of a health goal: "Monitor your conditions."

            Example of a trackable metric for diabetic patient: "Limit daily sugar intake to 40g, target value <40, unit g, category DIET, value sugar, frequency daily."
            Example of a trackable metric for patient with hypertension: "Limit daily sodium intake to 1500mg, target value <1500, unit mg, category DIET, value sodium, frequency daily."
            Example of a generic trackable metric: "Limit daily carbohydrate intake to 150g, target value <150, unit g, category DIET, value carbohydrates, frequency daily."

            Provide separate lists for foods to avoid and foods to increase.
            `,
          },
        ],
        tools: [healthGoalsTool],
        tool_choice: {
          type: "function",
          function: { name: "generateHealthGoals" },
        },
      });

      const toolCall = completion.choices[0].message.tool_calls?.[0];
      if (!toolCall) {
        throw new Error("No structured output returned");
      }

      const healthGoals = JSON.parse(toolCall.function.arguments);

      return healthGoals;
    } catch (error: unknown) {
      console.error("Error generating health goals:", error);
      throw error;
    }
  }

  //calculate total amount of calories needed based on weight,height and exercises
  async generateTrackableHealthGoals(
    patientId: string,
    goals: string[],
    targetValue: string,
    startingValue: string,
    endDate?: Date
  ) {
    const patient = await getPatientById(patientId);
    const patientSummary = patient.patientSummary;

    const nutrientsTracker = await prisma.macroNutrientsTracker.findUnique({
      where: { userId: patientId },
    });
    const valueEnumList = ValueEnum.options.join(", ");

    const hasHealthCondition = patientSummary.conditions?.length > 0;

    const abnormalLabs =
      patientSummary.labResults && patientSummary.labResults.length > 0
        ? patientSummary.labResults[0].labResults.filter(
            (lab) => lab.isOutOfRange
          )
        : [];

    const medications = patientSummary.medications.map(
      (m) => `${m.medication.name}-${m.medication.dosage}`
    );

    // Construct a detailed conditions list

    // Dynamically construct the prompt based on the patient's conditions
    let conditionGoalPrompt = "";
    const conditions: string[] = [];
    const abnormalLabsFound: string[] = [];
    if (hasHealthCondition || abnormalLabs?.length > 0) {
      patientSummary.conditions.forEach((condition) =>
        conditions.push(condition.condition.name)
      );

      patientSummary.labResults &&
        patientSummary.labResults.length > 0 &&
        patientSummary.labResults[0].labResults.forEach((labResult) => {
          if (labResult.isOutOfRange) {
            const value = `${labResult.testType} ${labResult.result} ${labResult.units}`;
            abnormalLabsFound.push(value);
          }
        });

      const conditionList = hasHealthCondition
        ? `The patient has the following chronic conditions: ${conditions}.`
        : "";

      // Construct a detailed abnormal lab values list
      const abnormalLabList = abnormalLabs?.length
        ? `The following lab values are out of range: ${abnormalLabs}.`
        : "";

      conditionGoalPrompt = `
      - Generate a second health goal with this description:**"Chronic conditions and abnormal values"**
        that includes only **micronutrient-based** trackable metrics related to the patient's conditions
        or abnormal lab values.
      - Ensure the description of this health goal is **"Chronic conditions and abnormal values"**.
      - Ensure to **do not include** targetValue and startingValue in this goal.
      - Ensure this goal **only includes nutrients directly related to the condition**
        (e.g., limit sodium for hypertension, limit added sugar for diabetes, increase fiber for heart health).
      - The patient-specific details:
        - ${JSON.stringify(conditionList)}
        - ${JSON.stringify(abnormalLabList)}
      - **Do not include this goal if the patient has no conditions or abnormal lab values.**
      `;
    }
    try {
      const systemMessage = `
            You are an expert dietician.
            Based on the following patient data generate health goals.:
              - Chronic conditions:${conditions}
              - Abnormal Labs:${abnormalLabsFound}
              - Medications:${medications}
            **Generate Main Goal:**  "${goals[0]}".
            - For goals such as "lose fat," "lose amount of weight," or "body recomposition," create:
              - Three **macro-nutrient trackable metrics** (carbs, protein, fat) using data from the nutrient tracker: ${JSON.stringify(
                nutrientsTracker
              )}.
              - Three **exercise metrics** related to workouts that can be tracked with an Apple Watch 
                (e.g., cardio for weight loss, strength training for muscle gain).

            ${conditionGoalPrompt}
            - Ensure each health goal has:
            - A category ("HEALTH" for conditions, "WELLNESS" for body-related goals).
            - A default **endDate of 6 months** unless otherwise specified.
            - For WELLNESs goal(e.g. Lose num Kg)goal use the provided starting and target value and  endDate:
            - startingValue:${startingValue}
            - targetValue:${targetValue}
            endDate:${endDate.toString()}
            - For HEALTH goal (e.g. Chronic conditions and abnormal values) generate appropriate target and starting values or leave them empty.
            - For HEALTH goal as endDate use 6 months from now
            - ***Trackable Metrics***
            - Each trackable metric must include:
            - description
            - target value (for both wellness and health goals)
            - unit (for exercise, unless for general exercise minutes always use sessions)
            - category (DIET, EXERCISE, MEDICATION, MONITORING, LIFESTYLE, SUPPLEMENTS)
            - frequency (daily for nutrition metrics, weekly for exercise metrics)
            - value (use only values from the following enum list): ${valueEnumList}.
            
            - Ensure that metrics related to exercise always have the description as :"[num of session] sessions of [category]" and targetValue as :"[num of session]"
            
            - Ensure **metrics reflect actions to achieve the goal**, not monitoring the outcome 
              (e.g., a weight loss goal should track nutrition and exercise, not weight changes).

            Example of a main health goal: "Lose 5Kg" (Category: WELLNESS)
            Example of a trackable metric: "Carbs intake [value]g" (Category: DIET, frequency:daily)
            Example of a trackable metric: "2 Sessions of cardio" (Category: EXERCISE, frequency:weekly)
            **Only generate the "chronic conditions and abnormal values" goal if the patient has conditions or abnormal lab values.**
            `;
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: systemMessage,
          },
        ],
        tools: [healthGoalsTool],
        tool_choice: {
          type: "function",
          function: { name: "generateHealthGoals" },
        },
      });

      const toolCall = completion.choices[0].message.tool_calls?.[0];
      if (!toolCall) {
        throw new Error("No structured output returned");
      }

      const healthGoals = JSON.parse(toolCall.function.arguments);

      return healthGoals;
    } catch (error: unknown) {
      console.error("Error generating health goals:", error);
      throw error;
    }
  }
  async generateTrackableWellnessGoal(
    patientId: string,
    goals: string[],
    targetValue: string,
    startingValue: string,
    endDate?: Date
  ) {
    const patient = await getPatientById(patientId);
    const patientSummary = patient.patientSummary;

    const nutrientsTracker = await prisma.macroNutrientsTracker.findUnique({
      where: { userId: patientId },
    });
    const valueEnumList = ValueEnum.options.join(", ");

    const hasHealthCondition = patientSummary.conditions?.length > 0;

    const abnormalLabs =
      patientSummary.labResults && patientSummary.labResults.length > 0
        ? patientSummary.labResults[0].labResults.filter(
            (lab) => lab.isOutOfRange
          )
        : [];

    const medications = patientSummary.medications.map(
      (m) => `${m.medication.name}-${m.medication.dosage}`
    );

    // Construct a detailed conditions list

    // Dynamically construct the prompt based on the patient's conditions
    const conditions: string[] = [];
    const abnormalLabsFound: string[] = [];
    if (hasHealthCondition || abnormalLabs?.length > 0) {
      patientSummary.conditions.forEach((condition) =>
        conditions.push(condition.condition.name)
      );

      patientSummary.labResults &&
        patientSummary.labResults.length > 0 &&
        patientSummary.labResults[0].labResults.forEach((labResult) => {
          if (labResult.isOutOfRange) {
            const value = `${labResult.testType} ${labResult.result} ${labResult.units}`;
            abnormalLabsFound.push(value);
          }
        });

      const conditionList = hasHealthCondition
        ? `The patient has the following chronic conditions: ${conditions}.`
        : "";

      // Construct a detailed abnormal lab values list
      const abnormalLabList = abnormalLabs?.length
        ? `The following lab values are out of range: ${abnormalLabs}.`
        : "";
    }
    try {
      const systemMessage = `
            You are an expert dietician.
            Based on the following patient data generate a wellness health goal:
              - Chronic conditions:${conditions}
              - Abnormal Labs:${abnormalLabsFound}
              - Medications:${medications}
            **Generate Main Goal:**  "${goals[0]}".
            - For goals such as "lose fat," "lose amount of weight," or "body recomposition," create:
              - Three **macro-nutrient trackable metrics** (carbs, protein, fat) using data from the nutrient tracker: ${JSON.stringify(
                nutrientsTracker
              )}.
              - Three **exercise metrics** related to workouts that can be tracked with an Apple Watch 
                (e.g., cardio for weight loss, strength training for muscle gain).

           
            - Ensure the health goal has:
            - A category ("WELLNESS").
            - A default **endDate of 6 months** unless otherwise specified.
            - For WELLNESs goal(e.g. Lose num Kg)goal use the provided starting and target value and  endDate:
            - startingValue:${startingValue}
            - targetValue:${targetValue}
            endDate:${endDate.toString()}
            - ***Trackable Metrics***
            - Each trackable metric must include:
            - description
            - target value 
            - unit (for exercise, unless for general exercise minutes always use sessions)
            - category (DIET, EXERCISE, MEDICATION, MONITORING, LIFESTYLE, SUPPLEMENTS)
            - frequency (daily for nutrition metrics, weekly for exercise metrics)
            - value (use only values from the following enum list): ${valueEnumList}.
            
            - Ensure that metrics related to exercise always have the description as :"[num of session] sessions of [category]" and targetValue as :"[num of session]"
            
            - Ensure **metrics reflect actions to achieve the goal**, not monitoring the outcome 
              (e.g., a weight loss goal should track nutrition and exercise, not weight changes).

            Example of a main health goal: "Lose 5Kg" (Category: WELLNESS)
            Example of a trackable metric: "Carbs intake [value]g" (Category: DIET, frequency:daily)
            Example of a trackable metric: "2 Sessions of cardio" (Category: EXERCISE, frequency:weekly)
            `;
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: systemMessage,
          },
        ],
        tools: [healthGoalsTool],
        tool_choice: {
          type: "function",
          function: { name: "generateHealthGoals" },
        },
      });

      const toolCall = completion.choices[0].message.tool_calls?.[0];
      if (!toolCall) {
        throw new Error("No structured output returned");
      }

      const healthGoals = JSON.parse(toolCall.function.arguments);

      return healthGoals;
    } catch (error: unknown) {
      console.error("Error generating health goals:", error);
      throw error;
    }
  }

  async calculateCaloricAmount(patientData: string) {
    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are an AI assistant tasked with calculating the daily caloric needs of a patient based on their specific information. Please provide only the numerical value of the required calories, excluding any additional details.",
          },
          {
            role: "user",
            content: `
            Calculate the total daily caloric needs for the patient based on the provided patient data. Please limit the response to the numerical value of the calories required.
            Patient data:
            ${patientData}
            `,
          },
        ],
        tools: [caloricNeedTool],
        tool_choice: {
          type: "function",
          function: { name: "calculateCaloricNeed" },
        },
      });

      const toolCall = completion.choices[0].message.tool_calls?.[0];
      if (!toolCall) {
        throw new Error("No structured output returned");
      }

      const caloricAmount = JSON.parse(toolCall.function.arguments);
      return caloricAmount;
    } catch (error: unknown) {
      console.error("Error generating ammount", error);
      throw error;
    }
  }

  //generate medical report based on health goals,calories, exercises and macronutrients
  async createSummaryToAnalyze(patientId: string, timeFrame: number) {
    try {
      const whereId = { userId: patientId };
      const patient = await getPatientById(patientId);
      const exercisesTracker = await ExercisesService.getWeeklyExercisesTracker(
        whereId
      );
      const caloriesTracker = await CaloriesService.getCaloriesTracker(whereId);
      const nutrientsTracker = await NutrientsService.getNutrientsTracker(
        whereId
      );
      const summary = {
        minutesExercising: 0,
        totalCaloriesIntake: 0,
        totalCaloriesBurned: 0,
        macroNutrients: {},
        patientConditions: patient.patientSummary.conditions,
        healthGoals: [],
      };
      const weeksInMonth = timeFrame;
      let totalMinutesExercising = 0;
      let totalCaloriesIntake = 0;
      let totalCaloriesBurned = 0;
      let totalCarbohydrates = 0;
      let totalProteins = 0;
      let totalFats = 0;
      let totalFiber = 0;
      let totalSodium = 0;
      let totalNaturalSugar = 0;
      let totalAddedSugar = 0;
      let totalCalcium = 0;
      let totalMagnesium = 0;
      // Calculate averages considering missing values
      const weeksCountExercises =
        exercisesTracker && exercisesTracker.weeklyEntries.length > 0
          ? Math.min(weeksInMonth, exercisesTracker.weeklyEntries.length)
          : 0;
      const weeksCountCalories =
        caloriesTracker && caloriesTracker.weeklyEntries.length > 0
          ? Math.min(weeksInMonth, caloriesTracker.weeklyEntries.length)
          : 0;
      const weeksCountNutrients =
        nutrientsTracker && nutrientsTracker.weeklyEntries.length > 0
          ? Math.min(weeksInMonth, nutrientsTracker.weeklyEntries.length)
          : 0;

      exercisesTracker.weeklyEntries
        .slice(0, weeksCountExercises)
        .forEach((entry) => {
          totalMinutesExercising += entry.minutesOfExercise;
        });

      caloriesTracker.weeklyEntries
        .slice(0, weeksCountCalories)
        .forEach((entry) => {
          totalCaloriesIntake += entry.totalIntake;
          totalCaloriesBurned += entry.totalBurned;
        });

      nutrientsTracker.weeklyEntries
        .slice(0, weeksCountNutrients)
        .forEach((entry) => {
          totalCarbohydrates += entry.carbohydrates || 0;
          totalProteins += entry.proteins || 0;
          totalFats += entry.fats || 0;
          totalFiber += entry.fiber || 0;
          totalSodium += entry.sodium || 0;
          totalNaturalSugar += entry.naturalSugar || 0;
          totalAddedSugar += entry.addedSugar || 0;
          totalCalcium += entry.calcium || 0;
          totalMagnesium += entry.magnesium || 0;
        });

      const averageMinutesExercising =
        weeksCountExercises > 0
          ? totalMinutesExercising / weeksCountExercises
          : 0;
      const averageCaloriesIntake =
        weeksCountCalories > 0 ? totalCaloriesIntake / weeksCountCalories : 0;
      const averageCaloriesBurned =
        weeksCountCalories > 0 ? totalCaloriesBurned / weeksCountCalories : 0;
      const averageCarbohydrates =
        weeksCountNutrients > 0 ? totalCarbohydrates / weeksCountNutrients : 0;
      const averageProteins =
        weeksCountNutrients > 0 ? totalProteins / weeksCountNutrients : 0;
      const averageFats =
        weeksCountNutrients > 0 ? totalFats / weeksCountNutrients : 0;
      const averageFiber =
        weeksCountNutrients > 0 ? totalFiber / weeksCountNutrients : 0;
      const averageSodium =
        weeksCountNutrients > 0 ? totalSodium / weeksCountNutrients : 0;
      const averageNaturalSugar =
        weeksCountNutrients > 0 ? totalNaturalSugar / weeksCountNutrients : 0;
      const averageAddedSugar =
        weeksCountNutrients > 0 ? totalAddedSugar / weeksCountNutrients : 0;
      const averageCalcium =
        weeksCountNutrients > 0 ? totalCalcium / weeksCountNutrients : 0;
      const averageMagnesium =
        weeksCountNutrients > 0 ? totalMagnesium / weeksCountNutrients : 0;
      // fetching healthGoals
      const healthGoals = await this.getInProgressHealthGoals(
        patientId
        // moment().format("YYYY-MM-DDTHH:mm:ss.SSSZ")
      );
      let refinedHealthGoals = [];
      healthGoals.forEach((goal) => {
        const reducedGoal = {
          description: goal.description,
          metricEntries: [],
        };
        goal.trackableMetrics.forEach((metric) => {
          const trackableMetric = {
            description: metric.description,
            targetValue: metric.targetValue,
          };
          reducedGoal.metricEntries.push(trackableMetric);
        });
        refinedHealthGoals.push(reducedGoal);
      });
      // Update summary with calculated averages
      summary.minutesExercising = averageMinutesExercising;
      summary.totalCaloriesIntake = averageCaloriesIntake;
      summary.totalCaloriesBurned = averageCaloriesBurned;
      summary.macroNutrients = {
        carbohydrates: averageCarbohydrates,
        proteins: averageProteins,
        fats: averageFats,
        fiber: averageFiber,
        sodium: averageSodium,
        naturalSugar: averageNaturalSugar,
        addedSugar: averageAddedSugar,
        calcium: averageCalcium,
        magnesium: averageMagnesium,
      };
      summary.healthGoals = refinedHealthGoals;
      return summary;
    } catch (error: unknown) {
      console.error("Error creating the summary", error);
      throw error;
    }
  }

  async generateMonthlyMedicalReport(patientId: string) {
    try {
      const summary = await this.createSummaryToAnalyze(patientId, 4);
      if (summary) {
        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content:
                "You are an AI medical assistant tasked with generating a detailed medical report (includes only the outcome as a note and not all the values). The report should provide insights into the patient's current health status, progress towards health goals, and recommendations for future actions. Respond strictly in JSON format adhering to the provided schema.",
            },
            {
              role: "user",
              content: `
                Analyze the following patient summary, which includes average monthly data for exercises, caloric intake, and macronutrients, as well as current health goals. Generate a comprehensive report for the doctor that includes:
                - An overview of the patient's current health status.
                - Progress assessment towards each health goal.
                - Analysis of exercise habits and caloric balance.
                - Nutritional analysis based on macronutrient intake.
                - Recommendations for adjustments in diet, exercise, or lifestyle to improve health outcomes.
                - Any potential health risks or concerns based on the data.

                Patient summary:
                ${JSON.stringify(summary, null, 2)}
              `,
            },
          ],
          tools: [patientHealthReportTool],
          tool_choice: {
            type: "function",
            function: { name: "generatePatientHealthReport" },
          },
        });

        const toolCall = completion.choices[0].message.tool_calls?.[0];
        if (!toolCall) {
          throw new Error("No structured output returned");
        }

        const report = JSON.parse(toolCall.function.arguments);
        return report;
      }
    } catch (error: unknown) {
      console.error("Error generating the report");
      throw error;
    }
  }
}

export default new HealthGoalService();
