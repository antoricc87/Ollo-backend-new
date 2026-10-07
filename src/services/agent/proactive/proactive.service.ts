import moment from "moment-timezone";
import prisma from "../../../utility/prismaClient";
import { queueNotification } from "../../notifications/notifications.service";
import { ProactiveKind, runProactiveCollect } from "../agent.service";
import { audit } from "../memory/audit";
import { isoWeekRange, safeTz } from "../memory/dates";

/**
 * Proactive runs: the same agent, opened by a job instead of a message.
 *   weekly_review  Monday morning — judge last week vs the plan, propose tweaks
 *   signal         a detector cleared its bar (services/signals) — explain it
 *   watch_out      event-driven — a new lab report / flagged reading
 *   plan_week      Sunday evening — lay out next week's training (a draft card)
 *
 * `daily_checkin` was retired on 2026-09-25 (ruling): it ran on the clock, so
 * it had to say something every day whether or not anything had happened.
 * Signals replace it. `AgentPreference.dailyCheckinHour` / `lastDailyCheckinAt`
 * are left on the table on purpose — dropping columns on Railway is a
 * destructive migration for no gain.
 * Each run creates (or reuses) a PROACTIVE thread and pushes a notification
 * that deep-links to it. Eligibility is decided here, not in the worker.
 */

export const WEEKLY_REVIEW_HOUR = 8; // local, Monday
/** Local hour the signal scan runs — morning, after the night's data has synced. */
export const SIGNAL_SCAN_HOUR = 9;
export const PLAN_WEEK_HOUR = 18; // local, Sunday
const INACTIVE_AFTER_DAYS = 14;

export type Preference = {
  proactiveEnabled: boolean;
  /** Retired with `daily_checkin` (2026-09-25); the column stays, unread. */
  dailyCheckinHour: number | null;
  weeklyReviewEnabled: boolean;
  watchOutsEnabled: boolean;
  planWeekEnabled: boolean;
  lastDailyCheckinAt: Date | null;
  lastWeeklyReviewAt: Date | null;
  lastPlanWeekAt: Date | null;
};

export const DEFAULT_PREFERENCE: Preference = {
  proactiveEnabled: true,
  dailyCheckinHour: null,
  weeklyReviewEnabled: true,
  watchOutsEnabled: true,
  planWeekEnabled: true,
  lastDailyCheckinAt: null,
  lastWeeklyReviewAt: null,
  lastPlanWeekAt: null,
};

export const getPreference = async (patientId: string): Promise<Preference> =>
  (await prisma.agentPreference.findUnique({ where: { patientId } })) ?? DEFAULT_PREFERENCE;

export const setPreference = (patientId: string, patch: Partial<Pick<Preference, "proactiveEnabled" | "weeklyReviewEnabled" | "watchOutsEnabled" | "planWeekEnabled">>) =>
  prisma.agentPreference.upsert({ where: { patientId }, create: { patientId, ...patch }, update: patch });

/** Logged anything in the last N days? Keeps jobs from nagging dormant accounts. */
const recentlyActive = async (patientId: string) => {
  const since = moment().subtract(INACTIVE_AFTER_DAYS, "days").format("YYYY-MM-DD");
  const [food, threads] = await Promise.all([
    prisma.dailyFood.count({ where: { userId: patientId, date: { gte: since } } }),
    prisma.agentThread.count({ where: { patientId, source: "CHAT", lastMessageAt: { gte: new Date(since) } } }),
  ]);
  return food > 0 || threads > 0;
};

/* ------------------------------- instructions ---------------------------- */

const weeklyInstruction = (tz: string) => {
  const lastWeek = isoWeekRange(tz, moment().tz(tz).subtract(1, "week"));
  return `[Weekly plan review for the week ${lastWeek.start} → ${lastWeek.end}. Use get_nutrition_summary, get_activity and get_workouts for that exact range (from=${lastWeek.start}, to=${lastWeek.end}) before judging. Compare against the plan targets. If a target should change, call update_plan_targets with the full new target list.]`;
};

const planWeekInstruction = (tz: string) => {
  const thisWeek = isoWeekRange(tz, moment().tz(tz));
  const nextMonday = thisWeek.next;
  return `[Sunday planning for the week starting ${nextMonday}. First call get_workouts with status=all from=${thisWeek.start} to=${thisWeek.end} to see what was planned and done this week. Then call generate_workout_plan with startDate=${nextMonday}, days=7 (sessionsPerWeek from the plan target; keep what worked, adjust what was missed). Present the split in a few lines and say the card has Save. Do NOT call save_workout_plan.]`;
};

/**
 * A signal's instruction carries the detector's finding verbatim. The agent is
 * explaining a result, not looking for one — so the numbers are handed to it
 * rather than left to a tool call that might return something else.
 */
export const signalInstruction = (finding: { detectorKey: string; label: string; severity: number; evidence: unknown; baseline: unknown }) =>
  `[A signal fired: ${finding.detectorKey} — ${finding.label}. Evidence: ${JSON.stringify(finding.evidence)}. Their usual/target: ${JSON.stringify(finding.baseline)}. Explain THIS and nothing else. Do not call tools to look for other findings.]`;

export const watchOutInstruction = (reason: string) => `[Event: ${reason}. Use get_labs with flaggedOnly=true (or get_vitals) to see the exact values before writing.]`;

/* ------------------------------- run + notify ---------------------------- */

const TITLES: Record<ProactiveKind, string> = {
  weekly_review: "Your weekly review",
  signal: "Something changed",
  watch_out: "Something new in your data",
  plan_week: "Next week's training",
};

