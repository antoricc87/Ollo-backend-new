import moment from "moment";
import prisma from "../../../utility/prismaClient";

/**
 * Clinicians as the patient app sees them: a directory of `Clinician` rows
 * (no login — see schema) and the patient's care team (`CareTeamMember`
 * consent grants). This is the seam a future clinician service plugs into:
 * it would publish directory rows + availability here, and every access it
 * gets to a patient's data would be scoped by that patient's CareTeamMember.
 */

const DAY_FMT = "MM-DD-YYYY";

/** Upcoming availability weeks, days and slots — the shape the app's ScheduleModal reads. */
const availabilityInclude = () => ({
  availabilities: {
    where: { weekEndDate: { gte: moment().format(DAY_FMT) } },
    orderBy: { weekEndDate: "asc" as const },
    include: {
      days: {
        orderBy: { date: "asc" as const },
        include: { slots: { orderBy: { startTime: "asc" as const } } },
      },
    },
  },
});

export class ClinicianService {
  /** Active clinicians with their published availability. */
  async directory() {
    return prisma.clinician.findMany({
      where: { isActive: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      include: availabilityInclude(),
    });
  }

  async getById(clinicianId: string) {
    return prisma.clinician.findUnique({ where: { id: clinicianId } });
  }

  /** The patient's current (non-revoked) care team, with availability. */
  async careTeamOf(patientId: string) {
    const rows = await prisma.careTeamMember.findMany({
      where: { patientId, revokedAt: null },
      orderBy: { addedAt: "asc" },
      include: { clinician: { include: availabilityInclude() } },
    });
    return rows.map((r) => ({ ...r.clinician, careTeamSince: r.addedAt, careTeamSource: r.source }));
  }

  async isOnCareTeam(patientId: string, clinicianId: string) {
    const row = await prisma.careTeamMember.findUnique({
      where: { patientId_clinicianId: { patientId, clinicianId } },
      select: { revokedAt: true },
    });
    return !!row && row.revokedAt === null;
  }

  /** Idempotent: (re)activates the grant if it exists, creates it otherwise. */
  async addToCareTeam(patientId: string, clinicianId: string, source: "BOOKING" | "MANUAL" | "SEED" = "MANUAL") {
    const clinician = await prisma.clinician.findUnique({ where: { id: clinicianId }, select: { id: true, isActive: true } });
    if (!clinician || !clinician.isActive) throw new Error("clinician not found");
    return prisma.careTeamMember.upsert({
      where: { patientId_clinicianId: { patientId, clinicianId } },
      update: { revokedAt: null },
      create: { patientId, clinicianId, source },
    });
  }

  /** Revokes the grant (the row stays as an audit trail). */
  async removeFromCareTeam(patientId: string, clinicianId: string) {
    return prisma.careTeamMember.updateMany({
      where: { patientId, clinicianId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}

export default new ClinicianService();
