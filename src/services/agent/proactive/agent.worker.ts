import { Worker } from "bullmq";
import { AGENT_TICK_JOB } from "./agent.scheduler";
import { AGENT_QUEUE, redisConnection } from "../../../workers/config/jobQueque";
import { runDue } from "./proactive.service";
import { runSignalScanDue } from "../../signals/signals.service";
require("dotenv").config();

/**
 * Processes the hourly tick: weekly reviews (Monday 08:00 local), the Sunday
 * planning run, then the signal scan for whoever's local clock is at 09:00.
 * The scan is what replaced the daily check-in on 2026-09-25 — it looks at the
 * data and usually says nothing. Owns the `agent-tick` queue: sharing one
 * queue with another worker lost every tick that worker grabbed (Oct 2026).
 */
if (process.env.NODE_ENV !== "development") {
  const worker = new Worker(
    AGENT_QUEUE,
    async (job) => {
      if (job.name !== AGENT_TICK_JOB) return;
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
      connection: redisConnection,
      concurrency: 1,
    }
  );
  worker.on("failed", (job, err) => console.error(`agent tick ${job?.id} failed: ${err.message}`));
  console.log("🔧 agent proactive worker running");
}
