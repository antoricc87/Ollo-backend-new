import { jobQueue } from "../config/jobQueque";
import { PrismaClient } from "@prisma/client";
import { JobsOptions, Repeat } from "bullmq";

import moment from "moment";
import { MealType } from "../../types";

const prisma = new PrismaClient();
const timeZones = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
];
export const getPatientsWithNoLoggedFood = async (mealType: MealType) => {
  const patientsWithTokens: {
    id: string;
    timeZone: string;
    fcmToken: string;
  }[] = [];

  // Get today's date at 13:00:00 using moment

  // Fetch patients along with their FCM tokens in one query
  const patients = await prisma.patient.findMany({});

  for (const patient of patients) {
    // Check if the patient has logged any food today
    const today = moment
      .tz(patient.timeZone)
      .startOf("day")
      .format("YYYY-MM-DDTHH:mm:ss.SSS[+00:00]");
    const todayFoodEntries = await prisma.dailyFood.findMany({
      where: {
        userId: patient.id,
        date: today,
      },
      include: {
        foodEntries: true,
      },
    });

    // If no food entries for the specified meal type exist, or if all entries have no food logged, add to list
    const patientFCMToken = await prisma.userFCMToken.findUnique({
      where: { userId: patient.id },
    });
    const isMealLogged = todayFoodEntries.some((entry) =>
      entry.foodEntries.some((foodEntry) => foodEntry.mealType === mealType)
    );

    if (patientFCMToken && !isMealLogged) {
      const patientData = {
        id: patient.id,
        timeZone: patient.timeZone,
        fcmToken: patientFCMToken.FCMToken,
      };

      patientsWithTokens.push(patientData);
    }
  }
  return patientsWithTokens;
};

export const scheduleBreakfastJobs = async () => {
  for (const timeZone of timeZones) {
    const localTime = moment.tz("10:00", "HH:mm", timeZone);
    const utcHour = localTime.utc().hour();
    const utcMin = localTime.utc().minute();
    const cronPattern = `0 ${utcMin} ${utcHour} * * *`;

    try {
      console.log(
        `Scheduling job for ${timeZone} at ${cronPattern} (UTC time)`
      );

      await jobQueue.upsertJobScheduler(
        `breakfast-scheduler-job-${timeZone}`,
        { pattern: cronPattern, jobId: `breakfast-${timeZone}` },

        {
          name: "checkAndNotifyBreakfast",
          data: { timeZone },
        }
      );

      console.log(`✅ Job scheduled successfully for ${timeZone}`);
    } catch (error) {
      console.error(`❌ Error scheduling job for ${timeZone}:`, error);
    }
  }
};
export const scheduleLunchJobs = async () => {
  for (const timeZone of timeZones) {
    const localTime = moment.tz("15:00", "HH:mm", timeZone);
    const utcHour = localTime.utc().hour();
    const utcMin = localTime.utc().minute();
    const cronPattern = `0 ${utcMin} ${utcHour} * * *`;

    try {
      console.log(
        `Scheduling job for ${timeZone} at ${cronPattern} (UTC time)`
      );

      await jobQueue.upsertJobScheduler(
        `lunch-scheduler-job-${timeZone}`,
        { pattern: cronPattern, jobId: `lunch-${timeZone}` },

        {
          name: "checkAndNotifyLunch",
          data: { timeZone },
        }
      );

      console.log(`✅ Job scheduled successfully for ${timeZone}`);
    } catch (error) {
      console.error(`❌ Error scheduling job for ${timeZone}:`, error);
    }
  }
};
export const scheduleDinnerJobs = async () => {
  for (const timeZone of timeZones) {
    const localTime = moment.tz("19:00", "HH:mm", timeZone);
    const utcHour = localTime.utc().hour();
    const utcMin = localTime.utc().minute();
    const cronPattern = `0 ${utcMin} ${utcHour} * * *`;

    try {
      console.log(
        `Scheduling job for ${timeZone} at ${cronPattern} (UTC time)`
      );

      await jobQueue.upsertJobScheduler(
        `dinner-scheduler-job-${timeZone}`,
        { pattern: cronPattern, jobId: `dinner-${timeZone}` },

        {
          name: "checkAndNotifyDinner",
          data: { timeZone },
        }
      );

      console.log(`✅ Job scheduled successfully for ${timeZone}`);
    } catch (error) {
      console.error(`❌ Error scheduling job for ${timeZone}:`, error);
    }
  }
};
