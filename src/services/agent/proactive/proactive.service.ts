import moment from "moment-timezone";
import prisma from "../../../utility/prismaClient";
import { sendSingleNotification } from "../../../utils/push_notifications";
import { pushEnabled } from "../../../config/firebaseAdmin";
import { ProactiveKind, runProactiveCollect } from "../agent.service";
import { audit } from "../memory/audit";
import { isoWeekRange, safeTz } from "../memory/dates";

/**
 * Proactive runs: the same agent, opened by a job instead of a message.
 *   weekly_review  Monday morning — judge last week vs the plan, propose tweaks
 *   daily_checkin  user-chosen local hour — today vs targets, one action
 *   watch_out      event-driven — a new lab report / flagged reading
 *   plan_week      Sunday evening — lay out next week's training (a draft card)
 * Each run creates (or reuses) a PROACTIVE thread and pushes a notification
 * that deep-links to it. Eligibility is decided here, not in the worker.
 */

export const DEFAULT_CHECKIN_HOUR = 18;
export const WEEKLY_REVIEW_HOUR = 8; // local, Monday
export const PLAN_WEEK_HOUR = 18; // local, Sunday
const INACTIVE_AFTER_DAYS = 14;

export type Preference = {
  proactiveEnabled: boolean;
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
  dailyCheckinHour: DEFAULT_CHECKIN_HOUR,
  weeklyReviewEnabled: true,
  watchOutsEnabled: true,
  planWeekEnabled: true,
  lastDailyCheckinAt: null,
  lastWeeklyReviewAt: null,
  lastPlanWeekAt: null,
};

export const getPreference = async (patientId: string): Promise<Preference> =>
  (await prisma.agentPreference.findUnique({ where: { patientId } })) ?? DEFAULT_PREFERENCE;

export const setPreference = (patientId: string, patch: Partial<Pick<Preference, "proactiveEnabled" | "dailyCheckinHour" | "weeklyReviewEnabled" | "watchOutsEnabled" | "planWeekEnabled">>) =>
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

const dailyInstruction = (tz: string) =>
  `[Daily check-in at ${moment().tz(tz).format("HH:mm")} local. Use the snapshot; call get_meals only if you need meal detail.]`;

export const watchOutInstruction = (reason: string) => `[Event: ${reason}. Use get_labs with flaggedOnly=true (or get_vitals) to see the exact values before writing.]`;

/* ------------------------------- run + notify ---------------------------- */

const TITLES: Record<ProactiveKind, string> = {
  weekly_review: "Your weekly review",
  daily_checkin: "Daily check-in",
  watch_out: "Something new in your data",
  plan_week: "Next week's training",
};

export async function runProactiveFor(patientId: string, kind: ProactiveKind, opts: { reason?: string; notify?: boolean; threadId?: string | null } = {}) {
  const patient = await prisma.patient.findUnique({ where: { id: patientId }, select: { timeZone: true, firstName: true } });
  if (!patient) return { skipped: "no patient" as const };
  const tz = safeTz(patient.timeZone);
  const instruction =
    kind === "weekly_review" ? weeklyInstruction(tz) : kind === "daily_checkin" ? dailyInstruction(tz) : kind === "plan_week" ? planWeekInstruction(tz) : watchOutInstruction(opts.reason ?? "new data");
  const title = kind === "weekly_review" ? `Weekly review · ${isoWeekRange(tz, moment().tz(tz).subtract(1, "week")).start}` : TITLES[kind];

  const r = await runProactiveCollect({ patientId, kind, title, instruction, threadId: opts.threadId ?? null });
  const stamp = kind === "weekly_review" ? { lastWeeklyReviewAt: new Date() } : kind === "daily_checkin" ? { lastDailyCheckinAt: new Date() } : kind === "plan_week" ? { lastPlanWeekAt: new Date() } : {};
  if (Object.keys(stamp).length)
    await prisma.agentPreference.upsert({ where: { patientId }, create: { patientId, ...stamp }, update: stamp });
  if (!r.done) {
    void audit(patientId, "error", { threadId: r.threadId, payload: { stage: "proactive", kind, error: r.error } });
    return { skipped: "failed" as const, threadId: r.threadId, error: r.error };
  }

  let notified = false;
  if (opts.notify !== false && pushEnabled) {
    const fcm = await prisma.userFCMToken.findUnique({ where: { userId: patientId } });
    if (fcm?.FCMToken && fcm.isActive && !fcm.isDeleted) {
      try {
        const res = await sendSingleNotification({
          token: fcm.FCMToken,
          title: `Ollie · ${TITLES[kind]}`,
          body: r.done.text.replace(/[*_#]/g, "").split("\n")[0].slice(0, 140),
          data: { type: "agent_thread", threadId: r.threadId ?? "", kind },
        });
        notified = !!(res && (res as any).success);
      } catch (e) {
        console.error("proactive notify failed", e);
      }
    }
  }
  return { threadId: r.threadId, messageId: r.done.messageId, text: r.done.text, cards: r.done.cards, notified };
}

/* ------------------------------- eligibility ----------------------------- */

/**
 * Patients whose LOCAL clock is at the given hour right now and who are due.
 * Called once per UTC hour by the worker; cheap enough to scan all patients.
 */
export type ScheduledKind = "weekly_review" | "daily_checkin" | "plan_week";

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
    } else {
      if (pref.dailyCheckinHour === null || local.hour() !== pref.dailyCheckinHour) continue;
      if (pref.lastDailyCheckinAt && moment(pref.lastDailyCheckinAt).tz(safeTz(p.timeZone)).isSame(local, "day")) continue;
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
