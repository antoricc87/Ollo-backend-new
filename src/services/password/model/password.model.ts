import moment from "moment";
import prisma from "../../../utility/prismaClient";
import bcrypt from "bcryptjs";
import { updatePatientPassword } from "../../patient/model/patient.model";
class PasswordService {
  async createLink(email: string) {
    try {
      const user = await prisma.patient.findUnique({
        where: { email: email.trim().toLowerCase() },
      });

      const otp = Math.floor(100000 + Math.random() * 900000);
      const expiresAt = moment().add(10, "minutes");

      const resetPasswordData = {
        patientId: user.id,
        email: user.email,
        otp: otp.toString(),
        expiresAt: expiresAt.toDate(),
        used: false,
      };

      const otpData = await prisma.resetPassword.create({
        data: resetPasswordData,
      });

      return otpData;
    } catch (error) {
      throw error;
    }
  }

  async showResetPasswordForm(email: string, otp: any) {
    try {
      const otpData = await prisma.resetPassword.findFirst({
        where: { email, otp, used: false },
      });
      let isExpired = "";

      if (!otpData || moment().isAfter(otpData.expiresAt)) {
        isExpired = "Link is invalid or expired";
        return {
          email: "",
          otp: "",
          isExpired: isExpired,
        };
      }

      return {
        email: otpData.email,
        otp: otpData.otp,
        isExpired: isExpired,
      };
    } catch (error) {
      throw error;
    }
  }

  async updatePassword(email: string, otp: any, password: string) {
    try {
      const otpData = await prisma.resetPassword.findFirst({
        where: { email, otp, used: false },
      });

      if (!otpData || moment().isAfter(otpData.expiresAt)) {
        throw new Error("Link is invalid or expired");
      }

      const user = await prisma.patient.findUnique({ where: { email: email } });

      const saltRounds = 10;
      const salt = await bcrypt.genSalt(saltRounds);
      const hashedPassword = await bcrypt.hash(password, salt);

      await updatePatientPassword(user.id, {
        password: hashedPassword,
      });

      await prisma.resetPassword.update({
        where: { id: otpData.id },
        data: {
          used: true,
        },
      });

      return true;
    } catch (error) {
      throw error;
    }
  }

}

export default new PasswordService();
