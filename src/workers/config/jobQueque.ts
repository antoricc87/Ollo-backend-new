import { Queue } from "bullmq";

/**
 * BullMQ connection + one queue per worker. Two workers on ONE queue was the
 * bug behind the lost Ollie tick (Oct 7 2026): BullMQ hands a job to whichever
 * worker polls first, so the meal-reminder worker kept completing the agent
 * tick without running it. Each worker now owns its queue.
 */
export const redisConnection = {
  host: process.env.REDIS_HOST,
  port: Number(process.env.REDIS_PORT || 6379),
  password: process.env.REDIS_PASSWORD,
};

export const AGENT_QUEUE = "agent-tick";
export const NOTIFICATIONS_QUEUE = "notifications";
/** The old shared queue; kept only so its repeatable jobs can be removed from Redis on boot. */
export const LEGACY_QUEUE = "taskQueue";

const queues = new Map<string, Queue>();
export const getQueue = (name: string): Queue => {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, { connection: redisConnection });
    queues.set(name, q);
  }
  return q;
};

/**
 * Repeatable jobs live in Redis independently of the code that scheduled
 * them. Remove the legacy ones so the old meal-reminder crons and the old
 * agent tick stop firing into a queue nobody listens to.
 */
export const removeLegacyRepeatables = async () => {
  try {
    const q = getQueue(LEGACY_QUEUE);
    const jobs = await q.getRepeatableJobs();
    for (const j of jobs) await q.removeRepeatableByKey(j.key);
    if (jobs.length) console.log(`🧹 removed ${jobs.length} legacy repeatable job(s) from ${LEGACY_QUEUE}`);
  } catch (e) {
    console.warn("legacy queue cleanup skipped:", (e as Error).message);
  }
};
