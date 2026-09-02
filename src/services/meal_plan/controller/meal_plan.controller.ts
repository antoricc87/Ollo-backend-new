import { Response } from "express";
import Util from "../../../utils/response";
import MealPlanService, { MEAL_TYPES, normalizeMealPlanInput } from "../model/meal_plan.model";

const STATUSES = ["ACTIVE", "PAUSED", "COMPLETED", "REPLACED"] as const;

/** Patient identity always from the verified token — never from the body. */
class MealPlanHandler {
  async fetchActive(request: any, response: Response) {
    const { id } = request.user;
    try {
      const plan = await MealPlanService.getActive(id);
      return response.status(200).json(Util.success(plan, "Active meal plan"));
    } catch (error) {
      console.error("Error fetching meal plan", error);
      return response.status(400).json(Util.error({ error }, "Error fetching meal plan"));
    }
  }

  async create(request: any, response: Response) {
    const { id } = request.user;
    let input;
    try {
      input = normalizeMealPlanInput(request.body ?? {});
    } catch (e: any) {
      return response.status(400).json(Util.error({}, e?.message ?? "Invalid meal plan"));
    }
    try {
      const plan = await MealPlanService.create(id, input);
      return response.status(200).json(Util.success(plan, "Meal plan saved"));
    } catch (error) {
      console.error("Error saving meal plan", error);
      return response.status(400).json(Util.error({ error }, "Error saving meal plan"));
    }
  }

  async replaceMeal(request: any, response: Response) {
    const { id } = request.user;
    const { planId, mealId } = request.params;
    const b = request.body ?? {};
    const name = String(b.name ?? "").trim();
    if (!name) return response.status(400).json(Util.error({}, "name is required"));
    const mealType = b.mealType ? String(b.mealType).toUpperCase() : undefined;
    if (mealType && !(MEAL_TYPES as readonly string[]).includes(mealType)) return response.status(400).json(Util.error({}, "unknown mealType"));
    try {
      const plan = await MealPlanService.replaceMeal(id, planId, mealId, {
        name: name.slice(0, 160),
        description: b.description ? String(b.description).slice(0, 400) : null,
        ingredients: (Array.isArray(b.ingredients) ? b.ingredients : []).map((x: unknown) => String(x).trim()).filter(Boolean).slice(0, 30),
        calories: Number(b.calories) || 0,
        proteins: Number(b.proteins ?? b.protein_g) || 0,
        carbohydrates: Number(b.carbohydrates ?? b.carbs_g) || 0,
        fats: Number(b.fats ?? b.fat_g) || 0,
        prepMinutes: b.prepMinutes != null ? Number(b.prepMinutes) || null : null,
        mealType: mealType as any,
      });
      if (!plan) return response.status(404).json(Util.error({}, "Meal not found"));
      return response.status(200).json(Util.success(plan, "Meal replaced"));
    } catch (error) {
      console.error("Error replacing meal", error);
      return response.status(400).json(Util.error({ error }, "Error replacing meal"));
    }
  }

  async updateStatus(request: any, response: Response) {
    const { id } = request.user;
    const { planId } = request.params;
    const { status } = request.body ?? {};
    if (!STATUSES.includes(status)) return response.status(400).json(Util.error({}, "valid status is required"));
    try {
      const plan = await MealPlanService.updateStatus(id, planId, status);
      if (!plan) return response.status(404).json(Util.error({}, "Plan not found"));
      return response.status(200).json(Util.success(plan, "Meal plan status updated"));
    } catch (error) {
      console.error("Error updating meal plan status", error);
      return response.status(400).json(Util.error({ error }, "Error updating meal plan status"));
    }
  }
}

export default new MealPlanHandler();
