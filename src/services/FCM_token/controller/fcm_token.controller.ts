import { Request, Response } from "express";
import FCMTokenService from "../model/fcm_token.model";
import Util from "../../../utils/response";
import { ObjectId } from "../../../utils/idValidation";

export class FCMTokenHandler {
  async handleCreateRefreshFCMToken(request: Request, response: Response) {
    const { FCMToken, patientId } = request.body;
    if (!FCMToken || !ObjectId.isValid(patientId)) {
      return response
        .status(400)
        .json(
          Util.error(
            {},
            "FCM token is required and patienId must be a valid object id"
          )
        );
    }
    try {
      const result = await FCMTokenService.handleFCMToken(FCMToken, patientId);
      if (result) {
        return response
          .status(200)
          .json(Util.success(result, "FCM token successfully handled"));
      }
    } catch (error: unknown) {
      return response
        .status(500)
        .json(Util.error({ error }, "Error handling FCM token"));
    }
  }
}

export default new FCMTokenHandler();
