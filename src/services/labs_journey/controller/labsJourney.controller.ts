import { Response } from "express";
import Util from "../../../utils/response";
import LabsJourneyService from "../model/labsJourney.model";

const ROUTES = ["OWN_DOCTOR", "DTC", "OLLO_DOCTOR"];
const STATUSES = ["RECOMMENDED", "ORDERED", "RESULTED", "CANCELLED"];

/** Patient identity always comes from the verified token — never from the body. */
class LabsJourneyHandler {
  async fetchPanel(request: any, response: Response) {
    const { id } = request.user;
    try {
      const panel = await LabsJourneyService.getPanel(id);
      return response.status(200).json(Util.success(panel, "Recommended panel"));
    } catch (error) {
      console.error("Error building labs panel", error);
      return response.status(400).json(Util.error({ error }, "Error building panel"));
    }
  }

  async fetchJourney(request: any, response: Response) {
    const { id } = request.user;
    try {
      const journey = await LabsJourneyService.getJourney(id);
      return response.status(200).json(Util.success(journey, "Labs journey"));
    } catch (error) {
      console.error("Error fetching labs journey", error);
      return response.status(400).json(Util.error({ error }, "Error fetching journey"));
    }
  }

  async startJourney(request: any, response: Response) {
    const { id } = request.user;
    const { route } = request.body ?? {};
    if (!ROUTES.includes(route))
      return response.status(400).json(Util.error({}, "route must be OWN_DOCTOR, DTC or OLLO_DOCTOR"));
    try {
      const journey = await LabsJourneyService.startJourney(id, route);
      return response.status(200).json(Util.success(journey, "Labs journey started"));
    } catch (error) {
      console.error("Error starting labs journey", error);
      return response.status(400).json(Util.error({ error }, "Error starting journey"));
    }
  }

  async updateJourney(request: any, response: Response) {
    const { id } = request.user;
    const { status, bookingId } = request.body ?? {};
    if (status !== undefined && !STATUSES.includes(status))
      return response.status(400).json(Util.error({}, "Invalid status"));
    if (status === undefined && !bookingId)
      return response.status(400).json(Util.error({}, "status or bookingId is required"));
    try {
      const journey = await LabsJourneyService.updateJourney(id, { status, bookingId });
      return response.status(200).json(Util.success(journey, "Labs journey updated"));
    } catch (error: any) {
      console.error("Error updating labs journey", error);
      return response.status(400).json(Util.error({ error }, error?.message ?? "Error updating journey"));
    }
  }
}

export default new LabsJourneyHandler();
