import { z } from "zod";
import prisma from "../../../utility/prismaClient";
import { clampRange, dateRange, defineTool, shiftDay, subjectField } from "./registry";

export const getActivity = defineTool({
  name: "get_activity",
  description:
    "Exercise minutes per day in a range (default: last 7 days; max 31) with session count (a day with ≥10 min counts as a session) and the plan's weekly exercise target. Steps/sleep/heart data live on the phone and arrive in the snapshot, not here.",
  schema: dateRange.extend({ subjectId: subjectField }),
  risk: "read",
  async run(ctx, input) {
    const subject = await ctx.resolveSubject(input.subjectId);
    const range = clampRange({ from: input.from ?? shiftDay(input.to ?? ctx.today, -6), to: input.to }, ctx.today);
    const [rows, plan] = await Promise.all([
      prisma.dailyExercise.findMany({
        where: { userId: subject.id, date: { gte: range.from, lt: range.next } },
        select: { date: true, minutesOfExercise: true },
        orderBy: { date: "asc" },
      }),
      subject.isSelf
        ? prisma.healthPlan.findFirst({ where: { patientId: ctx.patientId, status: "ACTIVE" }, include: { targets: true }, orderBy: { createdAt: "desc" } })
        : null,
    ]);
    const byDay = new Map<string, number>();
    for (const r of rows) byDay.set(r.date.slice(0, 10), (byDay.get(r.date.slice(0, 10)) ?? 0) + r.minutesOfExercise);
    const days = Array.from(byDay.entries()).map(([date, minutes]) => ({ date, minutes }));
    const result = {
      subject: subject.name,
      from: range.from,
      to: range.to,
      totalMinutes: days.reduce((a, d) => a + d.minutes, 0),
      sessions: days.filter((d) => d.minutes >= 10).length,
      weeklyTarget: plan?.targets.find((t) => t.pillar === "EXERCISE") ?? null,
      days,
    };
    return { result, cards: days.length ? [{ type: "activity", title: "Activity", data: result }] : [] };
  },
});
