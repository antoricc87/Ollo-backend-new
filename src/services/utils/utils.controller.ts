import { Request, Response } from "express";
import Util from "../../utils/response";
import UtilsService from "./utils.model";
export class UtilsHandler {

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
