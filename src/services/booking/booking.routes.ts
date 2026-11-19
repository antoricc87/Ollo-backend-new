import { Response } from "express";
import { verifyToken } from "../../utils/auth_token";
import Util from "../../utils/response";
import { bookingLive, cancel, confirm, hold, listBookings, placesFor, slotsAt } from "./booking.service";

/**
 * Booking for preventive services (P1b). Patient-scoped; identity from the token.
 *   GET  /api/booking/status                    { live } — false until a network is switched on
 *   GET  /api/booking/places?keys=a,b           places offering every key, earliest free time
 *   GET  /api/booking/places/:id/slots?keys=&from=
 *   POST /api/booking/holds                     { locationId, keys, type, startsAt } → held for 10 min
 *   POST /api/booking/:id/confirm | /cancel
 *   GET  /api/booking                           their bookings
 */
const keysOf = (q: any) => String(q?.keys ?? "").split(",").map((k) => k.trim()).filter(Boolean).slice(0, 30);
const STATUS: Record<string, number> = { not_found: 404, not_offered: 400, taken: 409, expired: 410, not_live: 503 };

const wrap = (fn: (id: string, req: any) => Promise<any>) => async (request: any, response: Response) => {
  const id = request.user?.id;
  if (!id) return response.status(401).json(Util.error({}, "Unauthorized"));
  try {
    const out = await fn(id, request);
    if (out && typeof out === "object" && "error" in out) return response.status(STATUS[out.error] ?? 400).json(Util.error({ code: out.error }, out.error));
    return response.json(Util.success(out, "OK"));
  } catch (e) {
    console.error("booking", e);
    return response.status(500).json(Util.error({}, "Booking failed"));
  }
};

export default class Routes {
  app: any;
  constructor(app: any) {
    this.app = app;
  }
  routesConfig() {
    this.app.get("/api/booking/status", verifyToken, wrap(async () => ({ live: bookingLive() })));
    this.app.get("/api/booking/places", verifyToken, wrap(async (_id, r) => ({ places: await placesFor(keysOf(r.query)) })));
    this.app.get(
      "/api/booking/places/:locationId/slots",
      verifyToken,
      wrap(async (_id, r) => {
        const slots = await slotsAt(String(r.params.locationId), keysOf(r.query), r.query?.from ? new Date(String(r.query.from)) : new Date());
        return slots ? { slots } : { error: "not_offered" };
      })
    );
    this.app.post("/api/booking/holds", verifyToken, wrap((id, r) => hold(id, { locationId: String(r.body?.locationId ?? ""), keys: Array.isArray(r.body?.keys) ? r.body.keys.map(String) : [], type: String(r.body?.type ?? "lab"), startsAt: String(r.body?.startsAt ?? "") })));
    this.app.post("/api/booking/:bookingId/confirm", verifyToken, wrap((id, r) => confirm(id, String(r.params.bookingId))));
    this.app.post("/api/booking/:bookingId/cancel", verifyToken, wrap((id, r) => cancel(id, String(r.params.bookingId))));
    this.app.get("/api/booking", verifyToken, wrap(async (id) => ({ bookings: await listBookings(id) })));
  }
}
module.exports = Routes;
