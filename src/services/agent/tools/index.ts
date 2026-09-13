import { ToolRegistry } from "./registry";
import { getPlan, updatePlanTargets } from "./plan.tools";
import { getFavorites, getLoggingGaps, getMeals, getNutritionSummary } from "./nutrition.tools";
import { getActivity } from "./activity.tools";
import { getVitals } from "./vitals.tools";
import { getLabs } from "./labs.tools";
import { getRecords } from "./records.tools";
import { getCareTeam, listSubaccounts } from "./care.tools";
import { forgetMemory, recallMemory, remember } from "./memory.tools";
import { bookAppointment, logMeal, logVital, messageCareTeam } from "./write.tools";
import { buildGroceryList, generateMealPlan, generateRecipe } from "./generation.tools";
import { getWorkouts, logWorkout } from "./workout.tools";
import { suggestMeal } from "./suggest.tools";
import { getMealPlan, saveMealPlan } from "./mealplan.tools";
import { generateWorkout, generateWorkoutPlan, moveWorkout, saveWorkoutPlan, updateTrainingProfile } from "./workoutplan.tools";

/**
 * Everything the agent can do: read tools, memory tools, generation tools
 * (structured-output services, nothing persisted) and confirm-gated write
 * tools (proposal → user confirms in the app → commit). There is deliberately
 * no tool for diagnosis, medication or supplement advice — see prompt/system.ts.
 */
export const registry = new ToolRegistry().register(
  getPlan,
  getMeals,
  getNutritionSummary,
  getLoggingGaps,
  getFavorites,
  getActivity,
  getWorkouts,
  getVitals,
  getLabs,
  getRecords,
  getCareTeam,
  listSubaccounts,
  remember,
  recallMemory,
  forgetMemory,
  suggestMeal,
  generateMealPlan,
  getMealPlan,
  saveMealPlan,
  generateRecipe,
  buildGroceryList,
  logMeal,
  logVital,
  messageCareTeam,
  bookAppointment,
  updatePlanTargets,
  logWorkout,
  generateWorkout,
  generateWorkoutPlan,
  saveWorkoutPlan,
  updateTrainingProfile,
  moveWorkout
);

export { ToolRegistry } from "./registry";
export type { Card, Proposal, ToolContext, ToolOutcome } from "./registry";
