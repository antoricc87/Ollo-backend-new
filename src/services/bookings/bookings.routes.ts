import { verifyDoctorToken, verifyToken } from "../../utils/auth_token";
import BookingsApi from "./controller/bookings.controller";
export default class Routes {
  app: any;
  constructor(app: any) {
    this.app = app;
  }

  appRoutes() {
    this.app.post(
      "/api/bookings/create_booking",
      verifyToken,
      BookingsApi.createBooking
    );
    this.app.get(
      "/api/bookings/get_booking_by_id",
      verifyToken,
      BookingsApi.getBookingById
    );
    this.app.get(
      "/api/bookings/get_latest_active_booking",
      verifyToken,
      BookingsApi.getLatestActiveBooking
    );
    this.app.post(
      "/api/bookings/delete_booking",
      verifyToken,
      BookingsApi.deleteBooking
    );
    this.app.post(
      "/api/bookings/get_bookings",
      verifyToken,
      BookingsApi.getBookings
    );
    this.app.post(
      "/api/bookings/doctor/get_bookings",
      verifyDoctorToken,
      BookingsApi.getBookings
    );
    this.app.post(
      "/api/bookings/update_booking",
      verifyToken,
      BookingsApi.updateBooking
    );
    // availabilities//
    this.app.post(
      "/api/availabilities/update_weekly_availabilities",
      verifyDoctorToken,
      BookingsApi.updatyeWeeklyAvailability
    );
    this.app.get(
      "/api/availabilities/get_doctor_availabilities",
      verifyDoctorToken,
      BookingsApi.fetchDoctorAvailabilities
    );
  }
  routesConfig() {
    this.appRoutes();
  }
}

module.exports = Routes;
