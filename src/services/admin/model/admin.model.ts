import prisma from "../../../utility/prismaClient";
import bcrypt from "bcryptjs";
import { signAdminJWT, updateUserToken } from "../../../utils/auth_token";
import { Prisma } from "@prisma/client";
import { sendSingleNotification } from "../../../utils/push_notifications";
import sendEmail from "../../../utils/emailService";
import { bodyBookingConfirmationToPatient } from "../../../utility/emails/emails";
class AdminService {
  async getAdminById(adminId: string) {
    try {
      const admin = await prisma.admin.findUnique({ where: { id: adminId } });
      if (!admin) throw new Error("Admin not found");
      return admin;
    } catch (error: unknown) {
      console.error("Error getting admin");
      throw error;
    }
  }
  async createAdmin(adminData: any) {
    try {
      const updatedAdminData = adminData.password
        ? {
            ...adminData,
            password: await bcrypt.hash(adminData.password, 10),
          }
        : { ...adminData };
      const admin = await prisma.admin.create({
        data: updatedAdminData,
      });
      if (admin) return admin;
    } catch (error: unknown) {
      console.error("Error creating admin", error);
      throw error;
    }
  }

  async adminLogin(email: string, password: string) {
    try {
      const admin = await prisma.admin.findUnique({ where: { email: email } });
      if (!admin) {
        console.log("Account not found");
        throw new Error("There is no account with this email");
      }
      const matchingPassword = await bcrypt.compare(
        password,
        admin.password || ""
      );
      if (!matchingPassword) {
        console.log("Wrong password");
        throw new Error("Incorrect password");
      }
      const payload = { user: { id: admin.id } };
      const token = await signAdminJWT(payload);
      await updateUserToken(admin.id, token);
      const adminDetails = await this.getAdminById(admin.id);
      const { password: _, ...adminDataNoPassword } = adminDetails;
      const adminData = { ...adminDataNoPassword, token: token };
      return adminData;
    } catch (error: any) {
      console.log("Something went wrong logging the user in");
      throw new Error(error.message);
    }
  }

  async getAllBookings() {
    try {
      const bookings = await prisma.booking.findMany({
        orderBy: {
          appointmentDate: "asc",
        },
      });
      if (bookings) return bookings;
    } catch (error: unknown) {
      console.error("Error fetching bookings", error);
      throw error;
    }
  }

  async updateBooking(bookingData: any) {
    const { id: _, ...bookingDataNoId } = bookingData;
    try {
      const updatedBooking = await prisma.booking.update({
        where: { id: bookingData.id },
        data: bookingDataNoId,
      });
      if (updatedBooking) {
        const patient = await prisma.patient.findUnique({
          where: { id: updatedBooking.patientId },
        });
        const doctor = await prisma.user.findUnique({
          where: { id: bookingData.doctorId },
        });
        const patientToken = await prisma.userFCMToken.findUnique({
          where: { userId: patient.id },
        });
        if (patientToken) {
          let bookingStatus = {
            status: "updated",
            message:
              "We’ve made changes to your appointment—tap to see the new date, time or status.",
          };

          if (updatedBooking.status === "CANCELED") {
            bookingStatus = {
              status: "canceled",
              message: "We’re sorry but your appointment was canceled.",
            };
          } else if (updatedBooking.status === "CONFIRMED") {
            bookingStatus = {
              status: "confirmed",
              message: "Your appointment has been confirmed",
            };
          }

          const notificationData = {
            title: `Your booking has been ${bookingStatus.status}`,
            body: `Hi ${patient.firstName}, ${bookingStatus.message}`,
            token: patientToken.FCMToken,
          };
          sendSingleNotification(notificationData);
          if (updatedBooking.status === "CONFIRMED") {
            const address = doctor.addressLine2
              ? `${doctor.addressLine1}, ${doctor.addressLine2}, ${doctor.city}, ${doctor.zipCode}`
              : `${doctor.addressLine1}, ${doctor.city}, ${doctor.zipCode}`;
            const fullBookingData = {
              ...bookingData,
              clinicName: doctor.clinicName,
              address: address,
            };
            const htmlBody = bodyBookingConfirmationToPatient(fullBookingData);
            sendEmail(patient.email, "Appointment Confirmation", htmlBody);
          }
        }

        return updatedBooking;
      }
    } catch (error: unknown) {
      console.error("Error updating the booking", error);
      throw error;
    }
  }

  async addAuthorizedPhysician(
    email: string,
    adminId: string,
    physicianFullName: string
  ) {
    try {
      const existingEmail = await prisma.authorizedPhysicians.findUnique({
        where: {
          email: email,
        },
      });
      if (existingEmail) {
        throw new Error("Email already in use");
      }
      const addedEmail = await prisma.authorizedPhysicians.create({
        data: {
          email: email,
          createdBy: adminId,
          fullName: physicianFullName,
        },
      });
      if (addedEmail) return addedEmail;
    } catch (error: unknown) {
      console.error("Error adding the email", error);
      throw error;
    }
  }
  async fetchAllAuthorizedPhysicians() {
    try {
      const authorizedPhysicians = await prisma.authorizedPhysicians.findMany();
      if (!authorizedPhysicians)
        throw new Error("Error fetching authorized physicians");

      return authorizedPhysicians;
    } catch (error: unknown) {
      console.error("Error fetching authorized physicians", error);
      throw error;
    }
  }
}

export default new AdminService();
