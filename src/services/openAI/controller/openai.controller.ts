import express, { Request, Response } from "express";
import { Util } from "../../../utils/response";
import {
  getOpenAiCaloriesCalculator,
  getCaloriesFromImage,
  getCaloriesFromAudio,
  calculateMultipleMealsCaloriesAndNutrients,
} from "../model/openai.model";

export class OpenAiHandler {
  //generate total amount of intake calories from  food description
  async generateCaloriesAmount(request: any, response: Response) {
    const { foodDescription } = request.body;
    const { id } = request.user;

    try {
      if (!foodDescription) {
        return response
          .status(404)
          .json(Util.error({}, "Please insert food description"));
      }
      const openAiResponse = await getOpenAiCaloriesCalculator(
        foodDescription,
        id
      );
      if (openAiResponse) {
        return response
          .status(200)
          .json(
            Util.success(openAiResponse, "Calories calculated successfully")
          );
      }
    } catch (error: any) {
      console.error("Something went wrong calculating calories", error);
      throw error;
    }
  }
  async generateCaloriesAmountTest(request: any, response: Response) {
    const { foodDescription } = request.body;
    const { id } = request.user;

    try {
      if (!foodDescription) {
        return response
          .status(404)
          .json(Util.error({}, "Please insert food description"));
      }
      const openAiResponse = await calculateMultipleMealsCaloriesAndNutrients(
        foodDescription,
        id
      );
      if (openAiResponse) {
        return response
          .status(200)
          .json(
            Util.success(openAiResponse, "Calories calculated successfully")
          );
      }
    } catch (error: any) {
      console.error("Something went wrong calculating calories", error);
      throw error;
    }
  }

  //generate calories amount from image
  async generateCaloriesFromImage(request: any, response: Response) {
    const { base64Image, description } = request.body;
    const { id } = request.user;
    try {
      const calories = await getCaloriesFromImage(base64Image, description, id);
      if (calories) {
        return response
          .status(200)
          .json(Util.success(calories, "Calories successful generated"));
      }
    } catch (error: unknown) {
      return response
        .status(400)
        .json(Util.error({ error }, "Error generating calories"));
    }
  }
  //generate calories amount from audio
  async generateCaloriesFromAudio(request: any, response: Response) {
    const { base64Audio } = request.body;
    const { id } = request.user;
    try {
      const calories = await getCaloriesFromAudio(base64Audio, id);
      if (calories) {
        return response
          .status(200)
          .json(Util.success(calories, "Calories successful generated"));
      }
    } catch (error: unknown) {
      return response
        .status(400)
        .json(
          Util.error({ error }, "Error generating the calories from audio")
        );
    }
  }
}

export default new OpenAiHandler();
