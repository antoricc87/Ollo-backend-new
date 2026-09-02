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

/* ------------------------------ S4: schedule ------------------------------ */

import moment from "moment";
import { AvailabilityReplace } from "../seam.schema";
import { sendSingleNotification } from "../../../utils/push_notifications";

const DAY_FMT = "MM-DD-YYYY";
const BOOKING_DATE_RE = /^(\d{2}-\d{2}-\d{4})T(\d{2}:\d{2})/;

/** "MM-DD-YYYYTHH:mm:ss.SSS+00:00" → { date, time } (wall clock, as the app writes it). */
export const splitBookingDate = (appointmentDate: string) => {
  const m = BOOKING_DATE_RE.exec(appointmentDate);
  return m ? { date: m[1], time: m[2] } : null;
};

export class SeamScheduleService {
  /**
   * Replace the published weeks inside [from, to] with the given concrete
   * slots. Slots that hold a PENDING/CONFIRMED booking are kept booked even
   * if the new rules would drop them, so a published change never silently
   * orphans an appointment.
   */
  static async replaceAvailability(clinicianId: string, input: AvailabilityReplace) {
    const bookings = await prisma.booking.findMany({
      where: { clinicianId, status: { in: ["PENDING", "CONFIRMED"] } },
      select: { appointmentDate: true, durationMinutes: true },
    });
    const booked = new Map<string, { time: string; end: string }>();
    for (const b of bookings) {
      const s = splitBookingDate(b.appointmentDate);
      if (s) booked.set(`${s.date}|${s.time}`, { time: s.time, end: moment(s.time, "HH:mm").add(b.durationMinutes ?? 30, "minutes").format("HH:mm") });
    }
    const from = moment(input.from, DAY_FMT);
    const to = moment(input.to, DAY_FMT);
    /** A published week that OVERLAPS the horizon is replaced — including legacy weeks that start on another weekday. */
    const overlaps = (w: { weekStartDate: string; weekEndDate: string }) =>
      !moment(w.weekEndDate, DAY_FMT).isBefore(from, "day") && !moment(w.weekStartDate, DAY_FMT).isAfter(to, "day");

    let slotCount = 0;
    await prisma.$transaction(async (tx) => {
      // Weeks in the horizon that the new payload no longer contains go away (their booked slots are re-created below).
      const existing = await tx.weeklyAvailability.findMany({ where: { clinicianId }, select: { id: true, weekStartDate: true, weekEndDate: true } });
      const keep = new Set(input.weeks.map((w) => w.weekStartDate));
      const stale = existing.filter((w) => overlaps(w) && !keep.has(w.weekStartDate));
      if (stale.length) await tx.weeklyAvailability.deleteMany({ where: { id: { in: stale.map((w) => w.id) } } });

      for (const week of input.weeks) {
        let row = await tx.weeklyAvailability.findFirst({ where: { clinicianId, weekStartDate: week.weekStartDate } });
        row = row
          ? await tx.weeklyAvailability.update({ where: { id: row.id }, data: { weekEndDate: week.weekEndDate } })
          : await tx.weeklyAvailability.create({ data: { clinicianId, weekStartDate: week.weekStartDate, weekEndDate: week.weekEndDate } });
        await tx.dailyAvailability.deleteMany({ where: { weekId: row.id } });
        for (const day of week.days) {
          const wanted = new Map(day.slots.map((s) => [s.startTime, s]));
          // booked appointments on this day survive regardless of the new rules
          for (const [key, b] of booked) {
            if (key.startsWith(`${day.date}|`) && !wanted.has(b.time)) wanted.set(b.time, { startTime: b.time, endTime: b.end });
          }
          if (wanted.size === 0) continue;
          const d = await tx.dailyAvailability.create({ data: { weekId: row.id, date: day.date } });
          const slots = [...wanted.values()]
            .sort((a, b) => a.startTime.localeCompare(b.startTime))
            .map((s) => {
              const isBooked = booked.has(`${day.date}|${s.startTime}`);
              return { dailyAvailabilityId: d.id, startTime: s.startTime, endTime: s.endTime, isBooked, isAvailable: !isBooked };
            });
          await tx.timeSlot.createMany({ data: slots });
          slotCount += slots.length;
        }
      }
    });
    return { weeks: input.weeks.length, slots: slotCount, bookedPreserved: booked.size };
  }

  static bookingsOf(clinicianId: string, status?: string) {
    return prisma.booking.findMany({
      where: { clinicianId, ...(status ? { status: status as never } : {}) },
      orderBy: { appointmentDate: "asc" },
      select: { id: true, patientId: true, patientName: true, appointmentDate: true, durationMinutes: true, reason: true, status: true, confirmed: true, notes: true, createdAt: true, updatedAt: true },
    });
  }

