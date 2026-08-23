import { Tool } from "langchain/tools";
import { getPatientById } from "../../patient/model/patient.model";
import HealthGoalService from "../../healthgoal/model/healthGoals.model";
import moment from "moment";
import { HealthGoal } from "@prisma/client";
import { searchYouTube } from "../../../utility/youtube/get_youtube_videos";
import { workoutStructureString } from "../schemas/ai_agent.schemas";

export class WorkoutPlanGeneratorTool extends Tool {
  name = "workout_plan_generator";
  description =
    "This tool is specifically designed to generate any type of workout (single workout or complete workout plan) tailored to a user's health and fitness profile. It MUST be used whenever a workout-related request is made, such as workout recommendations, training routines, fitness programs, or exercise plans. The plan considers the user's health conditions, fitness goals, and exercise preferences.";

  constructor(private patientId: string) {
    super();
  }

  async _call(youtubeSearchQuery: string) {
    console.log(
      "WorkoutPlanGenerator has been called with patientId:",
      this.patientId
    );

    // Fetch patient data
    const patient = await getPatientById(this.patientId);
    const healthGoals = await HealthGoalService.getInProgressHealthGoals(
      this.patientId
    );
    const fitnessGoal = healthGoals.find(
      (goal: HealthGoal) => goal.category === "WELLNESS"
    );

    if (!patient) {
      console.log("No patient data found for patientId:", this.patientId);
      return "No patient data found.";
    }

    const { nutrition, conditions, exercise } = patient.patientSummary;

    console.log("descriptiomn", youtubeSearchQuery);
    // **Determine Video Duration**
    const duration = youtubeSearchQuery.toLowerCase().includes("under 15 min")
      ? "medium"
      : "long";
    const age = moment().diff(moment(patient.dob), "years");
    // **Fetch YouTube Results**
    const updatedQuery = `${youtubeSearchQuery},${patient.gender}`;

    const youtubeResults = await searchYouTube(updatedQuery, duration);

    // Extract video details into an array
    const videos =
      youtubeResults?.items?.map((video: any) => ({
        title: video.snippet.title,
        videoUrl: `https://www.youtube.com/watch?v=${video.id.videoId}`,
        thumbnail: video.snippet.thumbnails.default.url,
      })) || [];

    // **Generate Workout Plan**

    const workoutPlan = `
    Generate a workout plan with these specifics:${updatedQuery}, tailored taking in consideration the patient's information provided:
      - **Health Conditions**: ${JSON.stringify(conditions)}
      - **Exercise Frequency**: ${JSON.stringify(exercise.frequency)}
      - **Exercise Preferences**: ${JSON.stringify(exercise.preferences)}
      - **Goal**: 
      Use the workout goal specified in the specifics given above , if not specified use this:
      ${fitnessGoal ? JSON.stringify(fitnessGoal.description) : "none"},
   **Recommended YouTube Videos:**
    ${JSON.stringify(videos, null, 2)}
    - The response must be strictly in json following this schema ${workoutStructureString}.
    - ***MAKE SURE TO INCLUDE the fenced code block with json specification and do not include any text other than the json***.
    - ***Append: [toolUsed:workout_plan_generator] for the agent but not in the final response***
    `;

    return {
      workoutPlan,
      videos,
    };
  }
}

export class FitnessFallbackTool extends Tool {
  name = "fallback_response";
  description =
    "Provides a personalized response  to the user query, using the patient data.";

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

    const { conditions, nutrition, exercise } = patient.patientSummary;

    return `Respond to the user query, if needed personalize the response using the patient health and wellness data.
       Patient conditions: ${JSON.stringify(conditions)},
       Patient Nutrition Preferences: ${JSON.stringify(nutrition)} 
       Patient Exercise Frequency: ${JSON.stringify(exercise.frequency)}
       Patient Exercise Preferences: ${JSON.stringify(exercise.preferences)}
       `;
  }
}
