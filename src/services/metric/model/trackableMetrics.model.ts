import prisma from "../../../utility/prismaClient";
import { getLocalDate } from "../../../utils/formatDate";

class TrackableMetricService {
  // Get trackable metrics by healthGoalId
  async getTrackableMetrics(where: any) {
    try {
      return await prisma.trackableMetric.findMany({
        where: where,
        include: { metricEntries: true }, // Include entries for each trackable metric
      });
    } catch (error: any) {
      console.error(
        "Something went wrong fetching the trackable metrics",
        error
      );
      throw error;
    }
  }

  // get trackableMetrics related to DIET
  async getDietaryTrackableMetrics(patientId: string) {
    try {
      const metrics = await prisma.trackableMetric.findMany({
        where: {
          patientId: patientId,
          NOT: {
            status: {
              in: ["ACHIEVED", "NOT_ACHIEVED"],
            },
          },
          category: { in: ["DIET"] },
        },
      });
      return metrics;
    } catch (error: unknown) {
      console.error("Error fetching the metrics");
      throw error;
    }
  }

  // Create a trackable metric
  async createTrackableMetric(data: any) {
    try {
      return await prisma.trackableMetric.create({
        data: {
          healthGoalId: data.healthGoalId,
          description: data.description,
          targetValue: data.targetValue,
          currentValue: data.currentValue,
          unit: data.unit,
          value: data.value,
          category: data.category,
          frequency: data.frequency,
          reviewDate: data.reviewDate,
          patientId: data.patientId,
        },
      });
    } catch (error: any) {
      console.error("Error creating the trackable metric", error);
      throw error;
    }
  }

  // Update a trackable metric
  async updateTrackableMetric(id: string, data: any) {
    try {
      return await prisma.trackableMetric.update({
        where: { id: id },
        data: {
          description: data.description,
          targetValue: data.targetValue,
          currentValue: data.currentValue,
          unit: data.unit,
          category: data.category,
          frequency: data.frequency,
          reviewDate: data.reviewDate,
        },
      });
    } catch (error: any) {
      console.error("Error updating the trackable metric", error);
      throw error;
    }
  }

  // Delete a trackable metric
  async deleteTrackableMetric(id: string) {
    try {
      return await prisma.trackableMetric.delete({
        where: { id: id },
      });
    } catch (error: any) {
      console.error("Error deleting the trackable metric", error);
      throw error;
    }
  }

  //------------------metric entries related------------------------//

  async createMetricEntry(data: any) {
    try {
      const entry = await prisma.metricEntry.create({
        data: {
          trackableMetricId: data.trackableMetricId,
          value: data.value,
          entryDate: getLocalDate(new Date()),
        },
      });
      return entry;
    } catch (error: unknown) {
      console.error("Error creating the entry");
      throw error;
    }
  }
}

export default new TrackableMetricService();