export async function runProactiveFor(patientId: string, kind: ProactiveKind, opts: { reason?: string; notify?: boolean; threadId?: string | null; instruction?: string; title?: string } = {}) {
  const patient = await prisma.patient.findUnique({ where: { id: patientId }, select: { timeZone: true, firstName: true } });
  if (!patient) return { skipped: "no patient" as const };
  const tz = safeTz(patient.timeZone);
  // A signal brings its own instruction (the detector's finding); the scheduled
  // kinds write theirs from the calendar.
  const instruction =
    opts.instruction ?? (kind === "weekly_review" ? weeklyInstruction(tz) : kind === "plan_week" ? planWeekInstruction(tz) : watchOutInstruction(opts.reason ?? "new data"));
  const title = opts.title ?? (kind === "weekly_review" ? `Weekly review · ${isoWeekRange(tz, moment().tz(tz).subtract(1, "week")).start}` : TITLES[kind]);

  const r = await runProactiveCollect({ patientId, kind, title, instruction, threadId: opts.threadId ?? null });
  const stamp = kind === "weekly_review" ? { lastWeeklyReviewAt: new Date() } : kind === "plan_week" ? { lastPlanWeekAt: new Date() } : {};
  if (Object.keys(stamp).length)
    await prisma.agentPreference.upsert({ where: { patientId }, create: { patientId, ...stamp }, update: stamp });
  if (!r.done) {
    void audit(patientId, "error", { threadId: r.threadId, payload: { stage: "proactive", kind, error: r.error } });
    return { skipped: "failed" as const, threadId: r.threadId, error: r.error };
  }

  // The push is a row in the notification outbox (docs/notifications-plan.md);
  // the sweep delivers it. Body wording and the policy gate come with the
  // catalogue — until then the title alone, so no health detail reaches a lock screen.
  let notified = false;
  if (opts.notify !== false) {
    try {
      const row = await queueNotification({
        userId: patientId,
        kind,
        title: "Ollie",
        body: TITLES[kind],
        route: r.threadId ? `ollie?threadId=${r.threadId}` : "ollie",
        threadId: r.threadId ?? null,
        dedupeKey: `${kind}:${r.threadId ?? "none"}`,
      });
      notified = row.status === "queued";
    } catch (e) {
      console.error("proactive notify failed", e);
    }
  }
  return { threadId: r.threadId, messageId: r.done.messageId, text: r.done.text, cards: r.done.cards, notified };
}

/* ------------------------------- eligibility ----------------------------- */

/**
 * Patients whose LOCAL clock is at the given hour right now and who are due.
 * Called once per UTC hour by the worker; cheap enough to scan all patients.
 */
export type ScheduledKind = "weekly_review" | "plan_week";

export async function duePatients(kind: ScheduledKind, now = new Date()) {
  const patients = await prisma.patient.findMany({
    where: { subAccountOf: null, onBoardingComplete: true },
    select: { id: true, timeZone: true, agentPreference: true, trainingProfile: { select: { patientId: true } }, workoutPlans: { where: { status: "ACTIVE" }, select: { id: true }, take: 1 }, healthPlans: { where: { status: "ACTIVE" }, select: { id: true }, take: 1 } },
  });
  const due: string[] = [];
  for (const p of patients) {
    const pref: Preference = p.agentPreference ?? DEFAULT_PREFERENCE;
    if (!pref.proactiveEnabled) continue;
    const local = moment(now).tz(safeTz(p.timeZone));
    if (kind === "weekly_review") {
      if (!pref.weeklyReviewEnabled || local.isoWeekday() !== 1 || local.hour() !== WEEKLY_REVIEW_HOUR) continue;
      if (!p.healthPlans.length) continue; // nothing to review against
      if (pref.lastWeeklyReviewAt && moment(pref.lastWeeklyReviewAt).isAfter(local.clone().startOf("isoWeek"))) continue;
    } else if (kind === "plan_week") {
      // Sunday evening, for people who train with Ollie: a saved week, a training profile, or a plan with an exercise target.
      if (!pref.planWeekEnabled || local.isoWeekday() !== 7 || local.hour() !== PLAN_WEEK_HOUR) continue;
      if (!p.workoutPlans.length && !p.trainingProfile && !p.healthPlans.length) continue;
      if (pref.lastPlanWeekAt && moment(pref.lastPlanWeekAt).isAfter(local.clone().startOf("isoWeek"))) continue;
    }
    if (!(await recentlyActive(p.id))) continue;
    due.push(p.id);
  }
  return due;
}

/** Run every due patient for this hour, sequentially (one model at a time). */
export async function runDue(kind: ScheduledKind) {
  const ids = await duePatients(kind);
  const results: { patientId: string; ok: boolean }[] = [];
  for (const patientId of ids) {
    try {
      const r = await runProactiveFor(patientId, kind);
      results.push({ patientId, ok: !("skipped" in r) });
    } catch (e) {
      console.error(`proactive ${kind} failed for ${patientId}`, e);
      results.push({ patientId, ok: false });
    }
  }
  return results;
}

/**
 * Event hook for other modules (lab upload, flagged readings). Fire-and-forget:
 * `void triggerWatchOut(patientId, "new lab report uploaded (3 values flagged)")`.
 */
export async function triggerWatchOut(patientId: string, reason: string) {
  try {
    const pref = await getPreference(patientId);
    if (!pref.proactiveEnabled || !pref.watchOutsEnabled) return { skipped: "disabled" as const };
    return await runProactiveFor(patientId, "watch_out", { reason });
  } catch (e) {
    console.error("triggerWatchOut failed", e);
    return { skipped: "failed" as const };
  }
}
