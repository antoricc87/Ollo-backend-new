import { MessageSenderType } from "@prisma/client";
import prisma from "../../../utility/prismaClient";

/**
 * Patient ↔ clinician chat storage. No routes today (the app's chat screen is
 * on hold until a clinician service exists to answer); Ollie's
 * `message_care_team` tool writes through `createChat` + `sendMessage`.
 * The doctor-side draft generator left with the physician surface (2026-08-29,
 * prompt archived in docs/clinician-side-prompts.md).
 */
export class MessagingService {
  async createChat(clinicianId: string, patientId: string) {
    if (!patientId || !clinicianId) throw new Error("patientId and clinicianId are required");
    return prisma.chat.upsert({
      where: { unique_clinician_patient_chat: { clinicianId, patientId } },
      update: { updatedAt: new Date() },
      create: { clinicianId, patientId },
    });
  }

  async sendMessage(message: string, chatId: string, senderId: string, senderType: MessageSenderType) {
    return prisma.$transaction(async (tx) => {
      const newMessage = await tx.message.create({
        data: { chatId, senderId, content: message, senderType },
      });
      await tx.chat.update({ where: { id: chatId }, data: { updatedAt: new Date() } });
      return newMessage;
    });
  }

  async getChatById(chatId: string) {
    return prisma.chat.findUnique({ where: { id: chatId }, include: { messages: true } });
  }

  async getPatientChats(patientId: string) {
    return prisma.chat.findMany({
      where: { patientId },
      include: {
        clinician: { select: { id: true, firstName: true, lastName: true, specialty: true, clinicName: true } },
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: { updatedAt: "desc" },
    });
  }
}

export default new MessagingService();
