import { Worker } from "bullmq";
import { sendMulticast } from "../../utils/push_notifications";
import { MealType } from "../../types";
import { getPatientsWithNoLoggedFood } from "../jobSchedulers/nutrition.scheduler";
require("dotenv").config();
const mealConfig = {
  checkAndNotifyBreakfast: {
    type: MealType.BREAKFAST,
    title: "Ollo Health",
    body: "Hey! We noticed you haven't logged your breakfast yet. Would you like to do it now?",
  },
  checkAndNotifyLunch: {
    type: MealType.LUNCH,
    title: "Ollo Health",
    body: "It's lunchtime! Keeping track of your meals helps you stay on top of your health. Want to log your lunch now?",
  },
  checkAndNotifyDinner: {
    type: MealType.DINNER,
    title: "Ollo Health",
    body: "Hey! We noticed you haven't logged your dinner yet. Don't forget to track your meal!",
  },
};

if (process.env.NODE_ENV !== "development") {
  const worker = new Worker(
    "taskQueue",
    async (job) => {
      const { name, data } = job;

      if (!mealConfig[name]) {
        console.warn(`⚠️ No config found for job name: ${name}`);
        return;
      }

      const { type, title, body } = mealConfig[name];
      const { timeZone } = data;

      try {
        const users = await getPatientsWithNoLoggedFood(type);
        const usersInTimeZone = users.filter(
          (user) => user.timeZone === timeZone
        );

        const tokens = usersInTimeZone.map((u) => u.fcmToken);

        if (tokens.length > 0) {
          await sendMulticast({ tokens, title, body });
        } else {
          console.log(
            `ℹ️ No users in ${timeZone} to notify for ${type.toLowerCase()}.`
          );
        }
      } catch (err) {
        console.error(`❌ Error processing ${name} for ${timeZone}:`, err);
      }
    },
    {
      connection: {
        host: process.env.REDIS_HOST,
        port: 6379,
        password: process.env.REDIS_PASSWORD,
      },
    }
  );

  // Logging
  worker.on("error", (err) => {
    console.error("Worker encountered an error:", err);
  });

  worker.on("completed", (job) => {
    console.log(`✅ Job ${job.id} (${job.name}) completed!`);
  });

  worker.on("failed", (job, err) => {
    console.log(`❌ Job ${job.id} failed: ${err.message}`);
  });

  console.log("🔧 Worker is running...");
}
