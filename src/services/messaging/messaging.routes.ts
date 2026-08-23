import { verifyDoctorToken, verifyToken } from "../../utils/auth_token";
import MessagingHandler from "./controller/messaging.controller";

export default class Routes {
  app: any;

  constructor(app: any) {
    this.app = app;
  }

  appRoutes() {
    this.app.get(
      "/api/messaging/patient/get_chat_by_id/:id",
      verifyToken,
      MessagingHandler.getChatById
    );

    this.app.get(
      "/api/messaging/doctor/get_chat_by_id/:id",
      verifyDoctorToken,
      MessagingHandler.getChatById
    );
    this.app.post(
      "/api/messaging/patient/send_message",
      verifyToken,
      MessagingHandler.sendMessage
    );
    this.app.post(
      "/api/messaging/doctor/send_message",
      verifyDoctorToken,
      MessagingHandler.sendMessage
    );
    this.app.post(
      "/api/messaging/patient/create_chat",
      verifyToken,
      MessagingHandler.createChat
    );

    this.app.get(
      "/api/messaging/doctor/get_all_chats",
      verifyDoctorToken,
      MessagingHandler.getAllChats
    );
    this.app.get(
      "/api/messaging/patient/get_all_chats",
      verifyToken,
      MessagingHandler.getAllChats
    );
    this.app.post(
      "/api/messaging/doctor/create_draft",
      verifyDoctorToken,
      MessagingHandler.createMessageDraft
    );
    this.app.post(
      "/api/messaging/doctor/create_draft_stream",
      verifyDoctorToken,
      MessagingHandler.createMessageDraftStream
    );
  }

  routesConfig() {
    this.appRoutes();
  }
}
