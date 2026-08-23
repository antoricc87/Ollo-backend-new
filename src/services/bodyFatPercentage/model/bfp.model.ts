import moment from "moment";
import prisma from "../../../utility/prismaClient";

class BFPService {
  // create main bfp tracker
  async createMainBFPTracker(patientId: string) {
    try {
      //check for existing main tracker
      const existingBFPTracker = await prisma.bFPTracker.findUnique({
        where: { userId: patientId },
      });
      // return existing tracker if exists
      if (existingBFPTracker) return existingBFPTracker;
      //if does not exist crearte a and return new tracker
      const bfpTracker = await prisma.bFPTracker.create({
        data: { userId: patientId },
      });
      return bfpTracker;
    } catch (error: unknown) {
      console.error("Something went wrong creating the tracker", error);
      throw error;
    }
  }

  //create bfp Entry
  async createBFPEntry(patientId: string, bfp: number) {
    try {
      // fetch the main bfp tracker for reference
      const mainBFPTracker = await this.createMainBFPTracker(patientId);
      // create the date to enter
      const date = moment().format("MM-DD-YYYY");
      // check if existing entry has been created
      const bfpEntry = await prisma.bFPEntry.findFirst({
        where: { trackerId: mainBFPTracker.id, createdAt: date },
      });
      if (bfpEntry) {
        const patienSummary = await prisma.patientSummary.findUnique({
          where: { patientId: patientId },
        });
        await prisma.vitalsSummary.update({
          where: { patientSummaryId: patienSummary.id },
          data: { bfp: bfp },
        });
        return await prisma.bFPEntry.update({
          where: { id: bfpEntry.id },
          data: { percentage: bfp },
        });
      } else {
        return await prisma.bFPEntry.create({
          data: {
            percentage: bfp,
            trackerId: mainBFPTracker.id,
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
  async deleteBFPEntry(entryId: string) {
    try {
      return await prisma.bFPEntry.delete({
        where: { id: entryId },
      });
    } catch (error: unknown) {
      console.error("Error deleting the entry", error);
      throw error;
    }
  }

  //fetch bfp tracker
  async getBFPTracker(patientId: string) {
    try {
      const bfpTracker = await prisma.bFPTracker.findUnique({
        where: { userId: patientId },
        include: {
          BFPEntries: true,
        },
      });
      if (bfpTracker) {
        const sortedBFPEntries = bfpTracker.BFPEntries.sort((a, b) => {
          const dateA = new Date(a.createdAt);
          const dateB = new Date(b.createdAt);
          return dateA.getTime() - dateB.getTime(); // Sorting in descending order
        });
        const sortedBFPTracker = {
          ...bfpTracker,
          BFPEntries: sortedBFPEntries,
        };
        return sortedBFPTracker;
      }
      return [];
    } catch (error: unknown) {
      console.error("Error fetching the tracker", error);
      throw error;
    }
  }
}

export default new BFPService();
