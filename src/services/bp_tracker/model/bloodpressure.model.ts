import moment from "moment";
import prisma from "../../../utility/prismaClient";
import { getCurrentWeekRangeFromDate } from "../../../utils/formatDate";

class BloodPressureService {
  async findOrCreateMainBPTracker(patientId: string) {
    try {
      const existingBPTracker = await prisma.bloodPressureTracker.findUnique({
        where: { userId: patientId },
      });
      if (existingBPTracker) return existingBPTracker;

      return await prisma.bloodPressureTracker.create({
        data: { userId: patientId },
      });
    } catch (error: unknown) {
      console.error("Error creating main BP tracker", error);
      throw error;
    }
  }

  async findOrCreateWeeklyBPTracker(patientId: string, date: string) {
    try {
      const { start, end } = getCurrentWeekRangeFromDate(date);
      const existingWeeklyTracker = await prisma.weeklyBloodPressure.findFirst({
        where: { userId: patientId, weekStartDate: start, weekEndDate: end },
      });
      if (existingWeeklyTracker) return existingWeeklyTracker;

      const mainBPTracker = await this.findOrCreateMainBPTracker(patientId);
      return await prisma.weeklyBloodPressure.create({
        data: {
          userId: patientId,
          weekStartDate: start,
          weekEndDate: end,
          trackerId: mainBPTracker.id,
        },
      });
    } catch (error: unknown) {
      console.error("Error creating weekly BP tracker", error);
      throw error;
    }
  }

  async findOrCreateDailyBPTracker(patientId: string, date: string) {
    try {
      const formattedDate = moment(date).format("MM-DD-YYYY");
      const existingDailyTracker = await prisma.dailyBloodPressure.findFirst({
        where: { userId: patientId, date: formattedDate },
      });
      if (existingDailyTracker) return existingDailyTracker;

      const weeklyBPTracker = await this.findOrCreateWeeklyBPTracker(
        patientId,
        date
      );
      return await prisma.dailyBloodPressure.create({
        data: {
          userId: patientId,
          date: formattedDate,
          weeklyTrackerId: weeklyBPTracker.id,
          trackerId: weeklyBPTracker.trackerId,
        },
      });
    } catch (error: unknown) {
      console.error("Error creating daily BP tracker", error);
      throw error;
    }
  }

  async fetchDailyBPTracker(patientId: string) {
    try {
      const tracker = await prisma.bloodPressureTracker.findUnique({
        where: { userId: patientId },
        include: {
          dailyEntries: {
            include: { bpEntries: { orderBy: { createdAt: "asc" } } },
          },
        },
      });
      if (tracker) {
        tracker.dailyEntries.sort((a, b) => {
          return new Date(b.date).getTime() - new Date(a.date).getTime();
        });
        return tracker;
      }
    } catch (error: unknown) {
      console.error("Error fetching daily BP tracker", error);
      throw error;
    }
  }

  async fetchWeeklyBPTracker(patientId: string) {
    try {
      return await prisma.bloodPressureTracker.findUnique({
        where: { userId: patientId },
        include: {
          weeklyEntries: {
            orderBy: { weekEndDate: "desc" },
            include: {
              dailyEntries: {
                include: { bpEntries: { orderBy: { createdAt: "desc" } } },
              },
            },
          },
        },
      });
    } catch (error: unknown) {
      console.error("Error fetching weekly BP tracker", error);
      throw error;
    }
  }
  async fetchSpecificNumberOfWeeks(patientId: string, timeFrame: number) {
    try {
      const mainTracker = await this.fetchWeeklyBPTracker(patientId);

      // Filter the weeklyEntries based on the timeframe
      const filteredWeeklyEntries = mainTracker.weeklyEntries
        .slice(0, timeFrame) // Get only the first `timeFrame` weeks
        .map((entry: any) => {
          // For each weekly entry, restructure it to only include daily glucose measurements
          const weeklyData = {
            weekStartDate: entry.weekStartDate,
            weekEndDate: entry.weekEndDate,
            dailyEntries: entry.dailyEntries.map((dailyEntry: any) =>
              dailyEntry.bpEntries.map((bpEntry: any) => ({
                systolic: bpEntry.systolic,
                diastolic: bpEntry.diastolic,
                createdAt: bpEntry.createdAt,
              }))
            ),
          };
          return weeklyData;
        });

      // Return the restructured tracker with the filtered weekly entries
      return {
        ...mainTracker,
        weeklyEntries: filteredWeeklyEntries,
      };
    } catch (error: unknown) {
      console.error("Error fetching the tracker", error);
    }
  }

  async createBPEntry(
    patientId: string,
    date: string,
    systolic: number,
    diastolic: number,
    pulse?: number
  ) {
    try {
      const dailyBPTracker = await this.findOrCreateDailyBPTracker(
        patientId,
        date
      );
      return await prisma.bloodPressureEntry.create({
        data: {
          systolic,
          diastolic,
          pulse,
          createdAt: date,
          dailyTrackerId: dailyBPTracker.id,
        },
      });
    } catch (error: unknown) {
      console.error("Error creating BP entry", error);
      throw error;
    }
  }

  async deleteBPEntry(entryId: string) {
    try {
      return await prisma.bloodPressureEntry.delete({
        where: { id: entryId },
      });
    } catch (error: unknown) {
      console.error("Error deleting BP entry", error);
      throw error;
    }
  }
}

export default new BloodPressureService();
