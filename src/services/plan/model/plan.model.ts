import prisma from "../../../utility/prismaClient";
import NutritionService from "../../nutrition/model/nutrition.model";
import { updatePatientSummarySection } from "../../patient/model/patient.model";
import { buildProposal, PlanProposal } from "./plan.proposal";

const PILLARS = ["SLEEP", "EXERCISE", "NUTRITION"];
const CADENCES = ["DAILY", "WEEKLY"];
const LEVELS = ["WATCH", "LIMIT"];

const num = (v: any): number | null =>
  v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v);

/** Whitelist + coerce a target coming from the client. */
const cleanTarget = (t: any) => {
  if (!PILLARS.includes(t?.pillar) || !CADENCES.includes(t?.cadence) || !t?.metricKey)
    throw new Error(`Invalid target: ${JSON.stringify(t)}`);
  return {
    pillar: t.pillar,
    metricKey: String(t.metricKey),
    cadence: t.cadence,
    min: num(t.min),
    max: num(t.max),
    unit: String(t.unit ?? ""),
    baseline: num(t.baseline),
    tolerance: num(t.tolerance) ?? 0,
  };
};

const cleanWatchOut = (w: any) => {
  if (!w?.nutrientKey) throw new Error(`Invalid watch-out: ${JSON.stringify(w)}`);
  return {
    nutrientKey: String(w.nutrientKey),
    level: LEVELS.includes(w.level) ? w.level : "WATCH",
    limit: num(w.limit),
    unit: w.unit ? String(w.unit) : null,
    reason: w.reason ? String(w.reason) : null,
  };
};

const include = { targets: true, watchOuts: true } as const;

class PlanService {
  async getActivePlan(patientId: string) {
    return prisma.healthPlan.findFirst({
      where: { patientId, status: "ACTIVE" },
      include,
      orderBy: { createdAt: "desc" },
    });
  }

  async propose(
    patientId: string,
    args: { outcome: any; intensity: any; labKey: string | null; baselines: any }
  ): Promise<PlanProposal> {
    const patient = await prisma.patient.findUnique({
      where: { id: patientId },
      include: {
        patientSummary: {
          include: {
            vitals: true,
            exercise: true,
            labResults: {
              include: { labResults: true },
              orderBy: { createdAt: "desc" },
              take: 1,
            },
          },
        },
      },
    });
    if (!patient) throw new Error("Patient not found");
    const summary: any = patient.patientSummary;
    const latestLabs: any[] = summary?.labResults?.[0]?.labResults ?? [];

    return buildProposal({
      outcome: args.outcome,
      intensity: args.intensity,
      labKey: args.labKey,
      patient: { dob: patient.dob, gender: patient.gender },
      vitals: summary?.vitals ?? null,
      exerciseFrequency: summary?.exercise?.frequency ?? null,
      labs: latestLabs.map((l) => ({
        testType: l.testType,
        isOutOfRange: !!l.isOutOfRange,
        result: l.result,
      })),
      baselines: {
        sleepMinutesAvg: num(args.baselines?.sleepMinutesAvg),
        exerciseSessionsPerWeek: num(args.baselines?.exerciseSessionsPerWeek),
        weightKg: num(args.baselines?.weightKg),
      },
    });
  }

  async createPlan(patientId: string, body: any) {
    const targets = body.targets.map(cleanTarget);
    const watchOuts = (body.watchOuts ?? []).map(cleanWatchOut);

    const plan = await prisma.$transaction(async (tx) => {
      await tx.healthPlan.updateMany({
        where: { patientId, status: "ACTIVE" },
        data: { status: "REPLACED", endedAt: new Date() },
      });
      return tx.healthPlan.create({
        data: {
          patientId,
          outcome: body.outcome,
          intensity: body.intensity,
          outcomeMetric: body.outcomeMetric ?? null,
          outcomeStart: num(body.outcomeStart),
          outcomeTarget: num(body.outcomeTarget),
          outcomeUnit: body.outcomeUnit ?? null,
          labKey: body.labKey ?? null,
          targets: { create: targets },
          watchOuts: { create: watchOuts },
        },
        include,
      });
    });

    await this.syncNutritionTargets(patientId, plan.targets, plan.watchOuts);
    return plan;
  }

