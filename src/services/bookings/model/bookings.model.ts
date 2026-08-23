import { Prisma } from "@prisma/client";
import {
  BookingData,
  DailyAvailabilities,
  WeeklyAvailabilities,
} from "../../../types";
import prisma from "../../../utility/prismaClient";
import { getCurrentWeekRangeSundSat } from "../../../utils/formatDate";
import moment from "moment";
import { getPatientById } from "../../patient/model/patient.model";
import sendEmail from "../../../utils/emailService";
import {
  bodyToDoctor,
  bodyToOllo,
  bodyToPatient,
  textBodyToDoctor,
  textBodyToOllo,
} from "../../../utility/emails/emails";

export class BookingService {
  async createBooking(bookingData: any) {
    const { slotId, ...filterdBookingData } = bookingData;
    try {
      const booking = await prisma.booking.create({
        data: filterdBookingData,
      });
      if (booking) {
        if (slotId) {
          await prisma.timeSlot.update({
            where: { id: slotId },
            data: { isAvailable: false, isBooked: true },
          });
        }
        const patient = await prisma.patient.findUnique({
          where: { id: bookingData.patientId },
          select: { doctorIds: true, email: true },
        });

        if (patient) {
          const updatedDoctorIds = Array.from(
            new Set([...patient.doctorIds, bookingData.doctorId])
          );

          await prisma.patient.update({
            where: { id: bookingData.patientId },
            data: {
              doctorIds: updatedDoctorIds,
            },
          });
        }
        const doctor = await prisma.user.findUnique({
          where: { id: bookingData.doctorId },
        });
        const olloBody = bodyToOllo(bookingData);
        const olloBodyText = textBodyToOllo(bookingData);
        const bodyPatient = bodyToPatient(bookingData);
        const bodyDoctor = bodyToDoctor(bookingData);
        const bodyDoctorText = textBodyToDoctor(bookingData);
        await sendEmail(
          "info@ollo-health.com",
          "New Booking",
          olloBody,
          olloBodyText
        );
        await sendEmail(patient?.email, "New Appointment Request", bodyPatient);
        await sendEmail(
          doctor.email,
          "New Appointment Request",
          bodyDoctor,
          bodyDoctorText
        );
        return booking;
      }
    } catch (error: unknown) {
      console.error("Error creating the booking", error);
      throw error;
    }
  }

  async deleteBooking(bookingId: string) {
    try {
      const deletedBooking = await prisma.booking.delete({
        where: { id: bookingId },
      });
      if (deletedBooking) return deletedBooking;
    } catch (error: unknown) {
      console.error("Error deleting the booking", error);
      throw error;
    }
  }

  async getBookings(whereClause: Prisma.BookingWhereInput) {
    try {
      const bookings = await prisma.booking.findMany({
        where: whereClause,
        orderBy: {
          appointmentDate: "asc",
        },
      });
      if (bookings) {
        const bookingsWithAddress = await Promise.all(
          bookings.map(async (booking) => {
            const doctor = await prisma.user.findUnique({
              where: { id: booking.doctorId },
            });
            return {
              ...booking,
              address: `${doctor.addressLine1}, ${doctor.addressLine2}, ${doctor.city}, ${doctor.zipCode}`,
            };
          })
        );
        return bookingsWithAddress;
      }
    } catch (error: unknown) {
      console.error("Error fetching bookings", error);
      throw error;
    }
  }
  async updateBooking(
    bookingId: string,
    bookingData: Prisma.BookingUpdateInput
  ) {
    try {
      const updatedBooking = await prisma.booking.update({
        where: { id: bookingId },
        data: bookingData,
      });
      if (updatedBooking) return updatedBooking;
    } catch (error: unknown) {
      console.error("Error updating the booking", error);
      throw error;
    }
  }

  async getBookingById(bookingId: string) {
    try {
      const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: {
          doctor: {
            select: {
              firstName: true,
              lastName: true,
              profileImageUrl: true,
              clinicName: true,
              addressLine1: true,
              city: true,
              zipCode: true,
            },
          },
        },
      });

