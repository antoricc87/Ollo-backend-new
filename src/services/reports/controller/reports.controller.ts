import { Response, Request } from "express";
import { Util } from "../../../utils/response";
import ReportsService from "../model/reports.model";
import { ObjectId } from "../../../utils/idValidation";
class ReportsHandler {
  async generateWeeklyReport(request: any, response: Response) {
    const { id } = request.user;
    const {
      hrv,
      hrv_baseline,
      heart_rate,
      heart_rate_baseline,
      resting_heart_rate,
      resting_heart_rate_baseline,
      workouts,
      sleep,
      steps,
      minutes_exercising,
    } = request.body;
    try {
      const report = await ReportsService.generateWeeklyReport(
        id,
        hrv,
        hrv_baseline,
        heart_rate,
        heart_rate_baseline,
        resting_heart_rate,
        resting_heart_rate_baseline,
        workouts,
        sleep,
        steps,
        minutes_exercising
      );
      if (report)
        return response
          .status(200)
          .json(Util.success(report, "Report successfully generated"));
    } catch (error: unknown) {
      return response
        .status(500)
        .json(Util.error({ error }, "Error generating the report"));
    }
  }
  async fetchPatientReports(request: any, response: Response) {
    const { id } = request.user;
    const whereClause = { userId: id };
    try {
      const reports = await ReportsService.fetchReportsWhere(whereClause);
      if (reports) {
        return response
          .status(200)
          .json(Util.success(reports, "Reports fetched successfully"));
      }
    } catch (error: unknown) {
      return response
        .status(400)
        .json(Util.error({ error }, "Error fetching the reports"));
    }
  }
  async deleteReportById(request: Request, response: Response) {
    const { reportId } = request.body;
    if (!ObjectId.isValid(reportId) || !reportId)
      return response
        .status(404)
        .json(
          Util.error({}, "Report id is required and must be a valid object id")
        );
    try {
      const reportDeleted = await ReportsService.deleteReportById(reportId);
      if (reportDeleted) {
        return response
          .status(200)
          .json(Util.success(reportDeleted, "Report deleted successfully"));
      }
    } catch (error: unknown) {
      return response
        .status(400)
        .json(Util.error({ error }, "Error deleting the report"));
    }
  }
  // monthly patient checkup report
  async generateCheckupReport(request: Request, response: Response) {
    const { patientId } = request.body;
    if (!patientId)
      return response
        .status(400)
        .json(Util.error({}, "Patient id is required"));
    try {
      const checkup = await ReportsService.generateAndSaveCheckupReport(
        patientId
      );
      if (checkup) {
        return response
          .status(201)
          .json(Util.success(checkup, "Checkup successfully generated"));
      }
    } catch (error: unknown) {
      return response
        .status(500)
        .json(
          Util.error({ error }, "Something went wrong creating the report")
        );
    }
  }
}
export default new ReportsHandler();
