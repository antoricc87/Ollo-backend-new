import { Response } from "express";
import Util from "../../../utils/response";
import DoctorsService from "../model/doctors.model";
class DoctorsHandler {
  async fetchAllDoctors(request: any, response: Response) {
    try {
      const doctors = await DoctorsService.fetchAllDoctors();
      if (doctors)
        return response
          .status(200)
          .json(Util.success(doctors, "doctors fetched successfully"));
    } catch (error: unknown) {
      response
        .status(500)
        .json(Util.error({ error }, "Error fetching doctors"));
    }
  }

  async fetchDoctorsAndAvailabilities(request: any, response: Response) {
    try {
      const doctors = await DoctorsService.fetchDoctorsAndAvailabilities();
      if (doctors)
        return response
          .status(200)
          .json(Util.success(doctors, "doctors fetched successfully"));
    } catch (error: unknown) {
      response
        .status(500)
        .json(Util.error({ error }, "Error fetching doctors"));
    }
  }

  async getPatientDoctors(request: any, response: Response) {
    try {
      const { id } = request.user;
      const doctors = await DoctorsService.fetchPatientDoctors(id);
      if (doctors)
        return response
          .status(200)
          .json(Util.success(doctors, "Doctors fetched successfully"));
    } catch (error: unknown) {
      if (error instanceof Error) {
        return response.status(500).json(Util.error({ error }, error.message));
      }
      return response
        .status(500)
        .json(Util.error({ error }, "Error fetching doctors"));
    }
  }
}

export default new DoctorsHandler();
