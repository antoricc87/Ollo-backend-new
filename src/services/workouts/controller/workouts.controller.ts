import { Response } from "express";
import Util from "../../../utils/response";
import WorkoutService, { type StatusFilter } from "../model/workouts.model";
import WorkoutPlanService from "../model/plan.model";
import TrainingProfileService from "../model/training_profile.model";
import { PlannedSessionInput, SessionInput, SyncRequest, TrainingProfileInput, WorkoutPlanInput } from "../domain/workout.schema";

const STATUSES: StatusFilter[] = ["COMPLETED", "PLANNED", "ALL"];
const PLAN_STATUSES = ["ACTIVE", "PAUSED", "COMPLETED", "REPLACED"] as const;

const bad = (response: Response, issues: unknown, msg: string) => response.status(400).json(Util.error({ issues }, msg));

/** Patient identity always from the verified token. */
class WorkoutHandler {
  async list(request: any, response: Response) {
    const { id } = request.user;
    const from = new Date(String(request.query?.from ?? ""));
    const to = new Date(String(request.query?.to ?? ""));
    if (isNaN(from.getTime()) || isNaN(to.getTime())) return response.status(400).json(Util.error({}, "from and to (ISO) are required"));
    const status = String(request.query?.status ?? "completed").toUpperCase() as StatusFilter;
    if (!STATUSES.includes(status)) return response.status(400).json(Util.error({}, "status must be completed | planned | all"));
    try {
      const sessions = await WorkoutService.list(id, { from, to }, { status });
      return response.status(200).json(Util.success(sessions, "Workout sessions"));
    } catch (error) {
      console.error("Error listing workouts", error);
      return response.status(400).json(Util.error({ error }, "Error listing workouts"));
    }
  }

  async get(request: any, response: Response) {
    const { id } = request.user;
    try {
      const session = await WorkoutService.get(id, request.params.sessionId);
      if (!session) return response.status(404).json(Util.error({}, "Not found"));
      return response.status(200).json(Util.success(session, "Workout session"));
    } catch (error) {
      console.error("Error fetching workout", error);
      return response.status(400).json(Util.error({ error }, "Error fetching workout"));
    }
  }

  async sync(request: any, response: Response) {
    const { id } = request.user;
    const parsed = SyncRequest.safeParse(request.body);
    if (!parsed.success) return bad(response, parsed.error.issues.slice(0, 5), "Invalid sync payload");
    try {
      const result = await WorkoutService.syncFromHealthKit(id, parsed.data);
      return response.status(200).json(Util.success(result, "Synced"));
    } catch (error) {
      console.error("Error syncing workouts", error);
      return response.status(400).json(Util.error({ error }, "Error syncing workouts"));
    }
  }

  async remove(request: any, response: Response) {
    const { id } = request.user;
    try {
      const ok = await WorkoutService.softDelete(id, request.params.sessionId);
      if (!ok) return response.status(404).json(Util.error({}, "Not found"));
      return response.status(200).json(Util.success({ id: request.params.sessionId }, "Deleted"));
    } catch (error) {
      console.error("Error deleting workout", error);
      return response.status(400).json(Util.error({ error }, "Error deleting workout"));
    }
  }

  /** Complete a planned session with what actually happened (manual entry from the app). */
  async complete(request: any, response: Response) {
    const { id } = request.user;
    const parsed = SessionInput.safeParse(request.body);
    if (!parsed.success) return bad(response, parsed.error.issues.slice(0, 5), "Invalid session");
    try {
      const session = await WorkoutService.completeSession(id, request.params.sessionId, parsed.data, "MANUAL");
      if (!session) return response.status(404).json(Util.error({}, "Not found"));
      return response.status(200).json(Util.success(session, "Session completed"));
    } catch (error) {
      console.error("Error completing workout", error);
      return response.status(400).json(Util.error({ error }, "Error completing workout"));
    }
  }

