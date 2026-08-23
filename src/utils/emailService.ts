import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

const sendEmail = async (
  to: string,
  subject: string,
  html: string,
  text?: string
) => {
  const transporter = nodemailer.createTransport({
    host: process.env.AWS_SES_HOST,
    port: Number(process.env.AWS_SES_PORT),
    secure: process.env.AWS_SES_PORT === "465",
    auth: {
      user: process.env.AWS_SES_USER,
      pass: process.env.AWS_SES_PASS,
    },
  });

  const mailOptions = {
    from: '"Ollo Health" <info@ollo-health.com>',
    to,
    subject,
    html,
    text,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log("Email sent successfully");
  } catch (error) {
    console.error("Error sending email:", error);
  }
};

export default sendEmail;
