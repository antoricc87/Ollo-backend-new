/**
 * Deterministic (no LLM) check of the care-team seam after the 2026-08-29
 * physician-surface removal: directory → care team grant → Ollie tools
 * (get_care_team, message_care_team, book_appointment) run + commit →
 * Chat/Message/Booking/CareTeamMember rows → revoke → tools see nothing.
 *   npx ts-node --transpile-only scripts/care-team-smoke.ts [patient-email]
 */
import "dotenv/config";
import assert from "assert";
import moment from "moment-timezone";
import prisma from "../src/utility/prismaClient";
import ClinicianService from "../src/services/clinicians/model/clinicians.model";
import { getCareTeam } from "../src/services/agent/tools/care.tools";
import { messageCareTeam, bookAppointment } from "../src/services/agent/tools/write.tools";
import { seedClinicianFor, unlinkClinician } from "./seed-dev-clinician";

const log = (s: string) => console.log(s);

async function main() {
  const email = process.argv[2] ?? "antoricciardelli@gmail.com";
  const patient = await prisma.patient.findUnique({ where: { email }, select: { id: true, timeZone: true } });
  if (!patient) throw new Error("patient not found");
  const pid = patient.id;
  const ctx: any = { patientId: pid, subjectId: pid, timeZone: patient.timeZone ?? "Europe/Rome", resolveSubject: async () => pid, client: null };
  await unlinkClinician(pid);

  /* 1. empty care team → tools say so, no proposal */
  let ct: any = await getCareTeam.run(ctx, {});
  assert.equal(ct.result.clinicians.length, 0, "care team empty");
  let m: any = await messageCareTeam.run(ctx, { subject: "Cholesterol", body: "Are my cholesterol results ok? LDL 128." });
  assert(m.result.error && !m.proposal, "message tool explains, no proposal");
  log("  ✓ empty care team handled");

  /* 2. directory + grant */
  const { clinicianId } = await seedClinicianFor(email);
  const dir: any[] = await ClinicianService.directory();
  const entry = dir.find((c) => c.id === clinicianId);
  assert(entry && entry.availabilities.length >= 1 && entry.availabilities[0].days.length === 7, "directory lists the clinician with a week of slots");
  assert(await ClinicianService.isOnCareTeam(pid, clinicianId), "grant active");
  ct = await getCareTeam.run(ctx, {});
  assert.equal(ct.result.clinicians[0].id, clinicianId, "get_care_team sees the grant");
  assert.equal(ct.cards[0].data.clinicians[0].name, "Giulia Rossi");
  log("  ✓ directory + CareTeamMember grant + get_care_team");

  /* 3. message → proposal → commit → Chat + Message */
  m = await messageCareTeam.run(ctx, { subject: "Cholesterol", body: "Are my cholesterol results ok? LDL 128." });
  assert.equal(m.proposal?.preview?.clinicianId, clinicianId, "message proposal targets the clinician");
  const mc: any = await messageCareTeam.commit!(ctx, { subject: "Cholesterol", body: "Are my cholesterol results ok? LDL 128." }, m.proposal.preview);
  const msg = await prisma.message.findUnique({ where: { id: mc.result.messageId }, include: { chat: true } });
  assert(msg && msg.senderType === "PATIENT" && msg.senderId === pid && msg.chat.clinicianId === clinicianId, "Message + Chat rows");
  log(`  ✓ message_care_team → Chat ${msg!.chatId} / Message ${msg!.id}`);

  /* 4. booking → proposal → commit → Booking (clinicianId) + grant stays */
  const at = moment.tz(ctx.timeZone).add(3, "days").hour(10).minute(30).second(0).format("YYYY-MM-DDTHH:mm");
  const b: any = await bookAppointment.run(ctx, { at, reason: "Cholesterol follow-up" });
  assert.equal(b.proposal?.preview?.clinicianName, "Giulia Rossi", "booking proposal");
  const bc: any = await bookAppointment.commit!(ctx, { at, reason: "Cholesterol follow-up" }, b.proposal.preview);
  const booking = await prisma.booking.findUnique({ where: { id: bc.result.bookingId }, include: { clinician: true } });
  assert(booking && booking.status === "PENDING" && booking.clinicianId === clinicianId && booking.clinician.lastName === "Rossi", "Booking row with clinician FK");
  ct = await getCareTeam.run(ctx, {});
  assert.equal(ct.result.appointments[0].clinicianName, "Giulia Rossi", "appointment listed");
  log(`  ✓ book_appointment → Booking ${booking!.id} PENDING at ${booking!.appointmentDate}`);

  /* 5. revoke → tools see nothing, rows remain */
  await ClinicianService.removeFromCareTeam(pid, clinicianId);
  assert(!(await ClinicianService.isOnCareTeam(pid, clinicianId)), "grant revoked");
  ct = await getCareTeam.run(ctx, {});
  assert.equal(ct.result.clinicians.length, 0, "revoked clinician not on the team");
  m = await messageCareTeam.run(ctx, { clinicianId, subject: "Hi there", body: "Should not go through after revoke." });
  assert(m.result.error && !m.proposal, "revoked clinician cannot be messaged");
  const grant = await prisma.careTeamMember.findUnique({ where: { patientId_clinicianId: { patientId: pid, clinicianId } } });
  assert(grant && grant.revokedAt, "grant row kept with revokedAt");
  log("  ✓ revoke: tools blind, grant row kept as audit");

  await unlinkClinician(pid);
  log("all care-team checks passed");
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
