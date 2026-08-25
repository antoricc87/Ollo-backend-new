import { z } from "zod";
import prisma from "../../../utility/prismaClient";
import PlanService from "../../plan/model/plan.model";
import { defineTool } from "./registry";

export const getPlan = defineTool({
  name: "get_plan",
  description:
    "The user's active Health Plan in full: outcome, intensity, week number, every pillar target (sleep/exercise/nutrition) and nutrition watch-outs. The snapshot already has the short form; call this when discussing or adjusting the plan.",
  schema: z.object({}),
  risk: "read",
  async run(ctx) {
    const plan = await prisma.healthPlan.findFirst({
      where: { patientId: ctx.patientId, status: "ACTIVE" },
      include: { targets: true, watchOuts: true },
      orderBy: { createdAt: "desc" },
    });
    if (!plan) return { result: { plan: null, note: "No active plan. The user can create one from the Plan screen." } };
    const result = {
      id: plan.id,
      outcome: plan.outcome,
      intensity: plan.intensity,
      startedAt: plan.startedAt.toISOString().slice(0, 10),
      outcomeMetric: plan.outcomeMetric
        ? { metric: plan.outcomeMetric, start: plan.outcomeStart, target: plan.outcomeTarget, unit: plan.outcomeUnit }
        : null,
      labKey: plan.labKey,
      targets: plan.targets.map((t) => ({
        pillar: t.pillar,
        metricKey: t.metricKey,
        cadence: t.cadence,
        min: t.min,
        max: t.max,
        unit: t.unit,
        baseline: t.baseline,
        tolerance: t.tolerance,
      })),
      watchOuts: plan.watchOuts.map((w) => ({
        nutrientKey: w.nutrientKey,
        level: w.level,
        limit: w.limit,
        unit: w.unit,
        reason: w.reason,
      })),
    };
    return { result, cards: [{ type: "plan", title: "Your plan", data: result }] };
  },
});

const TARGET = z.object({
  pillar: z.enum(["SLEEP", "EXERCISE", "NUTRITION"]),
  metricKey: z.enum(["sleep_minutes", "exercise_sessions", "calories", "protein_g", "carbs_g", "fat_g"]),
  cadence: z.enum(["DAILY", "WEEKLY"]),
  min: z.number().nullable(),
  max: z.number().nullable(),
  unit: z.string().min(1),
});

export const updatePlanTargets = defineTool({
  name: "update_plan_targets",
  description:
    "Propose new pillar targets for the user's active plan (replaces the FULL target list — pass every target, changed or not). Use after a weekly review or when the user asks to adjust. Keep changes modest (≈5–10% for calories/macros, ±30 min sleep, ±1 session) and explain why. The user confirms in the app; saving also syncs calorie/macro limits used across the app.",
  schema: z.object({
    targets: z.array(TARGET).min(1).max(8),
    reason: z.string().min(5).max(300).describe("Why, in one sentence, with the data that motivates it"),
  }),
  risk: "write",
  async run(ctx, input) {
    const plan = await prisma.healthPlan.findFirst({ where: { patientId: ctx.patientId, status: "ACTIVE" }, include: { targets: true }, orderBy: { createdAt: "desc" } });
    if (!plan) return { result: { error: "no active plan to update" } };
    const before = plan.targets.map((t) => ({ pillar: t.pillar, metricKey: t.metricKey, cadence: t.cadence, min: t.min, max: t.max, unit: t.unit }));
    const changes = input.targets
      .map((t) => {
        const prev = before.find((b) => b.metricKey === t.metricKey && b.cadence === t.cadence);
        const same = prev && prev.min === t.min && prev.max === t.max;
        return same ? null : `${t.metricKey}: ${prev ? `${prev.min ?? "—"}–${prev.max ?? "—"}` : "new"} → ${t.min ?? "—"}–${t.max ?? "—"} ${t.unit}`;
      })
      .filter((x): x is string => !!x);
    const removed = before.filter((b) => !input.targets.some((t) => t.metricKey === b.metricKey && t.cadence === b.cadence)).map((b) => `${b.metricKey} removed`);
    const diff = [...changes, ...removed];
    if (!diff.length) return { result: { error: "targets identical to the current plan — nothing to propose" } };
    const preview = { planId: plan.id, before, after: input.targets, changes: diff, reason: input.reason };
    return {
      result: { previewOf: { changes: diff, reason: input.reason } },
      proposal: { title: "Adjust plan targets", summary: `${diff.join("; ")} — ${input.reason}`, preview },
    };
  },
  async commit(ctx, input) {
    const plan = await prisma.healthPlan.findFirst({ where: { patientId: ctx.patientId, status: "ACTIVE" }, orderBy: { createdAt: "desc" } });
    if (!plan) throw new Error("no active plan");
    const updated = await PlanService.replaceTargets(ctx.patientId, plan.id, input.targets);
    if (!updated) throw new Error("plan not found");
    const result = { updated: true, planId: plan.id, targets: updated.targets.map((t) => ({ metricKey: t.metricKey, min: t.min, max: t.max, unit: t.unit, cadence: t.cadence })) };
    return { result, cards: [{ type: "plan", title: "Plan updated", data: result }] };
  },
});
