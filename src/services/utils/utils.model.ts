import axios from "axios";
import prisma from "../../utility/prismaClient";

require("dotenv").config();
export class UtilsService {
  async getInstacartRetailers(postalCode: string, token: String) {
    try {
      const url = `https://connect.instacart.com/idp/v1/retailers?postal_code=${postalCode}&country_code=US`;
      // const url = `https://connect.dev.instacart.tools/idp/v1/retailers?postal_code=${postalCode}&country_code=US`;
      const response = await axios.get(url, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          // "X-Instacart-Env": "production",
        },
      });
      // console.log("Retailers:", response.data);
      if (response.data) return response.data;
    } catch (error: any) {
      if (error.response?.data?.error?.errors) {
        console.error(
          "Detailed validation errors:",
          JSON.stringify(error.response.data.error.errors, null, 2)
        );
      } else {
        console.error(
          "Error fetching instacart retailers:",
          error.response?.data || error
        );
      }
      throw error;
    }
  }



  async validatePromoCode(code: string) {
    try {
      const promoCode = await prisma.promoCode.findMany({
        where: {
          code: code,
          isActive: true,
          isDeleted: false,
        },
      });
      if (promoCode.length === 0) {
        return {
          isValid: false,
          message: "Invalid promo code",
        };
      }
      return {
        isValid: true,
        message: "Promo code is valid",
      };
    } catch (error: unknown) {
      console.error("Error validating promo code", error);
      throw error;
    }
  }
  // create promo code
  async createPromoCode(code: string) {
    console.log("code", code);
    try {
      const existingPromoCode = await prisma.promoCode.findUnique({
        where: { code: code, isActive: true, isDeleted: false },
      });
      if (existingPromoCode) {
        return {
          isValid: false,
          message: "Promo code already exists",
        };
      }
      return await prisma.promoCode.create({
        data: { code: code, isActive: false, isDeleted: false },
      });
    } catch (error: unknown) {
      console.error("Error creating promo code", error);
      throw error;
    }
  }
}

export default new UtilsService();
