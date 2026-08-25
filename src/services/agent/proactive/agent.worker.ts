import { Worker } from "bullmq";
import { AGENT_TICK_JOB } from "./agent.scheduler";
import { runDue } from "./proactive.service";
require("dotenv").config();

/**
 * Processes the hourly tick: weekly reviews first (Monday 08:00 local), then
 * daily check-ins for whoever's local hour matches. Runs alongside the meal-
 * reminder worker on the same queue; each worker ignores the other's jobs.
 */
if (process.env.NODE_ENV !== "development") {
  const worker = new Worker(
    "taskQueue",
    async (job) => {
      if (job.name !== AGENT_TICK_JOB) return; // meal reminders are handled by notifications.worker
      const weekly = await runDue("weekly_review");
      const daily = await runDue("daily_checkin");
      console.log(`agent tick: weekly ${weekly.filter((r) => r.ok).length}/${weekly.length}, daily ${daily.filter((r) => r.ok).length}/${daily.length}`);
      return { weekly: weekly.length, daily: daily.length };
    },
    {
      connection: { host: process.env.REDIS_HOST, port: 6379, password: process.env.REDIS_PASSWORD },
      concurrency: 1,
    }
  );
  worker.on("failed", (job, err) => console.error(`agent tick ${job?.id} failed: ${err.message}`));
  console.log("🔧 agent proactive worker running");
}
