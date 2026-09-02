import { Response } from "express";
import Util from "../../../utils/response";
import { SeamRequest } from "../seam.auth";
import { clinicianUpsertSchema } from "../seam.schema";
import SeamService, { SeamConflictError, SeamPatientService } from "../model/seam.model";

/** S0 wiring checks. Patient-scoped resources arrive with S2 (see docs/physician-app-plan.md). */
class SeamHandler {
  async health(_req: SeamRequest, res: Response) {
    return res.status(200).json(
      Util.success({ ok: true, service: "ollo-backend", seam: "v1", time: new Date().toISOString() }, "Seam reachable")
    );
  }

  /** Publish / refresh a clinician's directory row. Body: seam.schema clinicianUpsertSchema. */
  async upsertClinician(req: SeamRequest, res: Response) {
    const externalId = String(req.params.externalId ?? "").trim();
    if (!externalId) return res.status(400).json(Util.error({}, "externalId is required"));
    const parsed = clinicianUpsertSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(Util.error(parsed.error.flatten().fieldErrors, "Invalid clinician payload"));
    }
    try {
      const row = await SeamService.upsertClinician(externalId, parsed.data);
      return res.status(200).json(Util.success(row, "Clinician published"));
    } catch (error) {
      if (error instanceof SeamConflictError) return res.status(409).json(Util.error({}, error.message));
      console.error("seam: clinician upsert failed", error);
      return res.status(500).json(Util.error({}, "Clinician upsert failed"));
    }
  }

  /* ---- patient-scoped (requireClinician + requireGrant ran before these) ---- */

  async patients(req: SeamRequest, res: Response) {
    try {
      const rows = await SeamPatientService.patientsOf(req.seam!.clinician!.id);
      return res.status(200).json(Util.success(rows, "Patients fetched"));
    } catch (error) {
      console.error("seam: patients failed", error);
      return res.status(500).json(Util.error({}, "Patients fetch failed"));
    }
  }

  private static patientRead =
    (name: string, fn: (patientId: string, req: SeamRequest) => Promise<unknown>) => async (req: SeamRequest, res: Response) => {
      try {
        const data = await fn(req.seam!.patientId!, req);
        if (data === null) return res.status(404).json(Util.error({}, "Patient not found"));
        return res.status(200).json(Util.success(data, `${name} fetched`));
      } catch (error) {
        if (/not found/i.test((error as Error)?.message ?? "")) return res.status(404).json(Util.error({}, "Patient not found"));
        console.error(`seam: ${name} failed`, error);
        return res.status(500).json(Util.error({}, `${name} fetch failed`));
      }
    };

  snapshot = SeamHandler.patientRead("Snapshot", (id) => SeamPatientService.snapshot(id));
  labsCurrent = SeamHandler.patientRead("Current labs", (id) => SeamPatientService.labsCurrent(id));
  labsRisk = SeamHandler.patientRead("Risk report", (id) => SeamPatientService.risk(id));
  plan = SeamHandler.patientRead("Plan", (id) => SeamPatientService.plan(id).then((p) => p ?? { active: null }));
  trackers = SeamHandler.patientRead("Trackers", (id, req) => {
    const days = Math.min(365, Math.max(1, parseInt(String(req.query.days ?? "90"), 10) || 90));
    return SeamPatientService.trackers(id, days);
  });

  /** Key + clinician header both valid → the directory row the seam resolved. */
  async whoami(req: SeamRequest, res: Response) {
    return res.status(200).json(Util.success({ clinician: req.seam?.clinician }, "Clinician resolved"));
  }
}

export default new SeamHandler();
