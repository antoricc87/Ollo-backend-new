import moment from "moment";
import prisma from "../../../utility/prismaClient";
import { getCurrentWeekRangeFromDate } from "../../../utils/formatDate";

class GlucoseService {
  //create main glucose tracker
  async findOrCreateMainGlucoseTracker(patientId: string) {
    try {
      //check for existing main tracker
      const existingGlucoseTracker = await prisma.glucoseTracker.findUnique({
        where: { userId: patientId },
      });
      // return existing tracker if exists
      if (existingGlucoseTracker) return existingGlucoseTracker;
      //if does not exist crearte a and return new tracker
      const glucoseTracker = await prisma.glucoseTracker.create({
        data: { userId: patientId },
      });
      return glucoseTracker;
    } catch (error: unknown) {
      console.error("Something went wrong creating the tracker", error);
      throw error;
    }
  }
  //find or create weekly tracker
  async findOrCreateWeeklyGlycoseTracker(patientId: string, date: string) {
    try {
      const { start, end } = getCurrentWeekRangeFromDate(date);
      // fetching existing weekly Tracker
      const existingWeeklyTracker = await prisma.weeklyGlucose.findFirst({
        where: {
          userId: patientId,
          weekStartDate: start,
          weekEndDate: end,
        },
      });
      if (!existingWeeklyTracker) {
        //fetch the main glucose tracker
        const mainGlucoseTracker = await this.findOrCreateMainGlucoseTracker(
          patientId
        );
        //create and return new tracker
        return await prisma.weeklyGlucose.create({
          data: {
            userId: patientId,
            weekEndDate: end,
            weekStartDate: start,
            trackerId: mainGlucoseTracker.id,
          },
        });
      } else {
        return existingWeeklyTracker;
      }
    } catch (error: unknown) {
      console.error(
        "Something went wrong creating or fetching the tracker",
        error
      );
      throw error;
    }
  }
  //create daily glucose tracker
  async findOrCreateDailyGlucoseTracker(patientId: string, date: string) {
    try {
      //try to fecth existing daily tracker
      const dateMMDDYYY = moment(date).format("MM-DD-YYYY");
      const existingDailyTracker = await prisma.dailyGlucose.findFirst({
        where: {
          userId: patientId,
          date: dateMMDDYYY,
        },
      });
      if (!existingDailyTracker) {
        //fetch or create the weekly glucose tracker
        const existingWeeklyTracker =
          await this.findOrCreateWeeklyGlycoseTracker(patientId, date);
        //create daily tracker
        return await prisma.dailyGlucose.create({
          data: {
            userId: patientId,
            date: dateMMDDYYY,
            weeklyTrackerId: existingWeeklyTracker.id,
            trackerId: existingWeeklyTracker.trackerId,
          },
        });
      } else {
        return existingDailyTracker;
      }
    } catch (error: unknown) {
      console.error("Error createing the daily tracker", error);
      throw error;
    }
  }
  //fetch glucose tracker with daily entries only
  async fetchDailyGlucoseTracker(patientId: string) {
    try {
      const tracker = await prisma.glucoseTracker.findUnique({
        where: { userId: patientId },
        include: {
          dailyEntries: {
            include: {
              glucoseEntries: { orderBy: { createdAt: "asc" } },
            },
          },
        },
      });
      if (tracker) {
        const sortedDailyEntries = tracker.dailyEntries.sort((a, b) => {
          const dateA = new Date(a.date);
          const dateB = new Date(b.date);
          return dateB.getTime() - dateA.getTime(); // Sorting in descending order
        });
        return {
          ...tracker,
          dailyEntries: sortedDailyEntries,
        };
      }
    } catch (error: unknown) {
      console.log("Erro fetching glucose tracker", error);
      throw error;
    }
  }
  //fetch glucose tracker with weekly and daily entries
  async fetchWeeklyGlucoseTracker(patientId: string) {
    try {
      const tracker = await prisma.glucoseTracker.findUnique({
        where: { userId: patientId },
        include: {
          weeklyEntries: {
            orderBy: { weekEndDate: "desc" },
            include: {
              dailyEntries: {
                include: {
                  glucoseEntries: { orderBy: { createdAt: "desc" } },
                },
              },
            },
          },
        },
      });
      if (tracker) return tracker;
    } catch (error: unknown) {
      console.log("Erro fetching glucose tracker", error);
      throw error;
    }
  }
  // create glucose entry
  async createGlucoseEntry(patientId: string, date: string, value: number) {
    try {
      // fetch daily glucose entry
      const dailyGlucoseTracker = await this.findOrCreateDailyGlucoseTracker(
        patientId,
        date
      );
      // create glucose entry
      return await prisma.glucoseEntry.create({
        data: {
          value: value,
          createdAt: date,
          dailyTrackerId: dailyGlucoseTracker.id,
        },
      });
    } catch (error: unknown) {
      console.error("Error creating the glucose entry", error);
      throw error;
    }
  }
  //delete glucose entry
  async deleteGlucoseEntry(entryid: string) {
    try {
      return await prisma.glucoseEntry.delete({
        where: { id: entryid },
      });
    } catch (error: unknown) {
      console.error("Error deleting glucose entry", error);
      throw error;
    }
  }
  // fetch specific numbers ow glucose week entries
  async fetchSpecificNumberOfWeeks(patientId: string, timeFrame: number) {
    try {
      const mainTracker = await this.fetchWeeklyGlucoseTracker(patientId);

      // Filter the weeklyEntries based on the timeframe
      const filteredWeeklyEntries = mainTracker.weeklyEntries
        .slice(0, timeFrame) // Get only the first `timeFrame` weeks
        .map((entry: any) => {
          // For each weekly entry, restructure it to only include daily glucose measurements
          const weeklyData = {
            weekStartDate: entry.weekStartDate,
            weekEndDate: entry.weekEndDate,
            dailyEntries: entry.dailyEntries.map((dailyEntry: any) =>
              dailyEntry.glucoseEntries.map((glucoseEntry: any) => ({
                value: glucoseEntry.value,
                createdAt: glucoseEntry.createdAt,
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
}

export default new GlucoseService();
