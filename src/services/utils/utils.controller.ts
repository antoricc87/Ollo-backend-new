import { Request, Response } from "express";
import Util from "../../utils/response";
import { PDFParseAndRedactPII } from "../../utils/redactPI";
import { UploadedFile } from "express-fileupload";
import UtilsService from "./utils.model";
import { util } from "zod";
import {
  formatLabData,
  formatLabDataText,
  generateLabDataJSON,
  generateLabDataJSONFromBase64,
} from "../openAI/model/openai.model";
import { parsedLabSchema } from "../openAI/schemas/openai.schema";
import { PDFRedactWithMask } from "../../utils/redactPHIPdf";
export class UtilsHandler {
  async parsePDF(request: Request, response: Response) {
    const { firstName, lastName, dob, patientId } = request.body;
    const file = request.files.file;

    if (!file || !firstName || !lastName || !dob)
      return response
        .status(500)
        .json(
          Util.error(
            {},
            "One of the following required parameters is missing:[file,firstName,lastName,dob]"
          )
        );
    try {
      const parsedText = await PDFParseAndRedactPII(
        file as UploadedFile,
        firstName,
        lastName,
        dob
      );
      const labDataJSON = await generateLabDataJSON(
        JSON.stringify(parsedText),
        patientId
      );
      // const redactedBuffer = await PDFRedactWithMask(
      //   file as UploadedFile,
      //   firstName,
      //   lastName,
      //   dob
      // );
      // const base64Pdf = Buffer.from(redactedBuffer).toString("base64");
      // const labDataJSON = await generateLabDataJSONFromBase64(
      //   base64Pdf,
      //   patientId
      // );
      // const parsedLab = await formatLabDataText(parsedText);

      // if (labDataJSON)
      return response
        .status(200)
        .json(Util.success(labDataJSON, "Labs generated"));
    } catch (error: unknown) {
      console.error(error);
      return response
        .status(500)
        .json(Util.error({ error }, "Error parsing pdf"));
    }
  }

  // get available affordable care tests and screenings
  async getInstacartRetailers(request: Request, response: Response) {
    const { postalCode } = request.body;

    if (!postalCode)
      return response
        .status(400)
        .json(Util.error({}, "Postal code is required"));
    try {
      const retailers = await UtilsService.getInstacartRetailers(
        postalCode,
        process.env.INSTACART_API_KEY_PROD_RETAILERS
      );
      if (retailers)
        return response
          .status(200)
          .json(Util.success(retailers, "Retailers fetched successfully"));
    } catch (error: unknown) {
      return response
        .status(500)
        .json(Util.error({ error }, "Error fetching instacrt retailers"));
    }
  }
  // get food product info
  async getFoodProductInfo(request: any, response: Response) {
    const { base64Image } = request.body;
    const { id } = request.user;
    if (!base64Image) {
      return response
        .status(400)
        .json(Util.error({}, "Base64 image is required"));
    }
    try {
      const foodInformation = await UtilsService.getFoodInfoFromImage(
        base64Image,
        id
      );
      if (foodInformation) {
        return response
          .status(200)
          .json(
            Util.success(
              foodInformation,
              "Food information generated successfully"
            )
          );
      }
    } catch (error: unknown) {
      console.error("Error generating product information", error);
      throw error;
    }
  }

  async transcribe(request: any, response: Response) {
    try {
      const transcription = await UtilsService.transcribeAudioFile();
      if (transcription)
        return response
          .status(200)
          .json(Util.success(transcription, "successfully transcribed"));
    } catch (error: unknown) {
      return response
        .status(500)
        .json(Util.error({ error }, "error transcribing"));
    }
  }

  async validatePromoCode(request: Request, response: Response) {
    const { code } = request.body;
    console.log(code);
    if (!code)
      return response
        .status(400)
        .json(Util.error({}, "Promo code is required"));
    try {
      const codeValidation = await UtilsService.validatePromoCode(code);
      if (codeValidation) {
        return response
          .status(200)
          .json(Util.success(codeValidation, "Promo code validation"));
      }
    } catch (error: unknown) {
      return response
        .status(500)
        .json(Util.error({ error }, "error validating promo code"));
    }
  }

  async createPromoCode(request: Request, response: Response) {
    const { code } = request.body;
    if (!code)
      return response
        .status(400)
        .json(Util.error({}, "Promo code is required"));
    try {
      const promoCode = await UtilsService.createPromoCode(code);
      if (promoCode && "isValid" in promoCode && !promoCode.isValid)
        return response.status(400).json(Util.error({}, promoCode.message));
      else
        return response
          .status(200)
          .json(Util.success(promoCode, "Promo code created successfully"));
    } catch (error: unknown) {
      return response
        .status(500)
        .json(Util.error({ error }, "error creating promo code"));
    }
  }
}

export default new UtilsHandler();
