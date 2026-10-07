import { JobsOptions } from "bullmq";
import { AGENT_QUEUE, getQueue } from "../../../workers/config/jobQueque";

/**
 * One repeatable job per hour on the agent's OWN queue. The worker asks
 * proactive.service which patients' LOCAL clocks are at Monday 08:00 /
 * Sunday 18:00 / 09:00 — so any timezone works without a job per zone.
 */
export const AGENT_TICK_JOB = "agent-proactive-tick";

export const scheduleAgentProactiveTick = async () => {
  const opts: JobsOptions = { repeat: { pattern: "5 * * * *" }, jobId: AGENT_TICK_JOB, removeOnComplete: 24, removeOnFail: 24 };
  try {
    await getQueue(AGENT_QUEUE).add(AGENT_TICK_JOB, {}, opts);
    console.log("✅ agent proactive tick scheduled (hourly at :05)");
  } catch (error) {
    console.error("❌ could not schedule agent proactive tick", error);
  }
};