  async replaceTargets(patientId: string, planId: string, targets: any[]) {
    const owned = await prisma.healthPlan.findFirst({ where: { id: planId, patientId } });
    if (!owned) return null;
    const clean = targets.map(cleanTarget);
    const plan = await prisma.$transaction(async (tx) => {
      await tx.planTarget.deleteMany({ where: { planId } });
      await tx.planTarget.createMany({ data: clean.map((t) => ({ ...t, planId })) });
      return tx.healthPlan.findUnique({ where: { id: planId }, include });
    });
    if (plan) await this.syncNutritionTargets(patientId, plan.targets, plan.watchOuts);
    return plan;
  }

  async replaceWatchOuts(patientId: string, planId: string, watchOuts: any[]) {
    const owned = await prisma.healthPlan.findFirst({ where: { id: planId, patientId } });
    if (!owned) return null;
    const clean = watchOuts.map(cleanWatchOut);
    const plan = await prisma.$transaction(async (tx) => {
      await tx.planWatchOut.deleteMany({ where: { planId } });
      await tx.planWatchOut.createMany({ data: clean.map((w) => ({ ...w, planId })) });
      return tx.healthPlan.findUnique({ where: { id: planId }, include });
    });
    if (plan) await this.syncNutritionTargets(patientId, plan.targets, plan.watchOuts);
    return plan;
  }

  async updateStatus(patientId: string, planId: string, status: any) {
    const owned = await prisma.healthPlan.findFirst({ where: { id: planId, patientId } });
    if (!owned) return null;
    return prisma.healthPlan.update({
      where: { id: planId },
      data: {
        status,
        endedAt: status === "COMPLETED" || status === "REPLACED" ? new Date() : null,
      },
      include,
    });
  }

  /**
   * Bridge to the Nutrition page: the plan's daily nutrition targets become
   * the MacroNutrientsTracker limits and PatientSummary.caloricAmount, so the
   * existing food-logging UI and the agent's meal suggestions read the same
   * numbers. Non-fatal — the plan itself is already saved.
   */
  private async syncNutritionTargets(patientId: string, targets: any[], watchOuts: any[]) {
    try {
      const mid = (t: any) =>
        t.min != null && t.max != null ? (t.min + t.max) / 2 : t.max ?? t.min ?? null;
      const byKey: Record<string, any> = {};
      for (const t of targets) if (t.pillar === "NUTRITION") byKey[t.metricKey] = t;

      const limits: Record<string, number> = {};
      if (byKey.protein_g) limits.proteinsLimit = Math.round(mid(byKey.protein_g));
      if (byKey.carbs_g) limits.carbohydratesLimit = Math.round(mid(byKey.carbs_g));
      if (byKey.fat_g) limits.fatsLimit = Math.round(mid(byKey.fat_g));
      for (const w of watchOuts) {
        if (w.level !== "LIMIT" || w.limit == null) continue;
        if (w.nutrientKey === "sodium") limits.sodiumLimit = w.limit;
        if (w.nutrientKey === "cholesterol") limits.cholesterolLimit = w.limit;
        if (w.nutrientKey === "added_sugar") limits.addedSugarLimit = w.limit;
      }
      if (Object.keys(limits).length) await NutritionService.createTracker(patientId, limits);

      if (byKey.calories) {
        const caloricAmount = Math.round(mid(byKey.calories));
        await updatePatientSummarySection(patientId, "caloricAmount", [{ caloricAmount }]);
      }
    } catch (error) {
      console.error("Plan → nutrition sync failed (non-fatal)", error);
    }
  }
}

export default new PlanService();
