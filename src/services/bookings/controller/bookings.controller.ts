import { ObjectId } from "../../../utils/idValidation";
import { Request, Response } from "express";
import Util from "../../../utils/response";
import BookingService from "../model/bookings.model";
export class BookingHandler {
  async createBooking(request: Request, response: Response) {
    const { bookingData } = request.body;

    if (
      !bookingData.patientId ||
      !bookingData.doctorId ||
      !bookingData.appointmentDate
    ) {
      return response
        .status(400)
        .json(
          Util.error(
            {},
            "Some required data such as patientId,doctorId or appointmentDate are missing"
          )
        );
    }

    if (
      !ObjectId.isValid(bookingData.patientId) ||
      !ObjectId.isValid(bookingData.doctorId)
    ) {
      return response
        .status(400)
        .json(
          Util.error({}, "Patient and Doctor ID must be a valid object id")
        );
    }

    try {
      const booking = await BookingService.createBooking(bookingData);
      if (booking)
        return response
          .status(200)
          .json(Util.success(booking, "Booking successfully created"));
    } catch (error: unknown) {
      return response
        .status(500)
        .json(Util.error({ error }, "Error creating the booking"));
    }
  }

  async deleteBooking(request: Request, response: Response) {
    const { bookingId } = request.body;
    if (!bookingId)
      return response.status(500).json(Util.error({}, "BookingId is required"));
    try {
      const deletedBooking = await BookingService.deleteBooking(bookingId);
      if (deletedBooking)
        return response
          .status(200)
          .json(Util.success(deletedBooking, "Booking deleted successfully"));
    } catch (error: unknown) {
      return response
        .status(500)
        .json(Util.error({ error }, "Error deleting the booking"));
    }
  }

  async getBookings(request: Request, response: Response) {
    try {
      const bookings = await BookingService.getBookings(request.body);
      if (bookings)
        return response
          .status(200)
          .json(Util.success(bookings, "Bookings fetcheed successfully"));
    } catch (error: unknown) {
      return response
        .status(500)
        .json(Util.error({ error }, "Error fetching the "));
    }
  }

  async updateBooking(request: Request, response: Response) {
    const { bookingId, bookingData } = request.body;
    if (!bookingId)
      return response
        .status(500)
        .json(Util.error({}, "bookingId is required to edit booking"));
    try {
      const updatedBooking = await BookingService.updateBooking(
        bookingId,
        bookingData
      );
      if (updatedBooking)
        return response
          .status(200)
          .json(Util.success(updatedBooking, "Booking updated successfully"));
    } catch (error: unknown) {
      return response
        .status(500)
        .json(Util.error({ error }, "Error updating the booking"));
    }
  }

  async getBookingById(request: Request, response: Response) {
    const { bookingId } = request.body;
    if (!bookingId) {
      return response
        .status(400)
        .json(Util.error({}, "Booking id is required"));
    }
    try {
      const booking = await BookingService.getBookingById(bookingId);
      if (booking)
        return response
          .status(200)
          .json(Util.success(booking, "Booking fetched successfully"));
    } catch (error: any) {
      return response.status(500).json(Util.error({ error }, error.message));
    }
  }

  async getLatestActiveBooking(request: any, response: Response) {
    const { id } = request.user;
    try {
      const booking = await BookingService.getLatestActiveBooking(id);
      if (booking === -1) {
        return response.status(404).json(Util.error({}, "No upcoming booking"));
      } else {
        return response
          .status(200)
          .json(Util.success(booking, "Booking fetched successfull"));
      }
    } catch (error: any) {
      return response.status(500).json(Util.error(error, error.message));
    }
  }

  // ---------------------availabilities section-------------------//
  async updatyeWeeklyAvailability(request: any, response: Response) {
    const { id } = request.user;
    const { availabilities, weekStartDate, weekEndDate } = request.body;
    if (!availabilities) {
      return response
        .status(400)
        .json(Util.error({}, "Availabilities are missing"));
    }
    try {
      const createdAvailabilities =
        await BookingService.updatyeWeeklyAvailability(id, availabilities);
      if (createdAvailabilities) {
        return response
          .status(201)
          .json(
            Util.success(
              createdAvailabilities,
              "Availabilities created successfully"
            )
          );
      }
    } catch (error: unknown) {
      console.error(error);
      return response
        .status(500)
        .json(Util.error({ error }, "Error updating availabilities"));
    }
  }

  async fetchDoctorAvailabilities(request: any, response: Response) {
    const { id } = request.user;
    try {
      const availabilities = await BookingService.getDoctorAvailability(id);
      if (availabilities)
        return response
          .status(200)
          .json(
            Util.success(availabilities, "Availabilities fetched successfully")
          );
    } catch (error: unknown) {
      return response
        .status(500)
        .json(Util.error({ error }, "Error fetching availabilities"));
    }
  }
}

export default new BookingHandler();
