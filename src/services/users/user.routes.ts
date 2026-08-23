import userApi from "./controller/user.controller";
import { verifyDoctorToken, verifyToken } from "../../utils/auth_token";

export default class Routes {
  app: any;
  constructor(app: any) {
    this.app = app;
  }

  appRoutes() {
    // this.app.put("/api/users/:id", verifyToken, userApi.updateUser);
    this.app.get(
      "/api/user/get_user_by_id",
      verifyDoctorToken,
      userApi.getUserById
    );
    this.app.delete(
      "/api/users/delete_user/:id",
      verifyDoctorToken,
      userApi.deleteUser
    );
    this.app.post("/api/users/user_login", userApi.userLogin);
    this.app.post("/api/users/create_new_user", userApi.createUser);
  }
  routesConfig() {
    this.appRoutes();
  }
}

module.exports = Routes;
