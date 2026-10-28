/**
 * WorkoutPlanService — a saved training week. The header is the only thing
 * this table owns; the sessions are PLANNED WorkoutSession rows (planId) that
 * WorkoutService completes in place. The view groups every session in the
 * week's date range by day — planned, completed-from-plan, and anything else
 * the user did that day — so "done" is read off the rows, never derived.
 *
 * A week ends on its last day: the first read after that marks it COMPLETED
 * and drops its sessions still PLANNED (his ruling: past weeks keep only what
 * was done — no "missed" history). Until a new week is saved there is no
 * current week; Ollie's newest unsaved draft (Sunday run or chat) is offered
 * instead, read from the card it already stored in the conversation.
 */
import moment from "moment-timezone";
import prisma from "../../../utility/prismaClient";
import WorkoutService, { type SessionRecord } from "./workouts.model";
import { activityByKey } from "../domain/activity.catalog";
import { fmtDuration, fmtSets } from "../domain/workout.metrics";
import type { PlannedSessionInput, WorkoutPlanInput } from "../domain/workout.schema";

const DAY = "YYYY-MM-DD";
export const shiftDay = (day: string, delta: number) => moment.utc(day, DAY).add(delta, "days").format(DAY);

export type PlanStatusName = "ACTIVE" | "PAUSED" | "COMPLETED" | "REPLACED";

export type WorkoutPlanDay = {
  day: number;
  date: string;
  /** The session designed for this day (PLANNED, or COMPLETED in place), null on a rest day. */
  planned: SessionRecord | null;
  /** Everything else done that day (watch workouts, described sessions not tied to the plan). */
  other: SessionRecord[];
  state: "planned" | "done" | "missed" | "rest" | "other";
};

export type WorkoutPlanView = {
  id: string;
  title: string;
  notes: string | null;
  startDate: string;
  endDate: string;
  days: number;
  status: PlanStatusName;
  brief: unknown;
  fit: unknown;
  source: string | null;
  createdAt: Date;
  today: string;
  todayIndex: number | null;
  planned: number;
  done: number;
  daysOut: WorkoutPlanDay[];
};

const findActive = (patientId: string) => prisma.workoutPlan.findFirst({ where: { patientId, status: "ACTIVE" }, orderBy: { createdAt: "desc" } });
type PlanRow = NonNullable<Awaited<ReturnType<typeof findActive>>>;

const SAVED: PlanStatusName[] = ["ACTIVE", "COMPLETED", "REPLACED"];
const endOf = (plan: Pick<PlanRow, "startDate" | "days">) => shiftDay(plan.startDate, plan.days - 1);
const todayIn = async (patientId: string) => moment().tz(await WorkoutService.tzOf(patientId)).format(DAY);

/** Close a week whose last day has passed: COMPLETED, unfinished PLANNED rows dropped. */
const retire = async (patientId: string, planId: string) => {
  await prisma.workoutSession.updateMany({ where: { patientId, planId, status: "PLANNED", deletedAt: null }, data: { deletedAt: new Date() } });
  await prisma.workoutPlan.update({ where: { id: planId }, data: { status: "COMPLETED" } });
};

/** The ACTIVE week if it still covers today or later; an ended one is retired on the way. */
const findCurrent = async (patientId: string): Promise<PlanRow | null> => {
  const plan = await findActive(patientId);
  if (!plan) return null;
  if (endOf(plan) >= (await todayIn(patientId))) return plan;
  await retire(patientId, plan.id);
  return null;
};

/** Sets as the prescription reads on the card: "4 × 8–10 @ 60 kg". */
export const fmtTargets = (sets: SessionRecord["exercises"][number]["sets"]) => {
  const work = sets.filter((s) => !s.isWarmup);
  if (!work.length) return "";
  const s = work[0];
  const reps = s.targetReps != null ? (s.targetRepsMax != null && s.targetRepsMax !== s.targetReps ? `${s.targetReps}–${s.targetRepsMax}` : `${s.targetReps}`) : s.durationSec ? `${s.durationSec} s` : s.distanceM ? `${s.distanceM} m` : "";
  const load = s.targetKg != null ? ` @ ${s.targetKg} kg` : "";
  return `${work.length} × ${reps}${load}`.trim();
};

