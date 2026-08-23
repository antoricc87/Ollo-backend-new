import { Request, Response } from "express";
import HealthGoalService from "../model/healthGoals.model";
import { Util } from "../../../utils/response";
import { ObjectId } from "../../../utils/idValidation";

export class HealthGoalHandler {
  //fetch health goal by id
  async getHealthGoalById(request: Request, response: Response) {
    const { healthGoalId, date } = request.body;
    if (!healthGoalId || !date)
      return response
        .status(500)
        .json(Util.error({}, "Date and healthgoal id are required"));
    try {
      const goal = await HealthGoalService.getHealthGoalById(
        healthGoalId,
        date
      );
      if (goal) {
        return response
          .status(200)
          .json(Util.success(goal, "Goal fetched successfully"));
      }
    } catch (error: unknown) {
      return response
        .status(400)
        .json(Util.error({ error }, "Error fetching the goal"));
    }
  }

  // Fetch health goals by visitId or patientId
  async getHealthGoals(request: Request, response: Response) {
    const { visitId, patientId } = request.body;

    // Ensure at least one of visitId or patientId is provided
    if (!visitId && !patientId) {
      return response
        .status(400)
        .json(Util.error({}, "Either visitId or patientId must be provided"));
    }

    try {
      // Dynamically create the where filter
      const where = visitId ? { visitId } : { patientId }; // Query either by visitId or patientId

      // Fetch health goals from the service
      const healthGoals = await HealthGoalService.getHealthGoals(where);

      if (healthGoals && healthGoals.length > 0) {
        // If health goals are found
        return response
          .status(200)
          .json(Util.success(healthGoals, "Health goals successfully fetched"));
      } else {
        // If no health goals are found
        return response
          .status(404)
          .json(Util.error({}, "No health goals found"));
      }
    } catch (error: any) {
      // Handle any errors during the fetch process
      console.error("Error fetching the health goals", error);
      return response
        .status(500)
        .json(Util.error({ error }, "Error fetching the health goals"));
    }
  }

  //Fetch in progress health goals
  async getInProgressHealthGoals(request: any, response: Response) {
    const { patientId } = request.body;
    // const { patientId } = request.user.id;
    if (!patientId)
      return response
        .status(500)
        .json(Util.error({}, "Patiend Id is are reuired"));
    try {
      const healthGoals = await HealthGoalService.getInProgressHealthGoals(
        patientId
      );

      if (healthGoals) {
        return response
          .status(200)
          .json(Util.success(healthGoals, "Health goals successfully fetched"));
      } else {
        return response
          .status(404)
          .json(Util.error({}, "No health goals found"));
      }
    } catch (error: any) {
      console.error("Error fetching the health goals", error);
      return response
        .status(400)
        .json(Util.error({ error }, "Error fetching the health goals"));
    }
  }

  // Create a new health goal with patientId
  async createHealthGoal(request: Request, response: Response) {
    const { patientId, visitId, description, status, reviewDate } =
      request.body;

    try {
      const newHealthGoal = await HealthGoalService.createHealthGoal({
        patientId,
        visitId,
        description,
        status,
        reviewDate,
      });
      return response
        .status(201)
        .json(Util.success(newHealthGoal, "Health goal successfully created"));
    } catch (error: any) {
      console.error("Error creating the health goal", error);
      return response
        .status(400)
        .json(Util.error({ error }, "Error creating the health goal"));
    }
  }
  async createHealthGoalWithMetrics(request: Request, response: Response) {
    const { healthGoal, data } = request.body;

    try {
      const newHealthGoal = await HealthGoalService.createHealthGoalWithMetrics(
        healthGoal,
        data
      );
      return response
        .status(201)
        .json(Util.success(newHealthGoal, "Health goal successfully created"));
    } catch (error: any) {
      console.error("Error creating the health goal", error);
      return response
        .status(400)
        .json(Util.error({ error }, "Error creating the health goal"));
    }
  }

  // Update a health goal
  async updateHealthGoal(request: Request, response: Response) {
    const { id, description, status, reviewDate, patientId } = request.body;
    try {
      const updatedHealthGoal = await HealthGoalService.updateHealthGoal(id, {
        description,
        status,
        reviewDate,
        patientId, // Optionally update patientId
      });
      return response
        .status(200)
        .json(
          Util.success(updatedHealthGoal, "Health goal successfully updated")
        );
    } catch (error: any) {
      console.error("Error updating the health goal", error);
      return response
        .status(400)
        .json(Util.error({ error }, "Error updating the health goal"));
    }
  }

