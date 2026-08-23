import { Response } from "express";
import Util from "../../../utils/response";
import UserGeneratedDataService from "../model/user_generated_data.model";
class UserGeneratedDataHandler {
  async fetchAdultsMealPlans(request: any, response: Response) {
    const { id } = request.user;
    try {
      const generatedData = await UserGeneratedDataService.fetchAdultsMealPlans(
        id
      );
      if (generatedData)
        return response
          .status(200)
          .json(
            Util.success(generatedData, "generaed data fetched successfully")
          );
    } catch (error: unknown) {
      return response
        .status(400)
        .json(Util.error({ error }, "Error fetching the data"));
    }
  }
  async fetchSubAccountMealPlans(request: any, response: Response) {
    const { id } = request.user;
    try {
      const generatedData =
        await UserGeneratedDataService.fetchSubAccountMealPlans(id);
      if (generatedData)
        return response
          .status(200)
          .json(
            Util.success(generatedData, "generaed data fetched successfully")
          );
    } catch (error: unknown) {
      return response
        .status(400)
        .json(Util.error({ error }, "Error fetching the data"));
    }
  }
}
export default new UserGeneratedDataHandler();
