import moment from "moment";

export const bodyToOllo = (bookingData: any) => {
  return `<html>
  <body>
    <h2>You have a new appointment request that needs your review. Please see the details below and confirm with the doctor.</h2>
    <h3>Patient Data</h3>
    <p>Full Name: ${bookingData.patientName}</p>
    <p>ID: ${bookingData.patientId}</p>
    <h3>Doctor Data</h3>
    <p>Full Name: ${bookingData.doctorName}</p>
    <p>ID: ${bookingData.doctorId}</p>
  </body>
</html>`;
};
export const textBodyToOllo = (bookingData: any) => {
  return `You have a new appointment request that needs your review.
  
  Patient Data:
  - Full Name: ${bookingData.patientName}
  - ID: ${bookingData.patientId}
  
  Doctor Data:
  - Full Name: ${bookingData.doctorName}
  - ID: ${bookingData.doctorId}
  
  Please confirm with the doctor as soon as possible.`;
};

export const bodyToPatient = (bookingData: any) => {
  return `<html>
  <body>
    <h2>Thank you for your appointment request!</h2>
    <p>Dear ${bookingData.patientName},</p>
    <p>We have received your appointment request and are currently processing it. Our team is working to confirm your appointment with Dr. ${
      bookingData.doctorName
    }.</p>
    <p>You will receive a confirmation email as soon as your appointment is confirmed. Please allow 24-48 hours for processing.</p>
    <h3>Appointment Details</h3>
    <p>Doctor: Dr. ${bookingData.doctorName}</p>
    <p>Request Date: ${
      moment(
        bookingData.appointmentDate,
        "MM-DD-YYYYTHH:mm:ss.SSS[+00:00]"
      ).format("DD MMM YYYY, HH:mm") || "To be confirmed"
    }</p>
    <p>If you have any urgent questions, please don't hesitate to contact our support team.</p>
    <p>Thank you for choosing our healthcare services!</p>
    <p>Best regards,<br>Ollo Health Team</p>
  </body>
</html>`;
};

export const textBodyToPatient = (bookingData: any) => {
  const formattedDate = bookingData.appointmentDate
    ? moment(
        bookingData.appointmentDate,
        "MM-DD-YYYYTHH:mm:ss.SSS[+00:00]"
      ).format("DD MMM YYYY, HH:mm")
    : "To be confirmed";

  return `Thank you for your appointment request!

Dear ${bookingData.patientName},

We have received your appointment request and are currently processing it.
Our team is working to confirm your appointment with Dr. ${bookingData.doctorName}.

You will receive a confirmation email as soon as your appointment is confirmed.
Please allow 24–48 hours for processing.

Appointment Details:
- Doctor: Dr. ${bookingData.doctorName}
- Request Date: ${formattedDate}

If you have any urgent questions, please don't hesitate to contact our support team.

Thank you for choosing our healthcare services!

Best regards,
Ollo Health Team`;
};

export const bodyToDoctor = (bookingData: any) => {
  return `<html>
  <body>
    <h2>New Appointment Request From Ollo</h2>
    <p>Dear Dr. ${bookingData.doctorName},</p>
    <p>You have received a new appointment request from a patient. Please review the details below and confirm or reschedule as needed.</p>
    <h3>Patient Information</h3>
    <p>Patient Name: ${bookingData.patientName}</p>
    <h3>Appointment Details</h3>
    <p>Requested Date: ${
      moment(
        bookingData.appointmentDate,
        "MM-DD-YYYYTHH:mm:ss.SSS[+00:00]"
      ).format("DD MMM YYYY, HH:mm") || "To be confirmed"
    }</p>
    <p>Please confirm with us if you can accommodate this appointment request.</p>
    <p>If you have any questions or need assistance, please contact our support team.</p>
    <p>Best regards,<br>Ollo Health Team</p>
  </body>
</html>`;
};
export const textBodyToDoctor = (bookingData: any) => {
  const formattedDate = bookingData.appointmentDate
    ? moment(
        bookingData.appointmentDate,
        "MM-DD-YYYYTHH:mm:ss.SSS[+00:00]"
      ).format("DD MMM YYYY, HH:mm")
    : "To be confirmed";

  return `New Appointment Request From Ollo
  
  Dear Dr. ${bookingData.doctorName},
  
  You have received a new appointment request from a patient. Please review the details below and confirm or reschedule as needed.
  
  Patient Information:
  - Name: ${bookingData.patientName}
  
  Appointment Details:
  - Requested Date: ${formattedDate}
  
  Please confirm with us if you can accommodate this appointment request.
  
  If you have any questions or need assistance, please contact our support team.
  
  Best regards,
  Ollo Health Team`;
};

