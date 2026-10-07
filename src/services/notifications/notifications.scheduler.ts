import { JobsOptions, Worker } from "bullmq";
import { getQueue, NOTIFICATIONS_QUEUE, redisConnection } from "../../workers/config/jobQueque";
import { sendDue } from "./notifications.service";

/**
 * The sender sweep: every minute, deliver queued notifications whose
 * `scheduledFor` has passed. Minute precision is what reminders tied to a
 * clock time (a planned workout) will need; the triggers themselves can
 * keep running off the hourly agent tick.
 */
export const SWEEP_JOB = "notifications-sweep";

export const scheduleNotificationsSweep = async () => {
  const opts: JobsOptions = { repeat: { pattern: "* * * * *" }, jobId: SWEEP_JOB, removeOnComplete: 60, removeOnFail: 60 };
  try {
    await getQueue(NOTIFICATIONS_QUEUE).add(SWEEP_JOB, {}, opts);
    console.log("✅ notifications sweep scheduled (every minute)");
  } catch (error) {
    console.error("❌ could not schedule notifications sweep", error);
  }
};

export const startNotificationsWorker = () => {
  const worker = new Worker(
    NOTIFICATIONS_QUEUE,
    async (job) => {
      if (job.name !== SWEEP_JOB) return;
      const r = await sendDue();
      if (r.picked > 0) console.log(`notifications sweep: ${r.picked} due · ${r.sent} sent · ${r.failed} failed`);
      return r;
    },
    { connection: redisConnection, concurrency: 1 }
  );
  worker.on("failed", (job, err) => console.error(`notifications sweep ${job?.id} failed: ${err.message}`));
  console.log("🔧 notifications worker running");
  return worker;
};
