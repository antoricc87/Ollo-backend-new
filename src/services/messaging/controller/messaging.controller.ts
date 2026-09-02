import { Response } from "express";
import Util from "../../../utils/response";
import prisma from "../../../utility/prismaClient";
import MessagingService from "../model/messaging.model";

/** Patient-token chat routes (restored with S5, now that a clinician service answers). */
class MessagingHandler {
  async chats(request: any, response: Response) {
    const { id } = request.user;
    try {
      const chats = await MessagingService.getPatientChats(id);
      const unread = await prisma.message.groupBy({ by: ["chatId"], where: { chatId: { in: chats.map((c) => c.id) }, senderType: "CLINICIAN", isRead: false }, _count: { _all: true } });
      const by = new Map(unread.map((u) => [u.chatId, u._count._all]));
      return response.status(200).json(Util.success(chats.map((c) => ({ ...c, lastMessage: c.messages[0] ?? null, unread: by.get(c.id) ?? 0 })), "Chats fetched"));
    } catch (error) {
      console.error("messaging: chats failed", error);
      return response.status(500).json(Util.error({}, "Chats fetch failed"));
    }
  }

  async chat(request: any, response: Response) {
    const { id } = request.user;
    try {
      const chat = await prisma.chat.findFirst({
        where: { id: String(request.params.id), patientId: id },
        include: { clinician: { select: { id: true, firstName: true, lastName: true, specialty: true, clinicName: true } }, messages: { orderBy: { createdAt: "asc" } } },
      });
      if (!chat) return response.status(404).json(Util.error({}, "Chat not found"));
      await prisma.message.updateMany({ where: { chatId: chat.id, senderType: "CLINICIAN", isRead: false }, data: { isRead: true } });
      return response.status(200).json(Util.success(chat, "Chat fetched"));
    } catch (error) {
      console.error("messaging: chat failed", error);
      return response.status(500).json(Util.error({}, "Chat fetch failed"));
    }
  }

  async send(request: any, response: Response) {
    const { id } = request.user;
    const content = String(request.body?.content ?? "").trim();
    if (!content) return response.status(400).json(Util.error({}, "content is required"));
    try {
      const chat = await prisma.chat.findFirst({ where: { id: String(request.params.id), patientId: id }, select: { id: true, clinicianId: true } });
      if (!chat) return response.status(404).json(Util.error({}, "Chat not found"));
      const m = await MessagingService.sendMessage(content, chat.id, id, "PATIENT");
      return response.status(201).json(Util.success(m, "Message sent"));
    } catch (error) {
      console.error("messaging: send failed", error);
      return response.status(500).json(Util.error({}, "Message send failed"));
    }
  }

  /** Start (or reuse) a thread with a care-team clinician. */
  async start(request: any, response: Response) {
    const { id } = request.user;
    const clinicianId = String(request.body?.clinicianId ?? "");
    if (!clinicianId) return response.status(400).json(Util.error({}, "clinicianId is required"));
    try {
      const grant = await prisma.careTeamMember.findFirst({ where: { patientId: id, clinicianId, revokedAt: null } });
      if (!grant) return response.status(403).json(Util.error({}, "This clinician is not on your care team"));
      const chat = await MessagingService.createChat(clinicianId, id);
      return response.status(201).json(Util.success(chat, "Chat ready"));
    } catch (error) {
      console.error("messaging: start failed", error);
      return response.status(500).json(Util.error({}, "Chat start failed"));
    }
  }
}

export default new MessagingHandler();