  // Delete a health goal
  async deleteHealthGoal(request: Request, response: Response) {
    const { id } = request.params;
    try {
      const deletedHealthGoal = await HealthGoalService.deleteHealthGoal(id);
      return response
        .status(200)
        .json(
          Util.success(deletedHealthGoal, "Health goal successfully deleted")
        );
    } catch (error: any) {
      console.error("Error deleting the health goal", error);
      return response
        .status(400)
        .json(Util.error({ error }, "Error deleting the health goal"));
    }
  }

  // generate health goals from mobile app
  async generateHealthGoalsMobile(request: Request, response: Response) {
    const { patientSummary, goals } = request.body;
    if (!patientSummary)
      return response
        .status(400)
        .json(Util.error({}, "Patient id is required"));
    try {
      const healthGoals = await HealthGoalService.mobileGenerateHealthGoals(
        patientSummary,
        goals
      );
      if (healthGoals)
        return response
          .status(200)
          .json(
            Util.success(healthGoals, "Health goals successfully generated")
          );
    } catch (error: unknown) {
      return response
        .status(500)
        .json(Util.error({ error }, "Error generating health goals"));
    }
  }
  // generate trackable health goals
  async generateTrackableHealthGoals(request: Request, response: Response) {
    const { patientId, goals, targetValue, startingValue, endDate } =
      request.body;
    if (!patientId || goals.length === 0)
      return response
        .status(400)
        .json(Util.error({}, "Patient id and goals are required"));
    try {
      const healthGoals = await HealthGoalService.generateTrackableHealthGoals(
        patientId,
        goals,
        targetValue,
        startingValue,
        endDate
      );
      if (healthGoals)
        return response
          .status(200)
          .json(
            Util.success(healthGoals, "Health goals successfully generated")
          );
    } catch (error: unknown) {
      console.log(error);
      return response
        .status(500)
        .json(Util.error({ error }, "Error generating health goals"));
    }
  }
  async generateTrackableWellnessGoals(request: Request, response: Response) {
    const { patientId, goals, targetValue, startingValue, endDate } =
      request.body;
    if (!patientId || goals.length === 0)
      return response
        .status(400)
        .json(Util.error({}, "Patient id and goals are required"));
    try {
      const healthGoals = await HealthGoalService.generateTrackableWellnessGoal(
        patientId,
        goals,
        targetValue,
        startingValue,
        endDate
      );
      if (healthGoals)
        return response
          .status(200)
          .json(
            Util.success(healthGoals, "Health goals successfully generated")
          );
    } catch (error: unknown) {
      console.log(error);
      return response
        .status(500)
        .json(Util.error({ error }, "Error generating health goals"));
    }
  }
  // generate main health goals
  async generateMainHealthGoal(request: Request, response: Response) {
    const { patientId } = request.body;
    if (!patientId || !ObjectId.isValid(patientId))
      return response
        .status(400)
        .json(
          Util.error({}, "Patient id is required and must be a valid object id")
        );
    try {
      const healthGoals = await HealthGoalService.generateMainHealthGoal(
        patientId
      );
      if (healthGoals)
        return response
          .status(200)
          .json(
            Util.success(healthGoals, "Health goals successfully generated")
          );
    } catch (error: unknown) {
      return response
        .status(500)
        .json(Util.error({ error }, "Error generating health goals"));
    }
  }

  // calculate caloric amount
  async generateCaloricAmount(request: Request, response: Response) {
    const { patientData } = request.body;
    if (!patientData)
      return response
        .status(500)
        .json(Util.error({}, "PatientData is required"));
    try {
      const caloricAmount = await HealthGoalService.calculateCaloricAmount(
        JSON.stringify(patientData)
      );

      return response
        .status(200)
        .json(Util.success(caloricAmount, "Amount successfully generated"));
    } catch (error: unknown) {
      return response
        .status(500)
        .json(Util.error({ error }, "Error calculating the amount"));
    }
  }

  // generate medical report based on patient medical data and health goals progression
  async generateMonthlyMedicalReport(request: Request, response: Response) {
    const { patientId } = request.body;
    if (!patientId || !ObjectId.isValid(patientId)) {
      return response
        .status(404)
        .json(Util.error({}, "Patient id and patient Summary are required"));
    }
    try {
      const report = await HealthGoalService.generateMonthlyMedicalReport(
        patientId
      );
      if (report)
        return response
          .status(200)
          .json(Util.success(report, "Re[port successfully generated"));
    } catch (error: unknown) {
      return response
        .status(500)
        .json(Util.error({ error }, "Erro generating the medical report"));
    }
  }
}

export default new HealthGoalHandler();
