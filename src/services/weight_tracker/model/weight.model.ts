import moment from "moment";
import prisma from "../../../utility/prismaClient";

class WeightService {
  // create main weight tracker
  async createMainWeightTracker(patientId: string) {
    try {
      //check for existing main tracker
      const existingWeightTracker = await prisma.weightTracker.findUnique({
        where: { userId: patientId },
      });
      // return existing tracker if exists
      if (existingWeightTracker) return existingWeightTracker;
      //if does not exist crearte a and return new tracker
      const weightTracker = await prisma.weightTracker.create({
        data: { userId: patientId },
      });
      return weightTracker;
    } catch (error: unknown) {
      console.error("Something went wrong creating the tracker", error);
      throw error;
    }
  }

  //create weightEntry
  async createWeightEntry(patientId: string, weight: number, unit: string) {
    try {
      // fetch the main weight tracker for reference
      const mainWeightTracker = await this.createMainWeightTracker(patientId);
      // create the date to enter
      const date = moment().format("MM-DD-YYYY");
      // check if existing entry has been created
      const weightEntry = await prisma.weightEntry.findFirst({
        where: { trackerId: mainWeightTracker.id, createdAt: date },
      });
      if (weightEntry) {
        const patienSummary = await prisma.patientSummary.findUnique({
          where: { patientId: patientId },
        });
        await prisma.vitalsSummary.update({
          where: { patientSummaryId: patienSummary.id },
          data: { weight: weight, weight_unit: unit },
        });
        return await prisma.weightEntry.update({
          where: { id: weightEntry.id },
          data: { weight: weight, unit: unit },
        });
      } else {
        return await prisma.weightEntry.create({
          data: {
            weight: weight,
            unit: unit,
            trackerId: mainWeightTracker.id,
            createdAt: date,
          },
        });
      }
    } catch (error: unknown) {
      console.error("Error creating the entry", error);
      throw error;
    }
  }

  //delete weightEntry
  async deleteWeightEntry(entryId: string) {
    try {
      return await prisma.weightEntry.delete({
        where: { id: entryId },
      });
    } catch (error: unknown) {
      console.error("Error deleting the entry", error);
      throw error;
    }
  }

  //fetch weight tracker
  async getWeigthTracker(patientId: string) {
    try {
      const weightTracker = await prisma.weightTracker.findUnique({
        where: { userId: patientId },
        include: {
          weightEntries: true,
        },
      });
      if (weightTracker) {
        const sortedWeightEntries = weightTracker.weightEntries.sort((a, b) => {
          const dateA = new Date(a.createdAt);
          const dateB = new Date(b.createdAt);
          return dateA.getTime() - dateB.getTime(); // Sorting in descending order
        });
        const sortedWeightTracker = {
          ...weightTracker,
          weightEntries: sortedWeightEntries,
        };
        return sortedWeightTracker;
      }
      return [];
    } catch (error: unknown) {
      console.error("Error fetching the tracker", error);
      throw error;
    }
  }
}

export default new WeightService();
