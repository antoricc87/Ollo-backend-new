/**
 * WorkoutPlanService — a saved training week. The header is the only thing
 * this table owns; the sessions are PLANNED WorkoutSession rows (planId) that
 * WorkoutService completes in place. The view groups every session in the
 * week's date range by day — planned, completed-from-plan, and anything else
 * the user did that day — so "done" is read off the rows, never derived.
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
    const plan = await findActive(patientId);
    return plan ? this.view(patientId, plan) : null;
  }

  async view(patientId: string, plan: NonNullable<Awaited<ReturnType<typeof findActive>>>): Promise<WorkoutPlanView> {
    const tz = await WorkoutService.tzOf(patientId);
    const today = moment().tz(tz).format(DAY);
    const endDate = shiftDay(plan.startDate, plan.days - 1);
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
   * day's planned session (if any); with no active week it opens a one-day
   * plan so the app has a header to show.
   */
  async putOnDay(patientId: string, input: PlannedSessionInput) {
    const active = await findActive(patientId);
    if (active) {
      const endDate = shiftDay(active.startDate, active.days - 1);
      if (input.plannedFor >= active.startDate && input.plannedFor <= endDate) {
        const current = await prisma.workoutSession.findFirst({ where: { patientId, planId: active.id, plannedFor: input.plannedFor, status: "PLANNED", deletedAt: null }, select: { id: true } });
        if (current) await WorkoutService.replacePlanned(patientId, current.id, input);
        else await WorkoutService.createPlanned(patientId, input, { planId: active.id });
        return { plan: await this.view(patientId, active), replaced: !!current };
      }
    }
    const plan = await this.create(patientId, { title: input.title, days: 1, startDate: input.plannedFor, source: "ollie", sessions: [{ ...input, day: 1 }] });
    return { plan, replaced: false };
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
    const plan = await findActive(patientId);
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

export default new WorkoutPlanService();
