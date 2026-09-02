import { Response } from "express";
import Util from "../../../utils/response";
import { SeamRequest } from "../seam.auth";

/** S0 wiring checks. Patient-scoped resources arrive with S2 (see docs/physician-app-plan.md). */
class SeamHandler {
  async health(_req: SeamRequest, res: Response) {
    return res.status(200).json(
      Util.success({ ok: true, service: "ollo-backend", seam: "v1", time: new Date().toISOString() }, "Seam reachable")
    );
  }

  /** Key + clinician header both valid → the directory row the seam resolved. */
  async whoami(req: SeamRequest, res: Response) {
    return res.status(200).json(Util.success({ clinician: req.seam?.clinician }, "Clinician resolved"));
  }
}

export default new SeamHandler();
