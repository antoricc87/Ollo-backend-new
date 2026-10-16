import moment from "moment-timezone";
import prisma from "../../../utility/prismaClient";
import { safeTz } from "../memory/dates";
import WorkoutPlanService from "../../workouts/model/plan.model";
import { rescheduleMissed, type DaySession } from "../../workouts/design/reschedule";
import { lastNightLow, type LastNightLow } from "../../signals/domain/lastNight";
import { BASELINE_NIGHTS, type NightRow } from "../../signals/domain/baseline";
import { getPreference, runProactiveFor, SIGNAL_SCAN_HOUR } from "./proactive.service";

/**
 * BACKGROUND TASKS — work Ollie does unasked and leaves ready in the app
 * (ruling Oct 16 2026: "start with the four"). Each one is the same shape:
 *
 *   code decides there is work and what it is  →  the agent does it with its
 *   ordinary tools (a proposal or a draft card, never a save)  →  the outbox
 *   gate decides how it is announced.
 *
 * The model never decides WHETHER to act — a task with nothing worth doing
 * leaves no note. `AgentPreference.taskRuns` remembers what each task last
 * acted on, so a repeated tick never acts twice.
 *
 * Training tasks follow the same switch as Sunday planning (`planWeekEnabled`).
 */

type TaskKey = "missed_session" | "lighter_today";

const taskRuns = async (patientId: string): Promise<Record<string, string>> =>
  (((await prisma.agentPreference.findUnique({ where: { patientId }, select: { taskRuns: true } }))?.taskRuns ?? {}) as Record<string, string>);

const stampTask = async (patientId: string, key: TaskKey, value: string) => {
  const runs = { ...(await taskRuns(patientId)), [key]: value };
  await prisma.agentPreference.upsert({ where: { patientId }, create: { patientId, taskRuns: runs }, update: { taskRuns: runs } });
};

const trainingTasksOn = async (patientId: string) => {
  const pref = await getPreference(patientId);
  return pref.proactiveEnabled && pref.planWeekEnabled;
};

const fmtDay = (day: string) => moment.utc(day, "YYYY-MM-DD").format("dddd D MMM");

/* ------------------------- 1. missed session → moved ------------------------ */

export type TaskOutcome = { ran: false; reason: string } | { ran: true; threadId: string | null; notified: boolean };

/**
 * Yesterday's session in the saved week was not done (and nothing else was
 * trained that day): find it a free day this week and prepare the move. The
 * person confirms it — `move_workout` is a proposal.
 */
export async function runMissedSessionFor(patientId: string, now = new Date()): Promise<TaskOutcome> {
  if (!(await trainingTasksOn(patientId))) return { ran: false, reason: "turned off" };
  const plan = await WorkoutPlanService.getActive(patientId);
  if (!plan) return { ran: false, reason: "no saved week" };
  const patient = await prisma.patient.findUnique({ where: { id: patientId }, select: { timeZone: true } });
  const tz = safeTz(patient?.timeZone);
  const today = moment(now).tz(tz).format("YYYY-MM-DD");
  const yesterday = moment(now).tz(tz).subtract(1, "day").format("YYYY-MM-DD");
  if (plan.endDate < today) return { ran: false, reason: "the saved week is over" };

  const day = plan.daysOut.find((d) => d.date === yesterday);
  // "other" = they trained something else that day: not a miss, just a different session.
  if (!day || day.state !== "missed" || !day.planned) return { ran: false, reason: "nothing missed yesterday" };
  const missed = day.planned;
  if ((await taskRuns(patientId)).missed_session === missed.id) return { ran: false, reason: "already handled" };

  const asDay = (date: string, s: { muscleGroups: string[]; focus: string | null }): DaySession => ({ date, muscleGroups: s.muscleGroups ?? [], focus: s.focus ?? null });
  const others = plan.daysOut
    .filter((d) => d.date !== yesterday)
    .flatMap((d) => [...(d.planned ? [asDay(d.date, d.planned)] : []), ...d.other.map((o) => asDay(d.date, o))]);
  const move = rescheduleMissed({ missed: asDay(yesterday, missed), others, today, weekEnd: plan.endDate });
  if (!move) {
    // The week is full: moving it would stack sessions. Nothing to prepare.
    await stampTask(patientId, "missed_session", missed.id);
    return { ran: false, reason: "no free day left this week" };
  }

  const title = missed.title ?? "the session";
  const why =
    move.why === "free_with_rest_either_side"
      ? "it is free and has a rest day on both sides"
      : "it is free and the sessions next to it train different muscles";
  const instruction = `[Background task: yesterday's planned session was not done. Session: "${title}" (id ${missed.id}), planned for ${fmtDay(yesterday)}. Code checked the rest of this saved week (it ends ${fmtDay(plan.endDate)}) and the best free day is ${fmtDay(move.to)} — ${why}. Call move_workout with sessionId=${missed.id} and plannedFor=${move.to}: it prepares the move for them to confirm. Do not design anything new and do not move any other session.]`;
  const r = await runProactiveFor(patientId, "missed_session", { instruction, title: `${title} moved to ${moment.utc(move.to, "YYYY-MM-DD").format("ddd")}` });
  await stampTask(patientId, "missed_session", missed.id);
  if ("skipped" in r) return { ran: false, reason: `agent run failed: ${r.skipped}` };
  return { ran: true, threadId: r.threadId ?? null, notified: r.notified };
}

