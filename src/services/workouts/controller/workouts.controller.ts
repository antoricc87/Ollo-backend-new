import { Response } from "express";
import Util from "../../../utils/response";
import WorkoutService from "../model/workouts.model";
import { SyncRequest } from "../domain/workout.schema";

/** Patient identity always from the verified token. */
class WorkoutHandler {
  async list(request: any, response: Response) {
    const { id } = request.user;
    const from = new Date(String(request.query?.from ?? ""));
    const to = new Date(String(request.query?.to ?? ""));
    if (isNaN(from.getTime()) || isNaN(to.getTime())) return response.status(400).json(Util.error({}, "from and to (ISO) are required"));
    try {
      const sessions = await WorkoutService.list(id, { from, to });
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
    if (!parsed.success) return response.status(400).json(Util.error({ issues: parsed.error.issues.slice(0, 5) }, "Invalid sync payload"));
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
}

export default new WorkoutHandler();
