import moment from "moment";
import prisma from "../../../utility/prismaClient";
import { getCurrentWeekRange, getLocalDate } from "../../../utils/formatDate";
import { ExercisesTrackerWhereUniqueInput } from "../../../types";
import CaloriesService from "../../calories_tracker/model/calories.model";
class ExercisesService {
  // Create main exercises tracker
  async createTracker(userId: string) {
    try {
      const existingTracker = await prisma.exerciseTracker.findUnique({
        where: { userId: userId },
      });

      if (existingTracker) return existingTracker;

      const tracker = await prisma.exerciseTracker.create({
        data: { userId },
      });

      return tracker;
    } catch (error) {
      console.error("Error creating the exercises tracker", error);
      throw error;
    }
  }
  // Create daily exercises tracker
  async createDailyTracker(
    userId: string,
    minutesOfExercise: number,
    timeZone?: string
  ) {
    try {
      let mainTracker = await prisma.exerciseTracker.findUnique({
        where: { userId: userId },
      });
      if (!mainTracker) mainTracker = await this.createTracker(userId);

      const startOfDay = moment()
        .tz(timeZone)
        .startOf("day")
        .format("YYYY-MM-DDTHH:mm:ss.SSSZ");
      const endOfDay = moment()
        .tz(timeZone)
        .endOf("day")
        .format("YYYY-MM-DDTHH:mm:ss.SSSZ");
      const existingDailyTracker = await prisma.dailyExercise.findFirst({
        where: {
          trackerId: mainTracker.id,
          date: { gte: startOfDay, lte: endOfDay },
        },
      });

      if (existingDailyTracker) return existingDailyTracker;

      const dailyTracker = await prisma.dailyExercise.create({
        data: {
          userId: userId,
          minutesOfExercise,
          date: startOfDay,
          trackerId: mainTracker.id,
        },
      });

      return dailyTracker;
    } catch (error) {
      console.error("Error creating the daily tracker", error);
      throw error;
    }
  }
  // Create weekly exercises tracker
  async createWeeklyTracker(userId: string, minutesOfExercise: number) {
    try {
      const mainTracker = await prisma.exerciseTracker.findUnique({
        where: { userId: userId },
        include: { weeklyEntries: true }, // Include weekly entries for validation
      });

      if (!mainTracker) throw new Error("Main tracker not found for the user.");

      const { start: startOfWeek, end: endOfWeek } = getCurrentWeekRange();

      const existingWeeklyTracker = await prisma.weeklyExercise.findFirst({
        where: {
          trackerId: mainTracker.id,
          weekStartDate: {
            gte: startOfWeek,
            lt: endOfWeek,
          },
        },
      });

      if (existingWeeklyTracker) return existingWeeklyTracker;

      const weeklyTracker = await prisma.weeklyExercise.create({
        data: {
          userId,
          weekStartDate: startOfWeek,
          weekEndDate: endOfWeek,
          minutesOfExercise: minutesOfExercise,
          trackerId: mainTracker.id,
        },
      });

      return weeklyTracker;
    } catch (error) {
      console.error("Error creating the weekly tracker", error);
      throw error;
    }
  }
  // Get weekly Exercises tracker
  async getWeeklyExercisesTracker(where: ExercisesTrackerWhereUniqueInput) {
    try {
      return await prisma.exerciseTracker.findUnique({
        where: where,
        include: { weeklyEntries: { orderBy: { weekEndDate: "desc" } } },
      });
    } catch (error: any) {
      console.error("Something went wrong fetching the tracker", error);
      throw error;
    }
  }
  // Get weekly and daily exercises tracker
  async getWeeklyAndDailyExercisesTracker(
    where: ExercisesTrackerWhereUniqueInput
  ) {
    try {
      return await prisma.exerciseTracker.findUnique({
        where: where,
        include: { dailyEntries: true, weeklyEntries: true },
      });
    } catch (error: any) {
      console.error("Something went wrong fetching the tracker", error);
      throw error;
    }
  }
  // get specific exercises weekly tracker by date
  async getWeeklyExercisesTrackerByDates(
    userId: string,
    weekStartDate: string,
    weekEndDate: string
  ) {
    try {
      const tracker = await prisma.weeklyExercise.findFirst({
        where: {
          userId: userId,
          //   weekStartDate: weekStartDate,
          weekStartDate: { gte: weekStartDate, lte: weekEndDate },
          weekEndDate: weekEndDate,
        },
        select: {
          id: true,
          minutesOfExercise: true,
          weekEndDate: true,
          weekStartDate: true,
        },
      });
      return tracker;
    } catch (error: unknown) {
      console.warn("Error fetching weekly tracker");
      throw error;
    }
  }
  // updating or creating weekly exercise tracker
  async updateOrCreateWeeklyExercisesTracker(
    userId: string,
    minutesOfExercise: number,
    weekStartDate: string,
    weekEndDate: string
  ) {
    try {
      const tracker = await this.getWeeklyExercisesTrackerByDates(
        userId,
        weekStartDate,
        weekEndDate
      );
      if (tracker === null) {
        // check if main tracker for exercises exists, if no create it
        const mainExercisesTracker = await this.createTracker(userId);
        await prisma.weeklyExercise.create({
          data: {
            userId: userId,
            minutesOfExercise: minutesOfExercise,
            trackerId: mainExercisesTracker.id,
            weekEndDate: weekEndDate,
            weekStartDate: weekStartDate,
          },
        });
      } else {
        await prisma.weeklyExercise.update({
          where: { id: tracker.id },
          data: {
            minutesOfExercise: minutesOfExercise,
          },
        });
      }
    } catch (error: unknown) {
      console.warn("Error updating or creating the exercises tracker", error);
      throw error;
    }
  }
  // Update weekly exercises and calories trackers with Apple Health Kit data
  async updateWeeklyExercisesAndCalories(userId: string, entries: any) {
    try {
      for (let entry of entries) {
        try {
          const {
            weekStartDate,
            weekEndDate,
            minutesOfExercise,
            caloriesBurned,
          } = entry;

          await this.updateOrCreateWeeklyExercisesTracker(
            userId,
            minutesOfExercise,
            weekStartDate,
            weekEndDate
          );
          await CaloriesService.updateOrCreateWeeklyCaloriesTracker(
            userId,
            caloriesBurned,
            weekStartDate,
            weekEndDate
          );
        } catch (error) {
          console.warn("Error updating the weekly tracker", error);
          throw error;
        }
      }
      return true;
    } catch (error: unknown) {
      console.warn("Error updating the trackers", error);
      throw error;
    }
  }
}
export default new ExercisesService();