  /** Move a planned session to another day. Body: { plannedFor: YYYY-MM-DD }. */
  async move(request: any, response: Response) {
    const { id } = request.user;
    const plannedFor = String(request.body?.plannedFor ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(plannedFor)) return response.status(400).json(Util.error({}, "plannedFor (YYYY-MM-DD) is required"));
    try {
      const session = await WorkoutService.movePlanned(id, request.params.sessionId, plannedFor);
      if (!session) return response.status(404).json(Util.error({}, "Not found"));
      return response.status(200).json(Util.success(session, "Session moved"));
    } catch (error: any) {
      return response.status(400).json(Util.error({}, error?.message ?? "Error moving session"));
    }
  }

  /* ------------------------------ training week ------------------------------ */

  async planActive(request: any, response: Response) {
    const { id } = request.user;
    try {
      const plan = await WorkoutPlanService.getActive(id);
      return response.status(200).json(Util.success(plan, "Active training week"));
    } catch (error) {
      console.error("Error fetching training week", error);
      return response.status(400).json(Util.error({ error }, "Error fetching training week"));
    }
  }

  async planCreate(request: any, response: Response) {
    const { id } = request.user;
    const parsed = WorkoutPlanInput.safeParse(request.body);
    if (!parsed.success) return bad(response, parsed.error.issues.slice(0, 5), "Invalid training week");
    try {
      const plan = await WorkoutPlanService.create(id, parsed.data);
      return response.status(200).json(Util.success(plan, "Training week saved"));
    } catch (error) {
      console.error("Error saving training week", error);
      return response.status(400).json(Util.error({ error }, "Error saving training week"));
    }
  }

  /** Put one designed workout on a day (replaces that day's planned session; opens a 1-day plan when none is active). */
  async planned(request: any, response: Response) {
    const { id } = request.user;
    const parsed = PlannedSessionInput.safeParse(request.body);
    if (!parsed.success) return bad(response, parsed.error.issues.slice(0, 5), "Invalid planned session");
    try {
      const out = await WorkoutPlanService.putOnDay(id, parsed.data);
      return response.status(200).json(Util.success(out, out.replaced ? "Planned session replaced" : "Planned session added"));
    } catch (error) {
      console.error("Error planning session", error);
      return response.status(400).json(Util.error({ error }, "Error planning session"));
    }
  }

  async planStatus(request: any, response: Response) {
    const { id } = request.user;
    const { status } = request.body ?? {};
    if (!PLAN_STATUSES.includes(status)) return response.status(400).json(Util.error({}, "valid status is required"));
    try {
      const plan = await WorkoutPlanService.updateStatus(id, request.params.planId, status);
      if (!plan) return response.status(404).json(Util.error({}, "Plan not found"));
      return response.status(200).json(Util.success(plan, "Training week status updated"));
    } catch (error) {
      console.error("Error updating training week", error);
      return response.status(400).json(Util.error({ error }, "Error updating training week"));
    }
  }

  /* ----------------------------- training profile ---------------------------- */

  async profileGet(request: any, response: Response) {
    const { id } = request.user;
    try {
      const profile = await TrainingProfileService.get(id);
      return response.status(200).json(Util.success(profile, "Training profile"));
    } catch (error) {
      console.error("Error fetching training profile", error);
      return response.status(400).json(Util.error({ error }, "Error fetching training profile"));
    }
  }

  async profilePut(request: any, response: Response) {
    const { id } = request.user;
    const parsed = TrainingProfileInput.safeParse(request.body);
    if (!parsed.success) return bad(response, parsed.error.issues.slice(0, 5), "Invalid training profile");
    try {
      const profile = await TrainingProfileService.upsert(id, parsed.data);
      return response.status(200).json(Util.success(profile, "Training profile saved"));
    } catch (error) {
      console.error("Error saving training profile", error);
      return response.status(400).json(Util.error({ error }, "Error saving training profile"));
    }
  }
}

export default new WorkoutHandler();
