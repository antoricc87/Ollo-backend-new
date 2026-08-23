import { verifyAdminToken } from "../../utils/auth_token";
import AdminHandler from "./controller/admin.controller";
export default class Routes {
  app: any;
  constructor(app: any) {
    this.app = app;
  }

  appRoutes() {
    this.app.post("/api/admin/login", AdminHandler.adminLogin);
    this.app.post("/api/admin/signup", AdminHandler.createAdmin);
    this.app.post(
      "/api/admin/update_booking",
      verifyAdminToken,
      AdminHandler.updateBooking
    );
    this.app.get(
      "/api/admin/fetch_all_bookings",
      verifyAdminToken,
      AdminHandler.fetchAllBookings
    );
    this.app.post(
      "/api/admin/add_authorized_physician",
      verifyAdminToken,
      AdminHandler.cerateAuthorizedPhysician
    );
    this.app.get(
      "/api/admin/get_authorized_physicians",
      verifyAdminToken,
      AdminHandler.getAllAuthorizedPhysicians
    );
  }
  routesConfig() {
    this.appRoutes();
  }
}

module.exports = Routes;
