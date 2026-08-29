import { Response } from "express";
import Util from "../../../utils/response";
import ClinicianService from "../model/clinicians.model";

class ClinicianHandler {
  async directory(_request: any, response: Response) {
    try {
      const clinicians = await ClinicianService.directory();
      return response.status(200).json(Util.success(clinicians, "Clinicians fetched successfully"));
    } catch (error: unknown) {
      console.error("Error fetching clinicians", error);
      return response.status(500).json(Util.error({ error }, "Error fetching clinicians"));
    }
  }

  async careTeam(request: any, response: Response) {
    const { id } = request.user;
    try {
      const clinicians = await ClinicianService.careTeamOf(id);
      return response.status(200).json(Util.success(clinicians, "Care team fetched successfully"));
    } catch (error: unknown) {
      console.error("Error fetching care team", error);
      return response.status(500).json(Util.error({ error }, "Error fetching care team"));
    }
  }

  async addToCareTeam(request: any, response: Response) {
    const { id } = request.user;
    const { clinicianId } = request.body ?? {};
    if (!clinicianId) return response.status(400).json(Util.error({}, "clinicianId is required"));
    try {
      const row = await ClinicianService.addToCareTeam(id, clinicianId, "MANUAL");
      return response.status(201).json(Util.success(row, "Clinician added to care team"));
    } catch (error: any) {
      const notFound = /not found/i.test(error?.message ?? "");
      return response.status(notFound ? 404 : 500).json(Util.error({ error }, notFound ? "Clinician not found" : "Error adding to care team"));
    }
  }

  async removeFromCareTeam(request: any, response: Response) {
    const { id } = request.user;
    const { clinicianId } = request.params;
    try {
      await ClinicianService.removeFromCareTeam(id, clinicianId);
      return response.status(200).json(Util.success({}, "Clinician removed from care team"));
    } catch (error: unknown) {
      return response.status(500).json(Util.error({ error }, "Error removing from care team"));
    }
  }
}

export default new ClinicianHandler();
