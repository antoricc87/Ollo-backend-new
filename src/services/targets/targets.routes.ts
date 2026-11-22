import { Response } from "express";
import { verifyToken } from "../../utils/auth_token";
import Util from "../../utils/response";
import { redoTargets, resetTarget, setTarget, targetsFor } from "./targets.model";

/**
 * Profile targets (Nov 22 2026). Patient-scoped; identity from the token only.
 *   GET    /api/targets            every target, with where it comes from (plan · you · profile)
 *                                  ?setup=1 (the onboarding step): Ollie sets them once from the Health ID
 *   POST   /api/targets/redo       Ollie sets them again (their own values stay)
 *   PUT    /api/targets/:key       { value }   they set one (kept, never recomputed)
 *   DELETE /api/targets/:key       back to the computed value
 */
const who = (request: any, response: Response) => {
  const id = request.user?.id;
  if (!id) response.status(401).json(Util.error({}, "Unauthorized"));
  return id as string | undefined;
};

export default class Routes {
  app: any;
  constructor(app: any) {
    this.app = app;
  }
  routesConfig() {
    this.app.get("/api/targets", verifyToken, async (request: any, response: Response) => {
      const id = who(request, response);
      if (!id) return;
      const out = await targetsFor(id, { setup: request.query?.setup === "1" }).catch((e) => (console.error("targets", e), null));
      if (!out) return response.status(500).json(Util.error({}, "Could not load your targets"));
      return response.json(Util.success(out, "Targets"));
    });
    this.app.post("/api/targets/redo", verifyToken, async (request: any, response: Response) => {
      const id = who(request, response);
      if (!id) return;
      const out = await redoTargets(id).catch((e) => (console.error("targets redo", e), null));
      if (!out) return response.status(500).json(Util.error({}, "Could not set your targets"));
      return response.json(Util.success(out, "Set"));
    });
    this.app.put("/api/targets/:key", verifyToken, async (request: any, response: Response) => {
      const id = who(request, response);
      if (!id) return;
      const out = await setTarget(id, String(request.params.key), Number(request.body?.value)).catch((e) => (console.error("targets set", e), null));
      if (!out) return response.status(400).json(Util.error({}, "That value can't be a target"));
      return response.json(Util.success(out, "Saved"));
    });
    this.app.delete("/api/targets/:key", verifyToken, async (request: any, response: Response) => {
      const id = who(request, response);
      if (!id) return;
      const out = await resetTarget(id, String(request.params.key)).catch((e) => (console.error("targets reset", e), null));
      if (!out) return response.status(400).json(Util.error({}, "Could not reset it"));
      return response.json(Util.success(out, "Reset"));
    });
  }
}
module.exports = Routes;