  /** Confirm / decline. Flags the matching slot, notifies the patient (best effort). */
  static async setBookingStatus(clinicianId: string, bookingId: string, status: "CONFIRMED" | "CANCELED", note?: string | null) {
    const b = await prisma.booking.findFirst({ where: { id: bookingId, clinicianId }, include: { clinician: { select: { firstName: true, lastName: true } } } });
    if (!b) return null;
    const updated = await prisma.booking.update({
      where: { id: b.id },
      data: { status, confirmed: status === "CONFIRMED", ...(note !== undefined ? { notes: note } : {}) },
    });
    const s = splitBookingDate(b.appointmentDate);
    if (s) {
      const slot = await prisma.timeSlot.findFirst({
        where: { startTime: s.time, dailyAvailability: { date: s.date, weekAvailability: { clinicianId } } },
        select: { id: true },
      });
      if (slot) await prisma.timeSlot.update({ where: { id: slot.id }, data: status === "CONFIRMED" ? { isBooked: true, isAvailable: false } : { isBooked: false, isAvailable: true } }).catch(() => undefined);
    }
    try {
      const token = await prisma.userToken.findFirst({ where: { userId: b.patientId, isActive: true, isDeleted: false }, select: { token: true } });
      if (token?.token) {
        const when = s ? moment(`${s.date} ${s.time}`, `${DAY_FMT} HH:mm`).format("ddd D MMM, HH:mm") : "";
        await sendSingleNotification({
          token: token.token,
          title: status === "CONFIRMED" ? "Appointment confirmed" : "Appointment declined",
          body: `Dr. ${b.clinician.lastName}${when ? ` · ${when}` : ""}${status === "CANCELED" && note ? ` — ${note}` : ""}`,
          data: { type: "booking", bookingId: b.id, status },
        });
      }
    } catch (e) {
      console.warn("seam: booking push failed", (e as Error)?.message);
    }
    return updated;
  }
}

/* ------------------------------ S5: messaging ----------------------------- */

const patientBrief = { select: { id: true, firstName: true, lastName: true } } as const;

export class SeamMessagingService {
  /** Threads of this clinician whose patient still grants access, newest activity first. */
  static async chatsOf(clinicianId: string) {
    const chats = await prisma.chat.findMany({
      where: { clinicianId, patient: { careTeam: { some: { clinicianId, revokedAt: null } } } },
      include: { patient: patientBrief, messages: { orderBy: { createdAt: "desc" }, take: 1 } },
      orderBy: { updatedAt: "desc" },
    });
    const unread = await prisma.message.groupBy({
      by: ["chatId"],
      where: { chatId: { in: chats.map((c) => c.id) }, senderType: "PATIENT", isRead: false },
      _count: { _all: true },
    });
    const unreadBy = new Map(unread.map((u) => [u.chatId, u._count._all]));
    return chats.map((c) => ({
      id: c.id,
      patient: c.patient,
      lastMessage: c.messages[0] ? { content: c.messages[0].content, senderType: c.messages[0].senderType, createdAt: c.messages[0].createdAt } : null,
      unread: unreadBy.get(c.id) ?? 0,
      updatedAt: c.updatedAt,
      createdAt: c.createdAt,
    }));
  }

  /** One thread (owner + active grant); reading marks the patient's messages as read. */
  static async chat(clinicianId: string, chatId: string) {
    const c = await prisma.chat.findFirst({
      where: { id: chatId, clinicianId, patient: { careTeam: { some: { clinicianId, revokedAt: null } } } },
      include: { patient: patientBrief, messages: { orderBy: { createdAt: "asc" } } },
    });
    if (!c) return null;
    await prisma.message.updateMany({ where: { chatId: c.id, senderType: "PATIENT", isRead: false }, data: { isRead: true } });
    return { id: c.id, patient: c.patient, createdAt: c.createdAt, updatedAt: c.updatedAt, messages: c.messages.map((m) => ({ ...m, isRead: m.senderType === "PATIENT" ? true : m.isRead })) };
  }

  static async start(clinicianId: string, patientId: string) {
    const c = await prisma.chat.upsert({
      where: { unique_clinician_patient_chat: { clinicianId, patientId } },
      update: {},
      create: { clinicianId, patientId },
      include: { patient: patientBrief },
    });
    return { id: c.id, patient: c.patient, createdAt: c.createdAt, updatedAt: c.updatedAt };
  }

  /** Clinician reply; pushes to the patient (best effort). */
  static async send(clinicianId: string, chatId: string, content: string) {
    const c = await prisma.chat.findFirst({
      where: { id: chatId, clinicianId, patient: { careTeam: { some: { clinicianId, revokedAt: null } } } },
      include: { clinician: { select: { lastName: true } } },
    });
    if (!c) return null;
    const m = await prisma.$transaction(async (tx) => {
      const msg = await tx.message.create({ data: { chatId: c.id, senderId: clinicianId, content, senderType: "CLINICIAN" } });
      await tx.chat.update({ where: { id: c.id }, data: { updatedAt: new Date() } });
      return msg;
    });
    try {
      const token = await prisma.userToken.findFirst({ where: { userId: c.patientId, isActive: true, isDeleted: false }, select: { token: true } });
      if (token?.token) {
        await sendSingleNotification({ token: token.token, title: `Dr. ${c.clinician.lastName} replied`, body: content.length > 120 ? `${content.slice(0, 117)}…` : content, data: { type: "chat", chatId: c.id } });
      }
    } catch (e) {
      console.warn("seam: chat push failed", (e as Error)?.message);
    }
    return m;
  }
}
