import { Request, Response } from "express";
import Util from "../../../utils/response";
import BookingService from "../model/bookings.model";

export class BookingHandler {
  async createBooking(request: any, response: Response) {
    const { bookingData } = request.body ?? {};
    if (!bookingData?.patientId || !bookingData?.clinicianId || !bookingData?.appointmentDate) {
      return response
        .status(400)
        .json(Util.error({}, "patientId, clinicianId and appointmentDate are required"));
    }
    try {
      const booking = await BookingService.createBooking(bookingData);
      if (booking) return response.status(200).json(Util.success(booking, "Booking successfully created"));
    } catch (error: any) {
      const notFound = /clinician not found/i.test(error?.message ?? "");
      return response
        .status(notFound ? 404 : 500)
        .json(Util.error({ error }, notFound ? "Clinician not found" : "Error creating the booking"));
    }
  }

  async deleteBooking(request: Request, response: Response) {
    const { bookingId } = request.body;
    if (!bookingId) return response.status(400).json(Util.error({}, "BookingId is required"));
    try {
      const deletedBooking = await BookingService.deleteBooking(bookingId);
      if (deletedBooking) return response.status(200).json(Util.success(deletedBooking, "Booking deleted successfully"));
    } catch (error: unknown) {
      return response.status(500).json(Util.error({ error }, "Error deleting the booking"));
    }
  }

  async getBookings(request: any, response: Response) {
    // Only known filters reach Prisma: verifyToken injects `userId` into the
    // body, which is not a Booking column (that 500'd the app's bookings list).
    const { patientId, status, clinicianId } = request.body ?? {};
    const where: any = { patientId: patientId || request.user.id };
    if (status) where.status = status;
    if (clinicianId) where.clinicianId = clinicianId;
    try {
      const bookings = await BookingService.getBookings(where);
      if (bookings) return response.status(200).json(Util.success(bookings, "Bookings fetched successfully"));
    } catch (error: unknown) {
      return response.status(500).json(Util.error({ error }, "Error fetching the bookings"));
    }
  }

  async updateBooking(request: Request, response: Response) {
    const { bookingId, bookingData } = request.body;
    if (!bookingId) return response.status(400).json(Util.error({}, "bookingId is required to edit booking"));
    try {
      const updatedBooking = await BookingService.updateBooking(bookingId, bookingData);
      if (updatedBooking) return response.status(200).json(Util.success(updatedBooking, "Booking updated successfully"));
    } catch (error: unknown) {
      return response.status(500).json(Util.error({ error }, "Error updating the booking"));
    }
  }

  async getBookingById(request: Request, response: Response) {
    const { bookingId } = request.body;
    if (!bookingId) return response.status(400).json(Util.error({}, "Booking id is required"));
    try {
      const booking = await BookingService.getBookingById(bookingId);
      if (booking) return response.status(200).json(Util.success(booking, "Booking fetched successfully"));
    } catch (error: any) {
      return response.status(500).json(Util.error({ error }, error.message));
    }
  }

  async getLatestActiveBooking(request: any, response: Response) {
    const { id } = request.user;
    try {
      const booking = await BookingService.getLatestActiveBooking(id);
      if (booking === -1) return response.status(404).json(Util.error({}, "No upcoming booking"));
      return response.status(200).json(Util.success(booking, "Booking fetched successfully"));
    } catch (error: any) {
      return response.status(500).json(Util.error(error, error.message));
    }
  }
}

export default new BookingHandler();
