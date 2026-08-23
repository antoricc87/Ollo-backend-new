import { Request, Response } from "express";
import Util from "../../../utils/response";
import MessagingService from "../model/messaging.model";

export class MessagingHandler {
  async createChat(request: Request, response: Response) {
    const { doctorId, patientId } = request.body;
    if (!doctorId || !patientId)
      return response
        .status(400)
        .json(Util.error({}, "Doctor and Patient ID are required"));
    try {
      const createdChat = await MessagingService.createChat(
        doctorId,
        patientId
      );
      if (createdChat)
        return response
          .status(201)
          .json(Util.success(createdChat, "chatCreatedSuccessfully"));
    } catch (error: unknown) {
      return response
        .status(500)
        .json(Util.error(error, "Error creating the chat"));
    }
  }

  async sendMessage(request: Request, response: Response) {
    const { chatId, messageBody, senderId, senderType } = request.body;
    if (!messageBody || !senderId || !senderType || !chatId)
      return response
        .status(400)
        .json(Util.error({}, "A mandatory parameter is missing"));
    try {
      const messageSent = await MessagingService.sendMessage(
        messageBody,
        chatId,
        senderId,
        senderType
      );
      if (messageSent)
        return response
          .status(201)
          .json(Util.success(messageSent, "Message sent successfully"));
    } catch (error: unknown) {
      return response
        .status(500)
        .json(Util.error(error, "Error sending the message"));
    }
  }

  async getChatById(request: Request, response: Response) {
    const { id } = request.params;
    if (!id)
      return response.status(400).json(Util.error({}, "ChatId is missing"));
    try {
      const fetchedChat = await MessagingService.getChatById(id);
      if (fetchedChat)
        return response
          .status(200)
          .json(Util.success(fetchedChat, "Chat fetched successfully"));
    } catch (error: unknown) {
      return response
        .status(500)
        .json(Util.error(error, "Error fetching the chat"));
    }
  }

  async getAllChats(request: any, response: Response) {
    const { id } = request.user;
    try {
      const allChats = await MessagingService.getAllChats(id);
      if (allChats)
        return response
          .status(200)
          .json(Util.success(allChats, "Chats fetched successfully"));
    } catch (error: unknown) {
      return response
        .status(500)
        .json(Util.error(error, "Error fetching the chats"));
    }
  }

  async createMessageDraft(request: Request, response: Response) {
    const { chatId } = request.body;
    try {
      const messageDraft = await MessagingService.createMessageDraft(chatId);
      if (messageDraft)
        return response
          .status(201)
          .json(Util.success(messageDraft, "Draft created successfully"));
    } catch (error: unknown) {
      return response
        .status(500)
        .json(Util.error(error, "Error creating the draft"));
    }
  }

  async createMessageDraftStream(request: Request, response: Response) {
    const { chatId } = request.body;
    console.log("function reached");
    if (!chatId) {
      return response.status(400).json(Util.error({}, "ChatId is required"));
    }

    try {
      const {
        stream,
        // context
      } = await MessagingService.createMessageDraftStream(chatId);

      // Set headers for streaming
      response.setHeader("Content-Type", "text/plain; charset=utf-8");
      response.setHeader("Transfer-Encoding", "chunked");
      response.setHeader("Cache-Control", "no-cache");
      response.setHeader("Connection", "keep-alive");

      // Send context as first chunk (optional)
      // response.write(`CONTEXT:${JSON.stringify(context)}\n\n`);

      // Stream the message draft
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || "";
        if (content) {
          response.write(content);
        }
      }

      response.end();
    } catch (error: unknown) {
      console.error("Error in streaming draft:", error);
      if (!response.headersSent) {
        return response
          .status(500)
          .json(Util.error(error, "Error creating the streaming draft"));
      }
    }
  }
}

export default new MessagingHandler();
