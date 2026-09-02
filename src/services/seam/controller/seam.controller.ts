import { Response } from "express";
import Util from "../../../utils/response";
import { SeamRequest } from "../seam.auth";
import { clinicianUpsertSchema } from "../seam.schema";
import SeamService, { SeamConflictError } from "../model/seam.model";

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

  /** Key + clinician header both valid → the directory row the seam resolved. */
  async whoami(req: SeamRequest, res: Response) {
    return res.status(200).json(Util.success({ clinician: req.seam?.clinician }, "Clinician resolved"));
  }
}

export default new SeamHandler();
