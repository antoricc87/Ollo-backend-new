import { verifyToken } from "../../utils/auth_token";
import BookingsApi from "./controller/bookings.controller";

/**
 * Patient-token booking routes. The doctor-side routes (doctor/get_bookings,
 * /api/availabilities/*) left with the physician surface on 2026-08-29;
 * availability is now published data on `Clinician` (seeded in dev, later fed
 * by the clinician service).
 */
export default class Routes {
  app: any;
  constructor(app: any) {
    this.app = app;
  }

  appRoutes() {
    this.app.post("/api/bookings/create_booking", verifyToken, BookingsApi.createBooking);
    this.app.get("/api/bookings/get_booking_by_id", verifyToken, BookingsApi.getBookingById);
    this.app.get("/api/bookings/get_latest_active_booking", verifyToken, BookingsApi.getLatestActiveBooking);
    this.app.post("/api/bookings/delete_booking", verifyToken, BookingsApi.deleteBooking);
    this.app.post("/api/bookings/get_bookings", verifyToken, BookingsApi.getBookings);
    this.app.post("/api/bookings/update_booking", verifyToken, BookingsApi.updateBooking);
  }
  routesConfig() {
    this.appRoutes();
  }
}

module.exports = Routes;
