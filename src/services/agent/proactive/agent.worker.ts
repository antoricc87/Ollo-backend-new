import { Worker } from "bullmq";
import { AGENT_TICK_JOB } from "./agent.scheduler";
import { runDue } from "./proactive.service";
import { runSignalScanDue } from "../../signals/signals.service";
require("dotenv").config();

/**
 * Processes the hourly tick: weekly reviews (Monday 08:00 local), the Sunday
 * planning run, then the signal scan for whoever's local clock is at 09:00.
 * The scan is what replaced the daily check-in on 2026-09-25 — it looks at the
 * data and usually says nothing. Runs alongside the meal-reminder worker on the
 * same queue; each worker ignores the other's jobs.
 */
if (process.env.NODE_ENV !== "development") {
  const worker = new Worker(
    "taskQueue",
    async (job) => {
      if (job.name !== AGENT_TICK_JOB) return; // meal reminders are handled by notifications.worker
      const weekly = await runDue("weekly_review");
      const planWeek = await runDue("plan_week");
      const signals = await runSignalScanDue();
      console.log(
        `agent tick: weekly ${weekly.filter((r) => r.ok).length}/${weekly.length}, plan_week ${planWeek.filter((r) => r.ok).length}/${planWeek.length}, ` +
          `signals scanned ${signals.scanned} · ${signals.episodesOpened} opened · ${signals.notified} notified`
      );
      return { weekly: weekly.length, planWeek: planWeek.length, signals };
    },
    {
      connection: { host: process.env.REDIS_HOST, port: 6379, password: process.env.REDIS_PASSWORD },
      concurrency: 1,
    }
  );
  worker.on("failed", (job, err) => console.error(`agent tick ${job?.id} failed: ${err.message}`));
  console.log("🔧 agent proactive worker running");
}
