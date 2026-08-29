import { Prisma } from "@prisma/client";
import moment from "moment";
import prisma from "../../../utility/prismaClient";
import { getPatientById } from "../../patient/model/patient.model";
import ClinicianService from "../../clinicians/model/clinicians.model";
import sendEmail from "../../../utils/emailService";
import {
  bodyToClinician,
  bodyToOllo,
  bodyToPatient,
  textBodyToClinician,
  textBodyToOllo,
} from "../../../utility/emails/emails";

const clinicianSelect = {
  id: true,
  firstName: true,
  lastName: true,
  profileImageUrl: true,
  specialty: true,
  clinicName: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  zipCode: true,
  email: true,
} as const;

const addressOf = (c: { addressLine1?: string | null; addressLine2?: string | null; city?: string | null; zipCode?: string | null } | null) =>
  c ? [c.addressLine1, c.addressLine2, c.city, c.zipCode].filter(Boolean).join(", ") : "";

export class BookingService {
  /**
   * A booking is the patient's appointment REQUEST (PENDING until confirmed).
   * Booking a clinician also adds them to the patient's care team
   * (`CareTeamMember`, source BOOKING) — that grant is what the care-team
   * screen and Ollie's care tools read.
   */
  async createBooking(bookingData: any) {
    const { slotId, ...data } = bookingData;
    const clinician = await ClinicianService.getById(data.clinicianId);
    if (!clinician || !clinician.isActive) throw new Error("clinician not found");
    if (!data.clinicianName) data.clinicianName = `${clinician.firstName} ${clinician.lastName}`;
    const booking = await prisma.booking.create({ data });
    if (slotId) {
      await prisma.timeSlot
        .update({ where: { id: slotId }, data: { isAvailable: false, isBooked: true } })
        .catch((e) => console.warn("slot update failed", e?.message));
    }
    await ClinicianService.addToCareTeam(data.patientId, clinician.id, "BOOKING");

    // Notifications are best-effort: a mail failure must not hide a saved booking.
    try {
      const patient = await prisma.patient.findUnique({ where: { id: data.patientId }, select: { email: true } });
      await sendEmail("info@ollo-health.com", "New Booking", bodyToOllo(data), textBodyToOllo(data));
      if (patient?.email) await sendEmail(patient.email, "New Appointment Request", bodyToPatient(data));
      if (clinician.email) await sendEmail(clinician.email, "New Appointment Request", bodyToClinician(data), textBodyToClinician(data));
    } catch (e: any) {
      console.warn("booking emails failed", e?.message);
    }
    return booking;
  }

  async deleteBooking(bookingId: string) {
    return prisma.booking.delete({ where: { id: bookingId } });
  }

  async getBookings(whereClause: Prisma.BookingWhereInput) {
    const bookings = await prisma.booking.findMany({
      where: whereClause,
      orderBy: { appointmentDate: "asc" },
      include: { clinician: { select: clinicianSelect } },
    });
    return bookings.map(({ clinician, ...b }) => ({ ...b, clinician, address: addressOf(clinician) }));
  }

  async updateBooking(bookingId: string, bookingData: Prisma.BookingUpdateInput) {
    return prisma.booking.update({ where: { id: bookingId }, data: bookingData });
  }

  async getBookingById(bookingId: string) {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { clinician: { select: clinicianSelect } },
    });
    if (!booking) throw new Error("Booking not found!");
    return booking;
  }

  async getLatestActiveBooking(patientId: string) {
    const patient = await getPatientById(patientId);
    const booking = await prisma.booking.findFirst({
      where: {
        patientId,
        appointmentDate: {
          gte: moment().tz(patient.timeZone).format("MM-DD-YYYYTHH:mm:ss.SSS[+00:00]"),
        },
        status: { notIn: ["CANCELED"] },
      },
      orderBy: { createdAt: "desc" },
    });
    if (!booking) return -1;
    return this.getBookingById(booking.id);
  }
}

export default new BookingService();
