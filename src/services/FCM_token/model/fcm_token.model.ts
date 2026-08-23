import prisma from "../../../utility/prismaClient";

class FCMTokenService {
  async handleFCMToken(token: string, patientId: string) {
    try {
      const existingFCMToken = await prisma.userFCMToken.findUnique({
        where: { userId: patientId },
      });
      if (!existingFCMToken) {
        // Create a new token if none exists
        const fcmToken = await prisma.userFCMToken.create({
          data: {
            userId: patientId,
            FCMToken: token,
          },
        });
        return fcmToken;
      } else {
        if (existingFCMToken.FCMToken !== token) {
          // Update the token if it has changed
          const updatedFCMToken = await prisma.userFCMToken.update({
            where: { userId: patientId },
            data: { FCMToken: token },
          });
          return updatedFCMToken;
        }
        // Return the existing token if it hasn't changed
        return existingFCMToken;
      }
    } catch (error: unknown) {
      console.error("Error occurred while checking FCM token");
      throw error;
    }
  }
}

export default new FCMTokenService();
