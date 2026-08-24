import { Response } from "express";
import Util from "../../../utils/response";
import PlanService from "../model/plan.model";

const OUTCOMES = ["LOSE_WEIGHT", "RECOMPOSITION", "GENERAL_HEALTH", "FIX_LAB"];
const INTENSITIES = ["GENTLE", "STEADY", "AMBITIOUS"];
const STATUSES = ["ACTIVE", "PAUSED", "COMPLETED", "REPLACED"];

/**
 * Patient identity always comes from the verified token — never from the body.
 */
class PlanHandler {
  async fetchActivePlan(request: any, response: Response) {
    const { id } = request.user;
    try {
      const plan = await PlanService.getActivePlan(id);
      return response.status(200).json(Util.success(plan, "Active plan"));
    } catch (error) {
      console.error("Error fetching active plan", error);
      return response.status(400).json(Util.error({ error }, "Error fetching plan"));
    }
  }

  async proposePlan(request: any, response: Response) {
    const { id } = request.user;
    const { outcome, intensity, labKey, baselines } = request.body ?? {};
    if (!OUTCOMES.includes(outcome) || !INTENSITIES.includes(intensity))
      return response
        .status(400)
        .json(Util.error({}, "outcome and intensity are required"));
    try {
      const proposal = await PlanService.propose(id, {
        outcome,
        intensity,
        labKey: labKey ?? null,
        baselines: baselines ?? {},
      });
      return response.status(200).json(Util.success(proposal, "Plan proposal"));
    } catch (error) {
      console.error("Error proposing plan", error);
      return response.status(400).json(Util.error({ error }, "Error proposing plan"));
    }
  }

  async createPlan(request: any, response: Response) {
    const { id } = request.user;
    const body = request.body ?? {};
    if (!OUTCOMES.includes(body.outcome) || !INTENSITIES.includes(body.intensity))
      return response
        .status(400)
        .json(Util.error({}, "outcome and intensity are required"));
    if (!Array.isArray(body.targets) || body.targets.length === 0)
      return response.status(400).json(Util.error({}, "targets are required"));
    try {
      const plan = await PlanService.createPlan(id, body);
      return response.status(200).json(Util.success(plan, "Plan created"));
    } catch (error) {
      console.error("Error creating plan", error);
      return response.status(400).json(Util.error({ error }, "Error creating plan"));
    }
  }

  async replaceTargets(request: any, response: Response) {
    const { id } = request.user;
    const { planId } = request.params;
    const { targets } = request.body ?? {};
    if (!Array.isArray(targets))
      return response.status(400).json(Util.error({}, "targets array is required"));
    try {
      const plan = await PlanService.replaceTargets(id, planId, targets);
      if (!plan) return response.status(404).json(Util.error({}, "Plan not found"));
      return response.status(200).json(Util.success(plan, "Targets updated"));
    } catch (error) {
      console.error("Error updating targets", error);
      return response.status(400).json(Util.error({ error }, "Error updating targets"));
    }
  }

  async replaceWatchOuts(request: any, response: Response) {
    const { id } = request.user;
    const { planId } = request.params;
    const { watchOuts } = request.body ?? {};
    if (!Array.isArray(watchOuts))
      return response.status(400).json(Util.error({}, "watchOuts array is required"));
    try {
      const plan = await PlanService.replaceWatchOuts(id, planId, watchOuts);
      if (!plan) return response.status(404).json(Util.error({}, "Plan not found"));
      return response.status(200).json(Util.success(plan, "Watch-outs updated"));
    } catch (error) {
      console.error("Error updating watch-outs", error);
      return response.status(400).json(Util.error({ error }, "Error updating watch-outs"));
    }
  }

  async updateStatus(request: any, response: Response) {
    const { id } = request.user;
    const { planId } = request.params;
    const { status } = request.body ?? {};
    if (!STATUSES.includes(status))
      return response.status(400).json(Util.error({}, "valid status is required"));
    try {
      const plan = await PlanService.updateStatus(id, planId, status);
      if (!plan) return response.status(404).json(Util.error({}, "Plan not found"));
      return response.status(200).json(Util.success(plan, "Plan status updated"));
    } catch (error) {
      console.error("Error updating plan status", error);
      return response.status(400).json(Util.error({ error }, "Error updating plan status"));
    }
  }
}

export default new PlanHandler();
