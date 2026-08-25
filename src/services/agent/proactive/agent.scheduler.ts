import { JobsOptions } from "bullmq";
import { jobQueue } from "../../../workers/config/jobQueque";

/**
 * One repeatable job per hour. The worker asks proactive.service which
 * patients' LOCAL clocks are at their check-in hour / Monday 08:00 — so any
 * timezone works without a job per zone. Same queue as the meal reminders.
 */
export const AGENT_TICK_JOB = "agent-proactive-tick";

export const scheduleAgentProactiveTick = async () => {
  const opts: JobsOptions = { repeat: { pattern: "5 * * * *" }, jobId: AGENT_TICK_JOB, removeOnComplete: 24, removeOnFail: 24 };
  try {
    await jobQueue.add(AGENT_TICK_JOB, {}, opts);
    console.log("✅ agent proactive tick scheduled (hourly at :05)");
  } catch (error) {
    console.error("❌ could not schedule agent proactive tick", error);
  }
};
