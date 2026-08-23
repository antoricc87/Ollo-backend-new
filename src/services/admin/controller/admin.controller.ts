import { Request, Response } from "express";
import Util from "../../../utils/response";
import AdminService from "../model/admin.model";
class AdminHandler {
  async createAdmin(request: Request, response: Response) {
    const { adminData } = request.body;
    if (!adminData.password || !adminData.email)
      return response
        .status(400)
        .json(Util.error({}, "Admin data is required [email,password]"));
    try {
      const admin = await AdminService.createAdmin(adminData);
      if (admin)
        return response.status(201).json(Util.success(admin, "Admin created"));
    } catch (error: unknown) {
      return response
        .status(500)
        .json(Util.error({ error }, "Error creating admin"));
    }
  }

  async adminLogin(request: Request, response: Response) {
    const { email, password } = request.body;
    if (!email || !password)
      return response
        .status(400)
        .json(Util.error({}, "Email or PAssword are missing"));
    try {
      const adminLogInfo = await AdminService.adminLogin(email, password);
      if (adminLogInfo) {
        const { token, ...adminWithoutToken } = adminLogInfo;
        response.cookie("token", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "strict",
          maxAge: 45 * 60 * 1000,
          path: "/",
        });
        return response
          .status(200)
          .json(Util.success(adminWithoutToken, "Logged in"));
      }
    } catch (error: unknown) {
      return response
        .status(500)
        .json(Util.error({ error }, "Error logging the admin in"));
    }
  }

  async fetchAllBookings(request: any, response: Response) {
    try {
      const bookings = await AdminService.getAllBookings();
      if (bookings)
        return response
          .status(200)
          .json(Util.success(bookings, "Bookings fetched successfully"));
    } catch (error: unknown) {
      return response
        .status(500)
        .json(Util.error({ error }, "Error fetching the bbokings"));
    }
  }

  async updateBooking(request: Request, response: Response) {
    const { bookingData } = request.body;
    if (!bookingData)
      return response
        .status(400)
        .json(Util.error({}, "Booking Data is required"));
    try {
      const updatedBooking = await AdminService.updateBooking(bookingData);
      if (updatedBooking)
        return response
          .status(200)
          .json(Util.success(updatedBooking, "Booking succesfully updated"));
    } catch (error: unknown) {
      return response
        .status(500)
        .json(Util.error({ error }, "Error updating the booking"));
    }
  }

  async cerateAuthorizedPhysician(request: any, response: Response) {
    const { email, physicianFullName } = request.body;
    const { id } = request.user;
    if (!email || !physicianFullName)
      return response
        .status(400)
        .json(Util.error({}, "Email or Physician name are required"));
    try {
      const createdEmail = await AdminService.addAuthorizedPhysician(
        email,
        id,
        physicianFullName
      );
      if (createdEmail)
        return response
          .status(201)
          .json(Util.success(createdEmail, "Email created successfully"));
    } catch (error: unknown) {
      if (error instanceof Error) {
        return response.status(400).json(Util.error({}, error.message));
      }
      return response
        .status(500)
        .json(Util.error({}, "Error adding the email"));
    }
  }

  async getAllAuthorizedPhysicians(request: Request, response: Response) {
    try {
      const authorizedPhysicians =
        await AdminService.fetchAllAuthorizedPhysicians();
      if (authorizedPhysicians) {
        return response
          .status(200)
          .json(
            Util.success(
              authorizedPhysicians,
              "Authorized physicians fetched successfully"
            )
          );
      }
    } catch (error: unknown) {
      if (error instanceof Error) {
        return response.status(400).json(Util.error({ error }, error.message));
      } else {
        return response
          .status(500)
          .json(Util.error({ error }, "Error fetching authorized users"));
      }
    }
  }
}

export default new AdminHandler();
