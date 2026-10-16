import { Worker } from "bullmq";
import { AGENT_TICK_JOB } from "./agent.scheduler";
import { AGENT_QUEUE, redisConnection } from "../../../workers/config/jobQueque";
import { runDue } from "./proactive.service";
import { runSignalScanDue } from "../../signals/signals.service";
import { runMorningTasksDue } from "./tasks";
import { runDigestDue } from "../../notifications/digest";
require("dotenv").config();

/**
 * Processes the hourly tick: weekly reviews (Monday 08:00 local), the Sunday
 * planning run, then for whoever's local clock is at 09:00 the morning tasks
 * (missed session → moved), the signal scan, and LAST the digest, so
 * everything the morning prepared goes out as one push (Oct 16 2026).
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
      const tasks = await runMorningTasksDue();
      const signals = await runSignalScanDue();
      const digest = await runDigestDue();
      console.log(
        `agent tick: weekly ${weekly.filter((r) => r.ok).length}/${weekly.length}, plan_week ${planWeek.filter((r) => r.ok).length}/${planWeek.length}, ` +
          `tasks ${tasks.filter((t) => t.missed.ran).length}/${tasks.length} · signals scanned ${signals.scanned} · ${signals.episodesOpened} opened · ${signals.notified} notified · ` +
          `digests ${digest.filter((d) => d.pushed).length}/${digest.length}`
      );
      return { weekly: weekly.length, planWeek: planWeek.length, tasks: tasks.length, signals, digests: digest.length };
    },
    {
      connection: redisConnection,
      concurrency: 1,
    }
  );
  worker.on("failed", (job, err) => console.error(`agent tick ${job?.id} failed: ${err.message}`));
  console.log("🔧 agent proactive worker running");
}
