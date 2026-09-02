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
