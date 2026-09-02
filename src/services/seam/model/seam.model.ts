import prisma from "../../../utility/prismaClient";
import { ClinicianUpsert } from "../seam.schema";

export class SeamConflictError extends Error {}

class SeamService {
  /**
   * Upsert a directory row by the clinician service's id (`externalId`).
   * A pre-existing row with the same email and NO externalId (e.g. the dev
   * seed) is adopted rather than duplicated, so grants and published slots
   * survive the hand-over. An email already owned by a DIFFERENT external id
   * is a conflict.
   */
  async upsertClinician(externalId: string, data: ClinicianUpsert) {
    const { acceptedInsurances, isActive, ...fields } = data;
    const byEmail = await prisma.clinician.findUnique({ where: { email: data.email }, select: { id: true, externalId: true } });
    if (byEmail?.externalId && byEmail.externalId !== externalId) {
      throw new SeamConflictError("Email already belongs to another clinician");
    }
    const payload = {
      ...fields,
      email: data.email,
      firstName: data.firstName,
      lastName: data.lastName,
      ...(acceptedInsurances ? { acceptedInsurances } : {}),
      ...(isActive === undefined ? {} : { isActive }),
    };
    if (byEmail && !byEmail.externalId) {
      return prisma.clinician.update({ where: { id: byEmail.id }, data: { ...payload, externalId } });
    }
    return prisma.clinician.upsert({
      where: { externalId },
      create: { ...payload, externalId, isActive: isActive ?? true },
      update: payload,
    });
  }
}

export default new SeamService();

/* ------------------------------ Patient reads ------------------------------ */
// Everything below is scoped by an ACTIVE CareTeamMember (checked in the route
// chain by requireGrant) and reuses the same builders the patient app uses.

import { buildPatientSnapshot } from "../../agent/context/snapshot";
import { fetchCurrentLabs } from "../../patient/model/patient.model";
import LabsJourneyService from "../../labs_journey/model/labsJourney.model";
import PlanService from "../../plan/model/plan.model";

export type SeamPatientRow = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  dob: Date | null;
  gender: string | null;
  email: string;
  grant: { source: string; addedAt: Date };
  lastActivityAt: Date | null;
};

const asDate = (s: string | Date | null | undefined): Date | null => {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

export class SeamPatientService {
  /** Patients who currently grant this clinician access, newest grant first. */
  static async patientsOf(clinicianId: string): Promise<SeamPatientRow[]> {
    const grants = await prisma.careTeamMember.findMany({
      where: { clinicianId, revokedAt: null },
      include: { patient: { select: { id: true, firstName: true, lastName: true, dob: true, gender: true, email: true } } },
      orderBy: { addedAt: "desc" },
    });
    const rows = await Promise.all(
      grants.map(async (g) => {
        const last = await prisma.agentAuditLog.findFirst({ where: { patientId: g.patientId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
        return { ...g.patient, grant: { source: g.source, addedAt: g.addedAt }, lastActivityAt: last?.createdAt ?? null };
      })
    );
    return rows;
  }

  /** The Ollie snapshot minus what is the patient's private context (memories, sub-accounts, client). */
  static async snapshot(patientId: string) {
    const s = await buildPatientSnapshot(patientId);
    if (!s) return null;
    const { memories: _m, subAccounts: _s, client: _c, mealPlan: _mp, ...rest } = s;
    return rest;
  }

  static labsCurrent = (patientId: string) => fetchCurrentLabs(patientId);
  static risk = (patientId: string) => LabsJourneyService.getRisk(patientId);
  static plan = (patientId: string) => PlanService.getActivePlan(patientId);

  /** Tracker series for the last `days` days, one shape, ascending by time. */
  static async trackers(patientId: string, days: number) {
    const from = new Date(Date.now() - days * 24 * 3600 * 1000);
    const inRange = <T extends { at: Date | null }>(xs: T[]) =>
      xs.filter((x): x is T & { at: Date } => !!x.at && x.at >= from).sort((a, b) => a.at.getTime() - b.at.getTime());
    const iso = <T extends { at: Date }>(xs: T[]) => xs.map((x) => ({ ...x, at: x.at.toISOString() }));

    const [weight, bfp, bp, glucose, calories, exercise] = await Promise.all([
      prisma.weightEntry.findMany({ where: { tracker: { userId: patientId } }, select: { createdAt: true, weight: true, unit: true } }),
      prisma.bFPEntry.findMany({ where: { tracker: { userId: patientId } }, select: { createdAt: true, percentage: true } }),
      prisma.bloodPressureEntry.findMany({ where: { dailyTracker: { userId: patientId } }, select: { createdAt: true, systolic: true, diastolic: true, pulse: true } }),
      prisma.glucoseEntry.findMany({ where: { dailyTracker: { userId: patientId } }, select: { createdAt: true, value: true } }),
      prisma.dailyCalories.findMany({ where: { userId: patientId }, select: { date: true, caloriesIntake: true, caloriesBurned: true } }),
      prisma.dailyExercise.findMany({ where: { userId: patientId }, select: { date: true, minutesOfExercise: true } }),
    ]);
    return {
      from: from.toISOString(),
      to: new Date().toISOString(),
      weight: iso(inRange(weight.map((w) => ({ at: asDate(w.createdAt), value: w.weight, unit: w.unit })))),
      bodyFat: iso(inRange(bfp.map((b) => ({ at: asDate(b.createdAt), value: b.percentage })))),
      bloodPressure: iso(inRange(bp.map((b) => ({ at: asDate(b.createdAt), systolic: b.systolic, diastolic: b.diastolic, pulse: b.pulse })))),
      glucose: iso(inRange(glucose.map((g) => ({ at: asDate(g.createdAt), value: g.value })))),
      calories: iso(inRange(calories.map((c) => ({ at: asDate(c.date), intake: c.caloriesIntake, burned: c.caloriesBurned })))),
      exercise: iso(inRange(exercise.map((e) => ({ at: asDate(e.date), minutes: e.minutesOfExercise })))),
    };
  }
}