// Booking Confirmation Email Templates
export const bodyBookingConfirmationToPatient = (bookingData: any) => {
  const formattedDate = bookingData.appointmentDate
    ? moment(
        bookingData.appointmentDate,
        "MM-DD-YYYYTHH:mm:ss.SSS[+00:00]"
      ).format("DD MMM YYYY, HH:mm")
    : "To be confirmed";

  const formattedTime = bookingData.appointmentDate
    ? moment(
        bookingData.appointmentDate,
        "MM-DD-YYYYTHH:mm:ss.SSS[+00:00]"
      ).format("HH:mm")
    : "";

  return `<html>
  <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto;">
  
    <div style="background: #f8f9fa;  border-radius: 8px; margin-bottom: 25px;">
      <h2 style="color: #2c3e50; margin-top: 0;">Dear ${
        bookingData.patientName
      },</h2>
      <p style="font-size: 16px; margin-bottom: 20px;">Great news! Your appointment with <strong>Dr. ${
        bookingData.doctorName
      }</strong> has been confirmed. We're looking forward to seeing you!</p>
      
      <div style="background: white; padding: 20px; border-radius: 6px; border-left: 4px solid #D9C9B2;">
        <h3 style="color: #2c3e50; margin-top: 0;">Appointment Details</h3>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; font-weight: bold; color: #555;">Doctor:</td>
            <td style="padding: 8px 0;">Dr. ${bookingData.doctorName}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; font-weight: bold; color: #555;">Date:</td>
            <td style="padding: 8px 0;">${formattedDate}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; font-weight: bold; color: #555;">Time:</td>
            <td style="padding: 8px 0;">${formattedTime}</td>
          </tr>
          ${
            bookingData.clinicName
              ? `
          <tr>
            <td style="padding: 8px 0; font-weight: bold; color: #555;">Clinic:</td>
            <td style="padding: 8px 0;">${bookingData.clinicName}</td>
          </tr>
          `
              : ""
          }
          ${
            bookingData.address
              ? `
          <tr>
            <td style="padding: 8px 0; font-weight: bold; color: #555;">Address:</td>
            <td style="padding: 8px 0;">${bookingData.address}</td>
          </tr>
          `
              : ""
          }
        </table>
      </div>
    </div>
    
    <div style="background: #e8f5e8; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
      <h3 style="color: #2c3e50; margin-top: 0;">📋 What to Bring</h3>
      <ul style="margin: 0; padding-left: 20px;">
        <li>Valid photo ID</li>
        <li>Insurance card (if applicable)</li>
        <li>List of current medications</li>
        <li>Any relevant medical records</li>
        <li>List of questions or concerns</li>
      </ul>
    </div>
    
    <div style="background: #fff3cd; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
      <h3 style="color: #2c3e50; margin-top: 0;">⚠️ Important Reminders</h3>
      <ul style="margin: 0; padding-left: 20px;">
        <li>Please arrive 15 minutes before your scheduled appointment time</li>
        <li>If you need to reschedule or cancel, please contact us at least 24 hours in advance</li>
        <li>Face masks may be required - please check our current COVID-19 protocols</li>
      </ul>
    </div>
    
    <div style="text-align: center; margin-top: 30px;">
      <p style="color: #666; font-size: 14px;">If you have any questions or need to make changes to your appointment, please don't hesitate to contact us.</p>
      <p style="color: #666; font-size: 14px;">Thank you for choosing Ollo Health!</p>
      <p style="color: #666; font-size: 14px; margin-top: 20px;">
        Best regards,<br>
        <strong>The Ollo Health Team</strong>
      </p>
    </div>
  </body>
</html>`;
};

export const textBodyBookingConfirmationToPatient = (bookingData: any) => {
  const formattedDate = bookingData.appointmentDate
    ? moment(
        bookingData.appointmentDate,
        "MM-DD-YYYYTHH:mm:ss.SSS[+00:00]"
      ).format("DD MMM YYYY, HH:mm")
    : "To be confirmed";

  const formattedTime = bookingData.appointmentDate
    ? moment(
        bookingData.appointmentDate,
        "MM-DD-YYYYTHH:mm:ss.SSS[+00:00]"
      ).format("HH:mm")
    : "";

  return `Appointment Confirmed!

Dear ${bookingData.patientName},

Great news! Your appointment with Dr. ${
    bookingData.doctorName
  } has been confirmed. We're looking forward to seeing you!

APPOINTMENT DETAILS:
- Doctor: Dr. ${bookingData.doctorName}
- Date: ${formattedDate}
- Time: ${formattedTime}
${bookingData.clinicName ? `- Clinic: ${bookingData.clinicName}` : ""}
${bookingData.address ? `- Address: ${bookingData.address}` : ""}

WHAT TO BRING:
- Valid photo ID
- Insurance card (if applicable)
- List of current medications
- Any relevant medical records
- List of questions or concerns

IMPORTANT REMINDERS:
- Please arrive 15 minutes before your scheduled appointment time
- If you need to reschedule or cancel, please contact us at least 24 hours in advance
- Face masks may be required - please check our current COVID-19 protocols

If you have any questions or need to make changes to your appointment, please don't hesitate to contact us.

Thank you for choosing Ollo Health!

Best regards,
The Ollo Health Team`;
};
