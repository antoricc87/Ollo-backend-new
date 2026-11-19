import { Response } from "express";
import { verifyToken } from "../../utils/auth_token";
import Util from "../../utils/response";
import { loadPlan, recordDone, setCadence, setOptional } from "./model/preventive.model";

/**
 * The preventive plan (../docs/preventive-plan-plan.md). Patient-scoped;
 * identity from the token only.
 *   GET    /api/preventive-plan              the plan (rebuilt from the record, saved)
 *   POST   /api/preventive-plan/items/:key   add an optional test
 *   DELETE /api/preventive-plan/items/:key   take an added test out
 *   POST   /api/preventive-plan/items/:key/done     { doneOn: "YYYY-MM" | "YYYY-MM-DD", outcome? }
 *   PUT    /api/preventive-plan/items/:key/cadence  { months: number | null }  (0 = once; null = back to the plan's)
 */
const who = (request: any, response: Response) => {
  const id = request.user?.id;
  if (!id) response.status(401).json(Util.error({}, "Unauthorized"));
  return id as string | undefined;
};

const fetchPlan = async (request: any, response: Response) => {
  const id = who(request, response);
  if (!id) return;
  try {
    const plan = await loadPlan(id);
    if (!plan) return response.status(404).json(Util.error({}, "Not found"));
    return response.json(Util.success(plan, "Preventive plan"));
  } catch (e) {
    console.error("preventive plan", e);
    return response.status(500).json(Util.error({}, "Could not build the plan"));
  }
};

const change = (add: boolean) => async (request: any, response: Response) => {
  const id = who(request, response);
  if (!id) return;
  const plan = await setOptional(id, String(request.params?.key ?? ""), add).catch((e) => (console.error("preventive plan item", e), null));
  if (!plan) return response.status(404).json(Util.error({}, "No such test"));
  return response.json(Util.success(plan, add ? "Added" : "Removed"));
};

export default class Routes {
  app: any;
  constructor(app: any) {
    this.app = app;
  }
  routesConfig() {
    this.app.get("/api/preventive-plan", verifyToken, fetchPlan);
    this.app.post("/api/preventive-plan/items/:key", verifyToken, change(true));
    this.app.delete("/api/preventive-plan/items/:key", verifyToken, change(false));
    this.app.post("/api/preventive-plan/items/:key/done", verifyToken, async (request: any, response: Response) => {
      const id = who(request, response);
      if (!id) return;
      const plan = await recordDone(id, String(request.params.key), { doneOn: String(request.body?.doneOn ?? ""), outcome: request.body?.outcome }).catch((e) => (console.error("preventive done", e), null));
      if (!plan) return response.status(400).json(Util.error({}, "Not a date we can use"));
      return response.json(Util.success(plan, "Recorded"));
    });
    this.app.put("/api/preventive-plan/items/:key/cadence", verifyToken, async (request: any, response: Response) => {
      const id = who(request, response);
      if (!id) return;
      const months = request.body?.months === null ? null : Number(request.body?.months);
      const plan = await setCadence(id, String(request.params.key), months).catch((e) => (console.error("preventive cadence", e), null));
      if (!plan) return response.status(400).json(Util.error({}, "Could not change it"));
      return response.json(Util.success(plan, "Changed"));
    });
  }
}
module.exports = Routes;
