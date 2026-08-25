import { z } from "zod";
import prisma from "../../../utility/prismaClient";
import { parseStoredDate } from "../memory/dates";
import { clampRange, dateRange, defineTool, shiftDay, subjectField } from "./registry";

const VITAL_KINDS = ["weight", "body_fat", "blood_pressure", "glucose"] as const;

export const getVitals = defineTool({
  name: "get_vitals",
  description:
    "Logged readings for one vital — weight, body_fat, blood_pressure or glucose — in a date range (default: last 30 days; max 90 days for weight/body fat, 31 otherwise), newest first. Use for trends and 'what was my BP last week'.",
  schema: dateRange.extend({
    kind: z.enum(VITAL_KINDS),
    subjectId: subjectField,
  }),
  risk: "read",
  async run(ctx, input) {
    const subject = await ctx.resolveSubject(input.subjectId);
    const maxDays = input.kind === "weight" || input.kind === "body_fat" ? 90 : 31;
    const range = clampRange({ from: input.from ?? shiftDay(input.to ?? ctx.today, -29), to: input.to }, ctx.today, maxDays);
    const inRange = (at: Date | null) => !!at && at.toISOString().slice(0, 10) >= range.from && at.toISOString().slice(0, 10) < range.next;
    let readings: { at: string; [k: string]: unknown }[] = [];
    switch (input.kind) {
      case "weight": {
        const rows = await prisma.weightEntry.findMany({ where: { tracker: { userId: subject.id } }, orderBy: { createdAt: "desc" }, take: 400 });
        readings = rows
          .map((r) => ({ at: parseStoredDate(r.createdAt), value: r.weight, unit: r.unit }))
          .filter((r) => inRange(r.at))
          .map((r) => ({ at: r.at!.toISOString().slice(0, 10), value: r.value, unit: r.unit }));
        break;
      }
      case "body_fat": {
        const rows = await prisma.bFPEntry.findMany({ where: { tracker: { userId: subject.id } }, orderBy: { createdAt: "desc" }, take: 400 });
        readings = rows
          .map((r) => ({ at: parseStoredDate(r.createdAt), percent: r.percentage }))
          .filter((r) => inRange(r.at))
          .map((r) => ({ at: r.at!.toISOString().slice(0, 10), percent: r.percent }));
        break;
      }
      case "blood_pressure": {
        const rows = await prisma.bloodPressureEntry.findMany({ where: { dailyTracker: { userId: subject.id } }, orderBy: { createdAt: "desc" }, take: 400 });
        readings = rows
          .map((r) => ({ at: parseStoredDate(r.createdAt), systolic: r.systolic, diastolic: r.diastolic, pulse: r.pulse }))
          .filter((r) => inRange(r.at))
          .map((r) => ({ at: r.at!.toISOString(), systolic: r.systolic, diastolic: r.diastolic, pulse: r.pulse }));
        break;
      }
      case "glucose": {
        const rows = await prisma.glucoseEntry.findMany({ where: { dailyTracker: { userId: subject.id } }, orderBy: { createdAt: "desc" }, take: 400 });
        readings = rows
          .map((r) => ({ at: parseStoredDate(r.createdAt), value: r.value }))
          .filter((r) => inRange(r.at))
          .map((r) => ({ at: r.at!.toISOString(), value: r.value }));
        break;
      }
    }
    const result = { subject: subject.name, kind: input.kind, from: range.from, to: range.to, count: readings.length, readings: readings.slice(0, 120) };
    return { result, cards: readings.length ? [{ type: "vitals", title: input.kind.replace("_", " "), data: result }] : [] };
  },
});
