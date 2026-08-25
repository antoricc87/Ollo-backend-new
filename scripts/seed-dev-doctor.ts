/**
 * Idempotent: creates a DOCTOR user and links it to a patient's care team so
 * message_care_team / book_appointment can be exercised end-to-end.
 *   npx ts-node --transpile-only scripts/seed-dev-doctor.ts [patient-email]
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import prisma from "../src/utility/prismaClient";

export const DEV_DOCTOR_EMAIL = "dev-doctor@ollo.test";

export async function seedDoctorFor(patientEmail: string) {
  const patient = await prisma.patient.findUnique({ where: { email: patientEmail }, select: { id: true, doctorIds: true } });
  if (!patient) throw new Error(`patient ${patientEmail} not found`);
  const doctor = await prisma.user.upsert({
    where: { email: DEV_DOCTOR_EMAIL },
    update: {},
    create: {
      email: DEV_DOCTOR_EMAIL,
      password: await bcrypt.hash("dev-doctor-password", 8),
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
      role: "DOCTOR",
      isEmailVerified: true,
    },
  });
  if (!patient.doctorIds.includes(doctor.id))
    await prisma.patient.update({ where: { id: patient.id }, data: { doctorIds: { push: doctor.id } } });
  return { doctorId: doctor.id, patientId: patient.id };
}

/** Remove the doctor's chats/bookings with this patient (the user row stays unless `dropUser`). */
export async function unlinkDoctor(patientId: string, dropUser = false) {
  const doctor = await prisma.user.findUnique({ where: { email: DEV_DOCTOR_EMAIL }, select: { id: true } });
  if (!doctor) return;
  await prisma.message.deleteMany({ where: { chat: { userId: doctor.id, patientId } } });
  await prisma.chat.deleteMany({ where: { userId: doctor.id, patientId } });
  await prisma.booking.deleteMany({ where: { doctorId: doctor.id, patientId } });
  const p = await prisma.patient.findUnique({ where: { id: patientId }, select: { doctorIds: true } });
  if (p) await prisma.patient.update({ where: { id: patientId }, data: { doctorIds: p.doctorIds.filter((d) => d !== doctor.id) } });
  if (dropUser) await prisma.user.delete({ where: { id: doctor.id } }).catch(() => null);
}

if (require.main === module) {
  const email = process.argv[2] ?? "antoricciardelli@gmail.com";
  seedDoctorFor(email)
    .then((r) => console.log("linked", r))
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
