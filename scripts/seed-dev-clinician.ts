/**
 * Idempotent dev seed: a Clinician directory row ("Dr. Giulia Rossi"), a week
 * of published 30-minute slots (09:00–12:00, next 7 days), and a CareTeamMember
 * grant for the given patient — so the care-team screen, booking sheet,
 * message_care_team and book_appointment can be exercised end-to-end.
 *   npx ts-node --transpile-only scripts/seed-dev-clinician.ts [patient-email]
 */
import "dotenv/config";
import moment from "moment";
import prisma from "../src/utility/prismaClient";

export const DEV_CLINICIAN_EMAIL = "dev-clinician@ollo.test";
const DAY_FMT = "MM-DD-YYYY";

async function seedAvailability(clinicianId: string) {
  const start = moment().startOf("day");
  const weekStartDate = start.format(DAY_FMT);
  const weekEndDate = start.clone().add(6, "days").format(DAY_FMT);
  const existing = await prisma.weeklyAvailability.findFirst({ where: { clinicianId, weekStartDate, weekEndDate } });
  if (existing) return existing.id;
  const week = await prisma.weeklyAvailability.create({ data: { clinicianId, weekStartDate, weekEndDate } });
  for (let d = 0; d < 7; d++) {
    const day = await prisma.dailyAvailability.create({ data: { weekId: week.id, date: start.clone().add(d, "days").format(DAY_FMT) } });
    const slots = [];
    for (let h = 9; h < 12; h++) for (const m of ["00", "30"]) {
      const startTime = `${String(h).padStart(2, "0")}:${m}`;
      const endTime = m === "00" ? `${String(h).padStart(2, "0")}:30` : `${String(h + 1).padStart(2, "0")}:00`;
      slots.push({ dailyAvailabilityId: day.id, startTime, endTime, isAvailable: true });
    }
    await prisma.timeSlot.createMany({ data: slots });
  }
  return week.id;
}

export async function seedClinicianFor(patientEmail: string) {
  const patient = await prisma.patient.findUnique({ where: { email: patientEmail }, select: { id: true } });
  if (!patient) throw new Error(`patient ${patientEmail} not found`);
  const clinician = await prisma.clinician.upsert({
    where: { email: DEV_CLINICIAN_EMAIL },
    update: { isActive: true },
    create: {
      email: DEV_CLINICIAN_EMAIL,
      firstName: "Giulia",
      lastName: "Rossi",
      phoneNumber: "+390000000000",
      specialty: "Internal medicine",
      clinicName: "Ollo Dev Clinic",
      addressLine1: "Via Roma 1",
      city: "Milano",
      state: "MI",
      zipCode: "20121",
      country: "IT",
    },
  });
  await seedAvailability(clinician.id);
  await prisma.careTeamMember.upsert({
    where: { patientId_clinicianId: { patientId: patient.id, clinicianId: clinician.id } },
    update: { revokedAt: null },
    create: { patientId: patient.id, clinicianId: clinician.id, source: "SEED" },
  });
  return { clinicianId: clinician.id, patientId: patient.id };
}

/** Remove the clinician's chats/bookings/care-team grant with this patient (the Clinician row stays unless `dropClinician`). */
export async function unlinkClinician(patientId: string, dropClinician = false) {
  const clinician = await prisma.clinician.findUnique({ where: { email: DEV_CLINICIAN_EMAIL }, select: { id: true } });
  if (!clinician) return;
  await prisma.message.deleteMany({ where: { chat: { clinicianId: clinician.id, patientId } } });
  await prisma.chat.deleteMany({ where: { clinicianId: clinician.id, patientId } });
  await prisma.booking.deleteMany({ where: { clinicianId: clinician.id, patientId } });
  await prisma.careTeamMember.deleteMany({ where: { clinicianId: clinician.id, patientId } });
  if (dropClinician) await prisma.clinician.delete({ where: { id: clinician.id } }).catch(() => null);
}

if (require.main === module) {
  const email = process.argv[2] ?? "antoricciardelli@gmail.com";
  seedClinicianFor(email)
    .then((r) => console.log("linked", r))
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
