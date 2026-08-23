import { StructuredTool, Tool } from "langchain/tools";
import { z } from "zod";
import { ChatOpenAI } from "@langchain/openai";
import HealthGoalServices from "../../healthgoal/model/healthGoals.model";
import {
  getNutritionOverviewPrompt,
  getWeightAndBFPTrackers,
} from "./patient_data/retrieve_patient_data";

export class HealthGoalAnalysisTool extends StructuredTool {
  name = "health_goal_feedback";
  description =
    "Analyze the patient's nutrition and body metrics to provide goal-oriented insights.";

  constructor(private patientId: string) {
    super();
  }

  /** JSON schema the LLM will see */
  schema = z.object({});

  private llm = new ChatOpenAI({
    modelName: "gpt-4o-mini",
    temperature: 0.4,
    openAIApiKey: process.env.REACT_APP_OPENAI_API_KEY,
  });

  protected async _call(): Promise<string> {
    return this.func();
  }

  async func(): Promise<string> {
    console.log("🩺 HealthGoalAnalysisTool for patient:", this.patientId);

    try {
      const [goals, overview, trackers] = await Promise.all([
        HealthGoalServices.getInProgressHealthGoals(this.patientId),
        getNutritionOverviewPrompt(this.patientId),
        getWeightAndBFPTrackers(this.patientId),
      ]);

      const compactGoals = goals.map((g) => ({
        description: g.description,
        targetValue: g.targetValue,
        startingValue: g.startingValue,
        endDate: g.endDate,
      }));

      const dietitianPrompt = `
You are a **licensed dietitian** specializing in goal-oriented health progress analysis. Your primary task is to evaluate the patient's progress towards their specific health goals using their nutrition and body metrics data.

INPUT_JSON:
${JSON.stringify({
  goals: compactGoals,
  overview,
  weightTracker: trackers.weightTracker,
  bfpTracker: trackers.bfpTracker,
})}

ANALYSIS REQUIREMENTS:
1. Goal Progress Analysis (REQUIRED)
   • Clearly state each health goal
   • Analyze current progress (quantitative when possible)
   • Identify if the trend is positive, negative, or stagnant
   • Connect nutrition/body metrics to goal progress

2. Supporting Data Analysis
   • Weight/BFP trends and their relation to goals
   • Relevant nutrition patterns supporting/hindering goals
   • Key nutrients impacting goal progress

3. Action-Oriented Feedback
   • Specific adjustments needed to improve goal progress
   • Highlight behaviors to maintain if supporting goals
   • Practical next steps prioritized by impact on goals

OUTPUT FORMAT:
• Goal Status Summary (2-3 sentences focusing on progress)
• Progress Evaluation
  - What's Working (max 2 points)
  - Areas Needing Attention (max 2 points)
• Strategic Recommendations (3 specific, goal-aligned actions)
• Motivational Closing (tied to goal progress)
• Append toolUsed:${this.name}

TONE: Professional, evidence-based, but encouraging. Focus on progress over perfection.
`;

      const { content } = await this.llm.invoke([
        {
          role: "system",
          content: "You are a helpful, evidence-based dietitian.",
        },
        { role: "user", content: dietitianPrompt },
      ]);

      return (
        (typeof content === "string" ? content : JSON.stringify(content)) ||
        "⚠️ No feedback could be generated."
      );
    } catch (err) {
      console.error("❌ HealthGoalAnalysisTool error:", err);
      return "⚠️ Sorry, I couldn't analyse those health goals.";
    }
  }
}

// export class HealthGoalAnalysisTool extends Tool {
//   name = "health_goal_feedback";
//   description =
//     "Analyze the patient's nutrition and body metrics to provide goal-oriented insights.";

//   constructor(private patientId: string) {
//     super();
//   }

//   private llm = new ChatOpenAI({
//     modelName: "gpt-4o-mini",
//     temperature: 0.4,
//     openAIApiKey: process.env.REACT_APP_OPENAI_API_KEY,
//   });

//   async _call(): Promise<string> {
//     console.log("🩺 HealthGoalAnalysisTool for patient:", this.patientId);

//     try {
//       const [goals, overview, trackers] = await Promise.all([
//         HealthGoalServices.getInProgressHealthGoals(this.patientId),
//         getNutritionOverviewPrompt(this.patientId),
//         getWeightAndBFPTrackers(this.patientId),
//       ]);

//       const compactGoals = goals.map((g) => ({
//         description: g.description,
//         targetValue: g.targetValue,
//         startingValue: g.startingValue,
//         endDate: g.endDate,
//       }));

//       const dietitianPrompt = `
// You are a **licensed dietitian** specializing in goal-oriented health progress analysis. Your primary task is to evaluate the patient's progress towards their specific health goals using their nutrition and body metrics data.

// INPUT_JSON:
// ${JSON.stringify({
//   goals: compactGoals,
//   overview,
//   weightTracker: trackers.weightTracker,
//   bfpTracker: trackers.bfpTracker,
// })}

// ANALYSIS REQUIREMENTS:
// 1. Goal Progress Analysis (REQUIRED)
//    • Clearly state each health goal
//    • Analyze current progress (quantitative when possible)
//    • Identify if the trend is positive, negative, or stagnant
//    • Connect nutrition/body metrics to goal progress

// 2. Supporting Data Analysis
//    • Weight/BFP trends and their relation to goals
//    • Relevant nutrition patterns supporting/hindering goals
//    • Key nutrients impacting goal progress

// 3. Action-Oriented Feedback
//    • Specific adjustments needed to improve goal progress
//    • Highlight behaviors to maintain if supporting goals
//    • Practical next steps prioritized by impact on goals

// OUTPUT FORMAT:
// • Goal Status Summary (2-3 sentences focusing on progress)
// • Progress Evaluation
//   - What's Working (max 2 points)
//   - Areas Needing Attention (max 2 points)
// • Strategic Recommendations (3 specific, goal-aligned actions)
// • Motivational Closing (tied to goal progress)
// • Append toolUsed:${this.name}

// TONE: Professional, evidence-based, but encouraging. Focus on progress over perfection.
// `;

//       const { content } = await this.llm.invoke([
//         {
//           role: "system",
//           content: "You are a helpful, evidence-based dietitian.",
//         },
//         { role: "user", content: dietitianPrompt },
//       ]);

//       return (
//         (typeof content === "string" ? content : JSON.stringify(content)) ||
//         "⚠️ No feedback could be generated."
//       );
//     } catch (err) {
//       console.error("❌ HealthGoalAnalysisTool error:", err);
//       return "⚠️ Sorry, I couldn't analyse those health goals.";
//     }
//   }
// }