class WorkoutPlanService {
  async getActive(patientId: string): Promise<WorkoutPlanView | null> {
    const plan = await findCurrent(patientId);
    return plan ? this.view(patientId, plan) : null;
  }

  async view(patientId: string, plan: PlanRow): Promise<WorkoutPlanView> {
    const tz = await WorkoutService.tzOf(patientId);
    const today = moment().tz(tz).format(DAY);
    const endDate = endOf(plan);
    const from = moment.tz(plan.startDate, DAY, tz).startOf("day").toDate();
    const to = moment.tz(endDate, DAY, tz).endOf("day").toDate();
    const rows = await WorkoutService.list(patientId, { from, to }, { status: "ALL", limit: 200 });
    const dayOf = (s: SessionRecord) => s.plannedFor ?? moment(s.startedAt).tz(tz).format(DAY);
    const daysOut: WorkoutPlanDay[] = [];
    let planned = 0, done = 0;
    for (let day = 1; day <= plan.days; day++) {
      const date = shiftDay(plan.startDate, day - 1);
      const onDay = rows.filter((s) => dayOf(s) === date);
      const mine = onDay.find((s) => s.planId === plan.id) ?? null;
      const other = onDay.filter((s) => s.id !== mine?.id);
      let state: WorkoutPlanDay["state"] = "rest";
      if (mine) {
        planned += 1;
        if (mine.status === "COMPLETED") {
          done += 1;
          state = "done";
        } else state = date < today ? "missed" : "planned";
      } else if (other.length) state = "other";
      daysOut.push({ day, date, planned: mine, other, state });
    }
    const idx = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${plan.startDate}T00:00:00Z`)) / 86_400_000) + 1;
    return {
      id: plan.id,
      title: plan.title,
      notes: plan.notes,
      startDate: plan.startDate,
      endDate,
      days: plan.days,
      status: plan.status as PlanStatusName,
      brief: plan.brief,
      fit: plan.fit,
      source: plan.source,
      createdAt: plan.createdAt,
      today,
      todayIndex: idx >= 1 && idx <= plan.days ? idx : null,
      planned,
      done,
      daysOut,
    };
  }

  /**
   * Save a week. The previous ACTIVE plan becomes REPLACED and its rows that
   * are still PLANNED are soft-deleted; sessions already completed stay as
   * history (their planId is kept, so the old week still reads correctly).
   */
  async create(patientId: string, input: WorkoutPlanInput) {
    const tz = await WorkoutService.tzOf(patientId);
    const startDate = input.startDate ?? moment().tz(tz).format(DAY);
    const previous = await findActive(patientId);
    if (previous) {
      await prisma.workoutSession.updateMany({ where: { patientId, planId: previous.id, status: "PLANNED", deletedAt: null }, data: { deletedAt: new Date() } });
      await prisma.workoutPlan.update({ where: { id: previous.id }, data: { status: "REPLACED" } });
    }
    const plan = await prisma.workoutPlan.create({
      data: {
        patientId,
        title: input.title,
        notes: input.notes ?? null,
        startDate,
        days: input.days,
        brief: (input.brief ?? undefined) as any,
        fit: (input.fit ?? undefined) as any,
        source: input.source ?? "ollie",
      },
    });
    for (const s of input.sessions) {
      const { day, ...rest } = s;
      if (day > input.days) continue;
      await WorkoutService.createPlanned(patientId, { ...rest, plannedFor: shiftDay(startDate, day - 1) } as PlannedSessionInput, { planId: plan.id, source: input.source === "manual" ? "MANUAL" : "OLLIE" });
    }
    return this.view(patientId, plan);
  }

  /**
   * Put one designed workout on a day. Inside the active week it replaces that
   * day's planned session (if any); with no active week (or a day outside it)
   * it opens the ISO week that day belongs to — Monday to Sunday — so the app
   * shows a whole week with this session on its day, never a one-day plan.
   */
  async putOnDay(patientId: string, input: PlannedSessionInput) {
    const active = await findCurrent(patientId);
    if (active) {
      const endDate = endOf(active);
      if (input.plannedFor >= active.startDate && input.plannedFor <= endDate) {
        const current = await prisma.workoutSession.findFirst({ where: { patientId, planId: active.id, plannedFor: input.plannedFor, status: "PLANNED", deletedAt: null }, select: { id: true } });
        if (current) await WorkoutService.replacePlanned(patientId, current.id, input);
        else await WorkoutService.createPlanned(patientId, input, { planId: active.id });
        return { plan: await this.view(patientId, active), replaced: !!current };
      }
    }
    const monday = moment.utc(input.plannedFor, DAY).startOf("isoWeek").format(DAY);
    const day = Math.round((Date.parse(`${input.plannedFor}T00:00:00Z`) - Date.parse(`${monday}T00:00:00Z`)) / 86_400_000) + 1;
    const plan = await this.create(patientId, { title: "This week", days: 7, startDate: monday, source: "ollie", sessions: [{ ...input, day }] });
    return { plan, replaced: false };
  }

  /**
   * Ollie's newest week card not yet saved: the Sunday draft or one from chat,
   * newer than the last saved week and not over yet. The card is the one the
   * conversation stored (drafts in memory don't survive a deploy).
   */
  async pendingDraft(patientId: string): Promise<{ card: any; threadId: string; at: Date } | null> {
    const today = await todayIn(patientId);
    const lastSaved = await prisma.workoutPlan.findFirst({ where: { patientId, status: { in: SAVED } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
    const since = new Date(Math.max(lastSaved?.createdAt.getTime() ?? 0, Date.now() - 14 * 86_400_000));
    const rows = await prisma.agentMessage.findMany({
      where: { role: "ASSISTANT", createdAt: { gt: since }, thread: { patientId } },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { cards: true, threadId: true, createdAt: true },
    });
    for (const r of rows) {
      const cards = Array.isArray(r.cards) ? (r.cards as any[]) : [];
      for (const c of [...cards].reverse()) {
        const d = c?.type === "workout_plan" ? c.data : null;
        if (!d || d.saved || !d.sessions?.length || !d.startDate) continue;
        if (endOf({ startDate: d.startDate, days: Number(d.days) || 7 }) < today) return null; // the newest draft is already over
        return { card: d, threadId: r.threadId, at: r.createdAt };
      }
    }
    return null;
  }

  /**
   * The last saved week again, on the same weekdays of this week (days already
   * past are skipped; with none left it goes on next week). Built in code from
   * the sessions as they were planned — no model call. Null with no saved week.
   */
  async repeatLast(patientId: string) {
    const last = await prisma.workoutPlan.findFirst({ where: { patientId, status: { in: SAVED } }, orderBy: { createdAt: "desc" } });
    if (!last) return null;
    // One row per planned day: the live row, else the newest dropped one (a replaced or retired planned row).
    const rows = await prisma.workoutSession.findMany({ where: { patientId, planId: last.id, plannedFor: { not: null } }, orderBy: { createdAt: "desc" }, include: { exercises: { orderBy: { sortOrder: "asc" }, include: { sets: { orderBy: { sortOrder: "asc" } } } } } });
    const byDay = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      const kept = byDay.get(r.plannedFor!);
      if (!kept || (kept.deletedAt && !r.deletedAt)) byDay.set(r.plannedFor!, r);
    }
    if (!byDay.size) return null;
    const today = await todayIn(patientId);
    const thisMonday = moment.utc(today, DAY).startOf("isoWeek").format(DAY);
    const weekdays = [...byDay.keys()].map((d) => moment.utc(d, DAY).isoWeekday());
    const monday = weekdays.some((w) => shiftDay(thisMonday, w - 1) >= today) ? thisMonday : shiftDay(thisMonday, 7);
    const sessions = [...byDay.values()]
      .map((r) => ({ r, day: moment.utc(r.plannedFor!, DAY).isoWeekday() }))
      .filter(({ day }) => shiftDay(monday, day - 1) >= today)
      .map(({ r, day }) => ({
        day,
        activityKey: r.activityKey as PlannedSessionInput["activityKey"],
        title: r.title ?? activityByKey(r.activityKey).label,
        durationMin: Math.max(5, Math.round((r.durationSec ?? 2700) / 60)),
        focus: (r.focus ?? "mixed") as PlannedSessionInput["focus"],
        place: (r.place ?? null) as PlannedSessionInput["place"],
        muscleGroups: r.muscleGroups,
        why: r.why,
        warmup: r.warmup,
        cooldown: r.cooldown,
        notes: r.notes,
        distanceKm: r.distanceKm,
        // The prescription; a set completed without one keeps what was done as the target.
        exercises: r.exercises.map((e) => ({
          exerciseKey: e.exerciseKey,
          name: e.name,
          muscleGroup: e.muscleGroup,
          equipment: e.equipment,
          notes: e.notes,
          loadNote: e.loadNote,
          alternatives: e.alternatives,
          sets: e.sets.map((x) => ({ durationSec: x.durationSec, distanceM: x.distanceM, isWarmup: x.isWarmup, targetReps: x.targetReps ?? x.reps, targetRepsMax: x.targetRepsMax, targetKg: x.targetKg ?? x.weightKg, restSec: x.restSec })),
        })),
      }));
    return this.create(patientId, { title: last.title, notes: last.notes, startDate: monday, days: 7, brief: last.brief as any, fit: null, source: "manual", sessions });
  }

  async updateStatus(patientId: string, planId: string, status: PlanStatusName) {
    const owned = await prisma.workoutPlan.findFirst({ where: { id: planId, patientId } });
    if (!owned) return null;
    const plan = await prisma.workoutPlan.update({ where: { id: planId }, data: { status } });
    if (status !== "ACTIVE") await prisma.workoutSession.updateMany({ where: { patientId, planId, status: "PLANNED", deletedAt: null }, data: { deletedAt: new Date() } });
    return this.view(patientId, plan);
  }

  /** Compact block for the agent snapshot: today's session, the next one, the week's tally. */
  async forSnapshot(patientId: string, today: string) {
    const plan = await findCurrent(patientId);
    if (!plan) return null;
    const v = await this.view(patientId, plan);
    const line = (s: SessionRecord) =>
      `${s.title ?? activityByKey(s.activityKey).label} (${s.focus ?? activityByKey(s.activityKey).shape}, ${fmtDuration(s.durationSec)}${s.place ? `, ${s.place}` : ""})` +
      (s.exercises.length ? ` — ${s.exercises.slice(0, 6).map((e) => `${e.name} ${s.status === "COMPLETED" ? fmtSets(e.sets) : fmtTargets(e.sets)}`.trim()).join("; ")}` : "");
    const todayDay = v.daysOut.find((d) => d.date === today) ?? null;
    const next = v.daysOut.find((d) => d.date > today && d.planned && d.state === "planned") ?? null;
    return {
      id: v.id,
      title: v.title,
      startDate: v.startDate,
      endDate: v.endDate,
      days: v.days,
      todayIndex: v.todayIndex,
      planned: v.planned,
      done: v.done,
      ended: today > v.endDate,
      notStarted: today < v.startDate,
      today: todayDay?.planned ? { id: todayDay.planned.id, state: todayDay.state, text: line(todayDay.planned) } : null,
      next: next?.planned ? { id: next.planned.id, date: next.date, text: line(next.planned) } : null,
      week: v.daysOut.map((d) => `${moment.utc(d.date, DAY).format("ddd")} ${d.state === "rest" ? "rest" : d.state === "other" ? `other: ${d.other.map((o) => o.title ?? activityByKey(o.activityKey).label).join(", ")}` : `${d.state}: ${d.planned!.title ?? activityByKey(d.planned!.activityKey).label}`}`),
    };
  }
}

/**
 * The training week they saved last (active or since replaced): what it was
 * asked for, at what length, on which weekdays. Feeds the defaults and the
 * Sunday planning run, so a new week starts from the last one they chose.
 */
export const lastSavedWeek = async (patientId: string): Promise<{ title: string; request: string | null; sessionMinutes: number | null; days: string[]; focus: string | null } | null> => {
  const plan = await prisma.workoutPlan.findFirst({
    where: { patientId, status: { in: ["ACTIVE", "REPLACED", "COMPLETED"] } },
    orderBy: { createdAt: "desc" },
    select: { title: true, brief: true, sessions: { select: { plannedFor: true } } },
  });
  if (!plan) return null;
  const brief = (plan.brief ?? {}) as { request?: string | null; sessionMinutes?: number | null; focus?: string | null };
  const days = Array.from(new Set(plan.sessions.filter((s) => s.plannedFor).map((s) => moment.utc(s.plannedFor!, "YYYY-MM-DD").format("ddd").toLowerCase())));
  return { title: plan.title, request: brief.request ?? null, sessionMinutes: typeof brief.sessionMinutes === "number" ? brief.sessionMinutes : null, days, focus: brief.focus ?? null };
};

export default new WorkoutPlanService();
