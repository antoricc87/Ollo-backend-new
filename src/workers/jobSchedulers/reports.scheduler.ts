import prisma from "../../utility/prismaClient";
import { jobQueue } from "../config/jobQueque";
import { JobsOptions } from "bullmq";

const getAllPatientsFCMTokens = async () => {
  const FCM_tokens: string[] = [];
  // Fetch all patients
  const patients = await prisma.patient.findMany();
  // Get patients' FCM tokens
  for (const patient of patients) {
    const fcmToken = await prisma.userFCMToken.findUnique({
      where: { userId: patient.id },
    });
    if (fcmToken) {
      FCM_tokens.push(fcmToken.FCMToken);
    }
  }
  return FCM_tokens;
};

export const scheduleWeeklyReportReminder = async () => {
  const tokens = await getAllPatientsFCMTokens();
  // Define the job options with repeat and cron syntax
  const jobOptions: JobsOptions = {
    repeat: {
      pattern: "0 15 * * 1", // Runs every Monday at 10:00 AM
    },
  };
  try {
    // Add the job to the jobQueue with the tokens and options
    const job = await jobQueue.add(
      "weeklyReportJob",
      {
        tokens,
        title: "Ollo Health",
        body: "Hey! Your weekly report is now available. Take a look and stay on top of your progress!",
      },
      jobOptions
    );
  } catch (error: unknown) {
    console.error("Error scheduling job:", error);
  }
};
