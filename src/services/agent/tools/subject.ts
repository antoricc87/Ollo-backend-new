import prisma from "../../../utility/prismaClient";

/**
 * Sub-account resolution. The model may name a family member; the tool layer
 * only ever acts on the authenticated patient or one of THEIR sub-accounts.
 */
export const makeSubjectResolver = (patientId: string) => {
  let cache: { id: string; name: string }[] | null = null;
  const load = async () => {
    if (!cache) {
      const rows = await prisma.patient.findMany({
        where: { subAccountOf: patientId },
        select: { id: true, firstName: true, lastName: true },
      });
      cache = rows.map((r) => ({ id: r.id, name: [r.firstName, r.lastName].filter(Boolean).join(" ") || "unnamed" }));
    }
    return cache;
  };
  return async (subjectId?: string | null) => {
    if (!subjectId || subjectId === patientId || subjectId === "self")
      return { id: patientId, name: "you", isSelf: true };
    const subs = await load();
    const hit = subs.find((s) => s.id === subjectId);
    if (!hit) throw new Error(`subjectId ${subjectId} is not one of this account's sub-accounts (use list_subaccounts)`);
    return { ...hit, isSelf: false };
  };
};
