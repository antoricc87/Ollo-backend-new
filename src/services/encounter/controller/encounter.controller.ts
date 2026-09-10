import { Response } from "express";
import Util from "../../../utils/response";
import EncounterService from "../model/encounter.model";

/** Patient identity always comes from the verified token — never from the body. */

const ROUTES = ["OWN_DOCTOR", "OLLO_DOCTOR", "TRACKING", "CRISIS", "UNDECIDED"];
const TRENDS = ["BETTER", "SAME", "WORSE"];
const STATUSES = ["OPEN", "CLOSED", "ABANDONED"];

class EncounterHandler {
  async start(request: any, response: Response) {
    const { id } = request.user;
    const { complaint } = request.body ?? {};
    if (typeof complaint !== "string" || complaint.trim().length < 2)
      return response.status(400).json(Util.error({}, "Tell me what's going on in a few words"));
    try {
      const result = await EncounterService.start(id, complaint);
      return response.status(200).json(Util.success(result, "Check-in started"));
    } catch (error) {
      console.error("Error starting check-in", error);
      return response.status(400).json(Util.error({ error }, "Could not start the check-in"));
    }
  }

  async fetch(request: any, response: Response) {
    const { id } = request.user;
    try {
      const result = await EncounterService.get(id, request.params.encounterId);
      if (!result) return response.status(404).json(Util.error({}, "Check-in not found"));
      return response.status(200).json(Util.success(result, "Check-in"));
    } catch (error) {
      console.error("Error fetching check-in", error);
      return response.status(400).json(Util.error({ error }, "Could not load the check-in"));
    }
  }

  async list(request: any, response: Response) {
    const { id } = request.user;
    const status = request.query?.status;
    if (status && !STATUSES.includes(status)) return response.status(400).json(Util.error({}, "status must be OPEN, CLOSED or ABANDONED"));
    try {
      const result = await EncounterService.list(id, status);
      return response.status(200).json(Util.success(result, "Check-ins"));
    } catch (error) {
      console.error("Error listing check-ins", error);
      return response.status(400).json(Util.error({ error }, "Could not load check-ins"));
    }
  }

  /** Open episodes with a due follow-up or a persistence nudge — the dashboard row. */
  async open(request: any, response: Response) {
    const { id } = request.user;
    try {
      const result = await EncounterService.openEpisodes(id);
      return response.status(200).json(Util.success(result, "Open check-ins"));
    } catch (error) {
      console.error("Error loading open check-ins", error);
      return response.status(400).json(Util.error({ error }, "Could not load open check-ins"));
    }
  }

  async answer(request: any, response: Response) {
    const { id } = request.user;
    const { slotKey, value, text } = request.body ?? {};
    if (typeof slotKey !== "string" || !slotKey) return response.status(400).json(Util.error({}, "slotKey is required"));
    if (value === undefined && typeof text !== "string") return response.status(400).json(Util.error({}, "Send either value or text"));
    try {
      const result = await EncounterService.answer(id, request.params.encounterId, slotKey, value, text);
      if (!result) return response.status(404).json(Util.error({}, "Check-in not found"));
      return response.status(200).json(Util.success(result, "Answer recorded"));
    } catch (error: any) {
      console.error("Error recording answer", error);
      return response.status(400).json(Util.error({ error }, error?.message ?? "Could not record that"));
    }
  }

  async handout(request: any, response: Response) {
    const { id } = request.user;
    try {
      const result = await EncounterService.handout(id, request.params.encounterId);
      if (!result) return response.status(404).json(Util.error({}, "Check-in not found"));
      return response.status(200).json(Util.success(result, "Summary for your clinician"));
    } catch (error) {
      console.error("Error building handout", error);
      return response.status(400).json(Util.error({ error }, "Could not build the summary"));
    }
  }

  async close(request: any, response: Response) {
    const { id } = request.user;
    const { route, bookingId } = request.body ?? {};
    if (!ROUTES.includes(route)) return response.status(400).json(Util.error({}, `route must be one of ${ROUTES.join(", ")}`));
    try {
      const result = await EncounterService.close(id, request.params.encounterId, route, bookingId);
      if (!result) return response.status(404).json(Util.error({}, "Check-in not found"));
      return response.status(200).json(Util.success(result, "Check-in closed"));
    } catch (error) {
      console.error("Error closing check-in", error);
      return response.status(400).json(Util.error({ error }, "Could not close the check-in"));
    }
  }

  async checkIn(request: any, response: Response) {
    const { id } = request.user;
    const { trend, note } = request.body ?? {};
    if (!TRENDS.includes(trend)) return response.status(400).json(Util.error({}, "trend must be BETTER, SAME or WORSE"));
    try {
      const result = await EncounterService.checkIn(id, request.params.encounterId, trend, note);
      if (!result) return response.status(404).json(Util.error({}, "Check-in not found"));
      return response.status(200).json(Util.success(result, "Noted"));
    } catch (error) {
      console.error("Error recording follow-up", error);
      return response.status(400).json(Util.error({ error }, "Could not record that"));
    }
  }

  async history(request: any, response: Response) {
    const { id } = request.user;
    try {
      const result = await EncounterService.history(id, request.params.encounterId);
      if (!result) return response.status(404).json(Util.error({}, "Check-in not found"));
      return response.status(200).json(Util.success(result, "Follow-ups"));
    } catch (error) {
      console.error("Error loading follow-ups", error);
      return response.status(400).json(Util.error({ error }, "Could not load follow-ups"));
    }
  }
}

export default new EncounterHandler();
