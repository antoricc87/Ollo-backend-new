import { verifyToken } from "../../utils/auth_token";
import MessagingHandler from "./controller/messaging.controller";

/** Patient-token chat routes: list threads, read one (marks clinician messages read), reply, start. */
export default class Routes {
  app: any;
  constructor(app: any) {
    this.app = app;
  }

  appRoutes() {
    this.app.get("/api/messaging/chats", verifyToken, MessagingHandler.chats);
    this.app.post("/api/messaging/chats", verifyToken, MessagingHandler.start);
    this.app.get("/api/messaging/chats/:id", verifyToken, MessagingHandler.chat);
    this.app.post("/api/messaging/chats/:id/messages", verifyToken, MessagingHandler.send);
  }

  routesConfig() {
    this.appRoutes();
  }
}

module.exports = Routes;
