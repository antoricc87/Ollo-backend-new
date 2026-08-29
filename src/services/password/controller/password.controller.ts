import sendEmail from "../../../utils/emailService";
import Util from "../../../utils/response";
import PasswordService from "../model/password.model";
class PasswordHandler {
  async createLink(request, response) {
    try {
      const { email } = request.body;

      const otpData = await PasswordService.createLink(email);

      const link = `http://ollo-health.com/resetpassword?email=${otpData.email}&otp=${otpData.otp}`;

      const subject = "Ollo - Reset Password Link";
      const body = `<h1>Reset your Ollo App Password</h1>
             <p>You’ve received this email because you (or someone pretending to be you) requested a password reset.</p>
             <p>Please ignore this message if you do not wish to reset your password.</p>
             <div>Click the link to <a target="_blank" href="${link}">Reset Password</a></div>
        `;
      const emailRS = await sendEmail(email, subject, body);

      return response
        .status(200)
        .json(Util.success({}, "Link successfully generated"));
    } catch (error) {
      console.error(error);
      return response
        .status(400)
        .json(
          Util.error({ error }, "Something went wrong generating the link")
        );
    }
  }

  async showResetPasswordForm(request, response) {
    try {
      const { email, otp } = request.query;

      const resetForm = await PasswordService.showResetPasswordForm(email, otp);

      return response.render("reset_password", resetForm);
    } catch (error) {
      console.error(error);
      return response.status(400).json(Util.error({ error }, "Error"));
    }
  }

  async updatePassword(request, response) {
    try {
      const { email, otp, password } = request.body;

      await PasswordService.updatePassword(email, otp, password);

      return response
        .status(200)
        .json(Util.success({}, "Password updated successfully"));
    } catch (error) {
      console.error(error);
      return response
        .status(400)
        .json(Util.error({ error }, "Error updating the password"));
    }
  }

}

export default new PasswordHandler();