      if (!booking) {
        throw new Error("Booking not found!");
      }
      return booking;
    } catch (error: unknown) {
      console.error("Error fetching the booking", error);
      throw error;
    }
  }

  async getLatestActiveBooking(patientId: string) {
    try {
      const patient = await getPatientById(patientId);
      const booking = await prisma.booking.findFirst({
        where: {
          patientId: patientId,
          appointmentDate: {
            gte: moment()
              .tz(patient.timeZone)
              .format("MM-DD-YYYYTHH:mm:ss.SSS[+00:00]"),
          },
          status: { notIn: ["CANCELED"] },
        },
        orderBy: {
          createdAt: "desc",
        },
      });
      if (booking) {
        const bookingDetails = await this.getBookingById(booking.id);
        if (bookingDetails) return bookingDetails;
      }
      return -1;
    } catch (error: unknown) {
      console.error("Error fetching latest booking", error);
      throw error;
    }
  }

  // -------------- Doctor Availabilities----------------- //
  async createWeeklyAvailability(doctorId: string, start: string, end: string) {
    try {
      const existingWeeklyAvailability =
        await prisma.weeklyAvailability.findFirst({
          where: { doctorId: doctorId, weekStartDate: start, weekEndDate: end },
        });
      if (existingWeeklyAvailability) {
        return existingWeeklyAvailability;
      }
      return await prisma.weeklyAvailability.create({
        data: { doctorId: doctorId, weekStartDate: start, weekEndDate: end },
      });
    } catch (error: unknown) {
      console.error("Error creating weekly availability", error);
      throw error;
    }
  }
  async createDailyAvailability(weeklyAvailabilityId: string, dayDate: string) {
    try {
      const existingDailyAvailability =
        await prisma.dailyAvailability.findFirst({
          where: { weekId: weeklyAvailabilityId, date: dayDate },
        });
      if (existingDailyAvailability) {
        return existingDailyAvailability;
      }
      return await prisma.dailyAvailability.create({
        data: { weekId: weeklyAvailabilityId, date: dayDate },
      });
    } catch (error: unknown) {
      console.error("Error creating weekly availability", error);
      throw error;
    }
  }
  async createTimeSlot(
    start: string,
    end: string,
    dailyAvailabilityId: string,
    isAvailable: boolean
  ) {
    try {
      const existingSlot = await prisma.timeSlot.findFirst({
        where: {
          dailyAvailabilityId: dailyAvailabilityId,
          startTime: start,
          endTime: end,
        },
      });
      if (existingSlot) {
        if (existingSlot.isAvailable === isAvailable) {
          return existingSlot;
        } else {
          return await prisma.timeSlot.update({
            where: { id: existingSlot.id },
            data: { isAvailable: isAvailable },
          });
        }
      }

      return await prisma.timeSlot.create({
        data: {
          startTime: start,
          endTime: end,
          dailyAvailabilityId: dailyAvailabilityId,
          isAvailable,
        },
      });
    } catch (error: unknown) {
      console.error("Error creating timeslot", error);
      throw error;
    }
  }
  async updatyeWeeklyAvailability(
    doctorId: string,
    availabilities: WeeklyAvailabilities[]
  ) {
    if (!doctorId || !availabilities?.length) {
      throw new Error("Invalid input data for weekly availability");
    }
    try {
      const results = [];
      for (const week of availabilities) {
        const weeklyAvailability = await this.createWeeklyAvailability(
          doctorId,
          week.weekStartDate,
          week.weekEndDate
        );
        const dailyResults = [];
        for (const day of week.dailyAvailabilities) {
          const dailyAvailability = await this.createDailyAvailability(
            weeklyAvailability.id,
            day.day
          );
          await Promise.all(
            day.timeSlots.map((slot) =>
              this.createTimeSlot(
                slot.start,
                slot.end,
                dailyAvailability.id,
                slot.isAvailable
              )
            )
          );
          dailyResults.push({
            day: day.day,
            timeSlotsCount: day.timeSlots.length,
          });
        }
        results.push({
          weeklyAvailabilityId: weeklyAvailability.id,
          weekStartDate: week.weekStartDate,
          weekEndDate: week.weekEndDate,
          dailyAvailabilities: dailyResults,
        });
        //   doctorId,
        //   weekStartDate,
        //   weekEndDate
        // );
        // for (const day of availabilities) {
        //   const dailyAvailability = await this.createDailyAvailability(
        //     weeklyAvailability.id,
        //     day.day
        //   );
        //   await Promise.all(
        //     day.timeSlots.map((slot) =>
        //       this.createTimeSlot(slot.start, slot.end, dailyAvailability.id)
        //     )
        //   );
      }
      return {
        results,
      };
    } catch (error: unknown) {
      console.error("Error creating availabilities", error);
      throw error;
    }
  }
  async getDoctorAvailability(doctorId: string) {
    try {
      const todayDate = moment().format("MM-DD-YYYY");
      const availabilities = await prisma.weeklyAvailability.findMany({
        where: { doctorId: doctorId, weekEndDate: { gte: todayDate } },
        orderBy: {
          weekEndDate: "asc",
        },
        include: {
          days: {
            include: {
              slots: true,
            },
          },
        },
      });
      if (availabilities) return availabilities;
    } catch (error: unknown) {
      console.error("Error fetching doctor availabilities", error);
      throw error;
    }
  }
}

export default new BookingService();