/* ---------------------- 2. low recovery → lighter option ---------------------- */

/** Below this a session is already light; a lighter one is not worth preparing. */
const MIN_SESSION_MIN = 25;
const LIGHT_FOCUS = new Set(["mobility"]);

const vitalWords = (low: LastNightLow) =>
  low.low
    .map((v) => (v.vital === "hrvMs" ? `HRV ${v.value} ms against their usual ${v.usual} ms (${v.sigma} SD below)` : `sleeping heart rate ${v.value} bpm against their usual ${v.usual} bpm (${v.sigma} SD above)`))
    .join("; ");

/**
 * Last night's numbers arrive when the app opens (useNightlyVitalsSync), so
 * this runs on that upload, not on a clock. Today has a planned session that
 * has not started, and last night was below their usual → design a lighter
 * version of it beside the original. Nothing replaces the session unless they
 * tap "Put in plan".
 */
export async function runLighterTodayFor(patientId: string, now = new Date()): Promise<TaskOutcome> {
  if (!(await trainingTasksOn(patientId))) return { ran: false, reason: "turned off" };
  const patient = await prisma.patient.findUnique({ where: { id: patientId }, select: { timeZone: true } });
  const tz = safeTz(patient?.timeZone);
  const today = moment(now).tz(tz).format("YYYY-MM-DD");
  if ((await taskRuns(patientId)).lighter_today === today) return { ran: false, reason: "already handled today" };

  const sessions = await prisma.workoutSession.findMany({
    where: { patientId, deletedAt: null, OR: [{ plannedFor: today }, { startedAt: { gte: moment.tz(today, tz).startOf("day").toDate(), lte: moment.tz(today, tz).endOf("day").toDate() } }] },
    select: { id: true, status: true, title: true, focus: true, durationSec: true, startedAt: true, plannedFor: true },
  });
  if (sessions.some((s) => s.status === "COMPLETED")) return { ran: false, reason: "already trained today" };
  const planned = sessions.find((s) => s.status === "PLANNED" && s.plannedFor === today);
  if (!planned) return { ran: false, reason: "no session planned today" };
  if (planned.startedAt <= now) return { ran: false, reason: "session time already passed" };
  if (LIGHT_FOCUS.has(planned.focus ?? "") || planned.durationSec < MIN_SESSION_MIN * 60) return { ran: false, reason: "session already light" };

  const from = moment.tz(today, tz).subtract(BASELINE_NIGHTS, "days").format("YYYY-MM-DD");
  const rows = await prisma.nightlyVitals.findMany({ where: { patientId, date: { gte: from, lte: today } }, orderBy: { date: "asc" } });
  const nights: NightRow[] = rows.map((v) => ({ date: v.date, asleepMinutes: v.asleepMinutes, hrvMs: v.hrvMs, sleepingHr: v.sleepingHr, restingHr: v.restingHr }));
  const low = lastNightLow(nights, today);
  if (!low) return { ran: false, reason: "last night within their usual (or not synced)" };

  const minutes = Math.round(planned.durationSec / 60);
  const lighter = Math.max(20, Math.round((minutes * 0.7) / 5) * 5);
  const title = planned.title ?? "today's session";
  const instruction = `[Background task: last night was below this person's usual — ${vitalWords(low)}. Today's planned session: "${title}" (id ${planned.id}), ${minutes} min, ${moment(planned.startedAt).tz(tz).format("HH:mm")}. Call generate_workout with date=${today}, replaceSessionId=${planned.id}, durationMin=${lighter}, focus=${planned.focus ?? "mixed"} and request="a lighter version of ${title}: same muscles, fewer hard sets, further from failure, longer rests — recovery is below usual this morning". Then write two or three lines: last night against their usual in plain numbers (an observation from their watch, not a verdict on their health), that a lighter version is on the card, and that the original stays unless they put this one in the plan. Never tell them not to train.]`;
  const r = await runProactiveFor(patientId, "lighter_today", { instruction, title: `A lighter ${title}` });
  await stampTask(patientId, "lighter_today", today);
  if ("skipped" in r) return { ran: false, reason: `agent run failed: ${r.skipped}` };
  return { ran: true, threadId: r.threadId ?? null, notified: r.notified };
}

/* --------------------------------- the tick --------------------------------- */

/**
 * The morning batch, called by the hourly tick for everyone whose local clock
 * is at the scan hour — before the digest, so what it prepares rides it.
 */
export async function runMorningTasksDue(now = new Date()) {
  // Only people with a saved training week can have missed a session in it.
  const patients = await prisma.patient.findMany({
    where: { subAccountOf: null, onBoardingComplete: true, workoutPlans: { some: { status: "ACTIVE" } } },
    select: { id: true, timeZone: true },
  });
  const outcomes: { patientId: string; missed: TaskOutcome }[] = [];
  for (const p of patients) {
    if (moment(now).tz(safeTz(p.timeZone)).hour() !== SIGNAL_SCAN_HOUR) continue;
    const missed = await runMissedSessionFor(p.id, now).catch((e): TaskOutcome => ({ ran: false, reason: `error: ${(e as Error).message}` }));
    outcomes.push({ patientId: p.id, missed });
  }
  return outcomes;
}
