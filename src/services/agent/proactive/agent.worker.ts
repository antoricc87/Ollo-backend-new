import { Worker } from "bullmq";
import { AGENT_TICK_JOB } from "./agent.scheduler";
import { AGENT_QUEUE, redisConnection } from "../../../workers/config/jobQueque";
import { runWeekWrapDue } from "./proactive.service";
import { runSignalScanDue } from "../../signals/signals.service";
import { runMorningTasksDue } from "./tasks";
import { runDigestDue } from "../../notifications/digest";
import { runCheckinsDue } from "../../encounter/followups.service";
import { runBookingSweep } from "../../booking/booking.service";
require("dotenv").config();

/**
 * Processes the hourly tick: the Sunday 18:00 week wrap (review + next week's
 * plan, one push — Nov 20 2026), then for whoever's local clock is at 09:00 the morning tasks
 * (missed session → moved), the signal scan, the check-in sweep (close what
 * is over, ask the follow-ups due — Nov 16 2026), and LAST the digest, so
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
      // Sunday 18:00 local: the week in review + next week's plan, one push.
      const wrap = await runWeekWrapDue();
      const tasks = await runMorningTasksDue();
      const signals = await runSignalScanDue();
      const checkins = await runCheckinsDue();
      // Holds lapse, reminders go out, results come back (P1b booking).
      const booking = await runBookingSweep().catch((e) => (console.error("booking sweep", e), null));
      const digest = await runDigestDue();
      console.log(
        `agent tick: week wrap ${wrap.filter((r) => r.review).length} reviews, ${wrap.filter((r) => r.plan).length} plans, ${wrap.filter((r) => r.notified).length} pushed, ` +
          `tasks ${tasks.filter((t) => t.missed.ran).length}/${tasks.length} · signals scanned ${signals.scanned} · ${signals.episodesOpened} opened · ${signals.notified} notified · ` +
          `check-ins closed ${checkins.closed} asked ${checkins.asked} · ` +
          `bookings ${booking ? `${booking.reminded} reminded, ${booking.results} results` : "sweep failed"} · ` +
          `digests ${digest.filter((d) => d.pushed).length}/${digest.length}`
      );
      return { weekWrap: wrap.length, tasks: tasks.length, signals, checkins, digests: digest.length };
    },
    {
      connection: redisConnection,
      concurrency: 1,
    }
  );
  worker.on("failed", (job, err) => console.error(`agent tick ${job?.id} failed: ${err.message}`));
  console.log("🔧 agent proactive worker running");
}
