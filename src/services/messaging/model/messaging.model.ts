import { MessageSenderType } from "@prisma/client";
import prisma from "../../../utility/prismaClient";
import { buildPatientSnapshot } from "../../agent/context/snapshot";

/** Post-visit (SOAP) notes for the doctor's draft context. Moved here from the retired agent module. */
const getPatientSoapNotes = async (patientId: string) => {
  try {
    return await prisma.visit.findMany({
      where: { OR: [{ patientId }, { fhirPatientId: patientId }] },
      select: { visitType: true, visitTime: true, postVisitNote: true },
    });
  } catch (error: unknown) {
    console.error("Error fetching the soap notes", error);
    throw error;
  }
};
import dotenv from "dotenv";
import OpenAI from "openai";
import { AllergySummary, ConditionSummary } from "../../../types";
dotenv.config();
const apiKey = process.env.REACT_APP_OPENAI_API_KEY;
const openai = new OpenAI({
  apiKey: apiKey || "",
});
export class MessagingService {
  async createChat(doctorId: string, patientId: string) {
    if (!patientId || !doctorId)
      throw new Error("PatientId and DoctorId are required");
    try {
      return await prisma.chat.upsert({
        where: {
          unique_user_patient_chat: {
            userId: doctorId,
            patientId: patientId,
          },
        },
        update: {
          updatedAt: new Date(),
        },
        create: {
          userId: doctorId,
          patientId: patientId,
        },
      });
    } catch (error: unknown) {
      console.error("Error creating the chat", error);
      throw error;
    }
  }

  async sendMessage(
    message: string,
    chatId: string,
    senderId: string,
    senderType: MessageSenderType
  ) {
    try {
      // Use transaction to create message and update chat
      return await prisma.$transaction(async (tx) => {
        // Create the message
        const newMessage = await tx.message.create({
          data: {
            chatId: chatId,
            senderId: senderId,
            content: message,
            senderType: senderType,
          },
        });

        // Update chat's updatedAt timestamp
        await tx.chat.update({
          where: { id: chatId },
          data: { updatedAt: new Date() },
        });

        return newMessage;
      });
    } catch (error: unknown) {
      console.error("error sending message", error);
      throw error;
    }
  }

  async getChatById(chatId: string) {
    try {
      const chat = await prisma.chat.findUnique({
        where: { id: chatId },
        include: {
          messages: true,
        },
      });
      if (chat) return chat;
    } catch (error: unknown) {
      console.error("Error fetching the chat", error);
      throw error;
    }
  }
  async getAllChats(userId: string) {
    try {
      const fetchedChats = await prisma.chat.findMany({
        where: {
          OR: [{ userId: userId }, { patientId: userId }],
        },
        include: {
          user: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          patient: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          messages: {
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
        orderBy: { updatedAt: "desc" },
      });
      return fetchedChats;
    } catch (error: unknown) {
      console.error("Error fetching conversations", error);
      throw error;
    }
  }
  // create message draft for doctor
  async createMessageDraft(chatId: string) {
    try {
      const conversation = await this.getChatById(chatId);
      if (!conversation) {
        throw new Error("Chat not found");
      }

      // Get recent patient messages (last 5 messages or until last doctor message)
      // const contextMessages = [];
      // for (let i = conversation.messages.length - 1; i >= 0; i--) {
      //   const message = conversation.messages[i];
      //   contextMessages.push({
      //     content: message.content,
      //     senderType: message.senderType,
      //     createdAt: message.createdAt,
      //   });
      //   if (message.senderType === "DOCTOR" || contextMessages.length >= 5) {
      //     break;
      //   }
      // }
      const contextMessages = conversation.messages;
      console.log(contextMessages);
      // Ollie's per-turn snapshot is the one source of patient context now.
      const snapshot = await buildPatientSnapshot(conversation.patientId);
      if (!snapshot) throw new Error("Patient data not available");

      // Extract only the most relevant health data for message context
      const relevantHealthData = {
        conditions: snapshot.records.conditions,
        allergies: snapshot.records.allergies,
        currentWeekCalories: snapshot.week.avgCalories ? `${snapshot.week.avgCalories} kcal/day avg (${snapshot.week.daysLogged} days logged)` : null,
        nutritionStatus: snapshot.today_log.calories === null ? "Missing today's nutrition data" : "Nutrition data available",
        timezone: snapshot.timeZone,
      };

      const prompt = `You are a primary care physician responding to a patient in a chat conversation. 

PATIENT MESSAGES (most recent first):
${contextMessages
  .map((msg) => `${msg.senderType}: ${msg.content} (${msg.createdAt})`)
  .join("\n")}

PATIENT HEALTH CONTEXT:
- Chronic Conditions: ${
        relevantHealthData.conditions.length > 0
          ? relevantHealthData.conditions.join(", ")
          : "None documented"
      }
- Allergies: ${
        relevantHealthData.allergies.length > 0
          ? relevantHealthData.allergies.join(", ")
          : "None documented"
      }
- Current Week Calorie Intake: ${
        relevantHealthData.currentWeekCalories || "Not available"
      }
- Nutrition Status: ${relevantHealthData.nutritionStatus}

Create a natural, conversational chat message that:
1. Responds directly to what the patient said
2. References specific health conditions, allergies, or data when relevant (e.g., "this could be related to your [condition name]")
3. Gives practical advice or next steps
4. Sounds like a natural conversation, not a formal letter
5. Is warm and supportive but professional
6. No subject lines, signatures, or formal formatting - just the message content

Chat message:`;

      const messageDraft = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content:
              "You are a primary care physician creating message drafts for patients. Be professional, empathetic, and helpful.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        max_tokens: 500,
      });

      return {
        draft:
          messageDraft.choices[0]?.message?.content ||
          "Unable to generate draft",
        context: {
          messageCount: contextMessages.length,
          hasHealthData: true,
          conditions: relevantHealthData.conditions,
          allergies: relevantHealthData.allergies,
        },
      };
    } catch (error: unknown) {
      console.error("Error creating the draft", error);
      throw error;
    }
  }

  // create message draft for doctor (streaming version)
  async createMessageDraftStream(chatId: string) {
    try {
      const conversation = await this.getChatById(chatId);
      if (!conversation) {
        throw new Error("Chat not found");
      }

      // Get recent patient messages (last 5 messages or until last doctor message)
      const contextMessages = [];
      for (let i = conversation.messages.length - 1; i >= 0; i--) {
        const message = conversation.messages[i];
        contextMessages.push({
          content: message.content,
          senderType: message.senderType,
          createdAt: message.createdAt,
        });
        if (message.senderType === "DOCTOR" || contextMessages.length >= 5) {
          break;
        }
      }

      // Ollie's per-turn snapshot is the one source of patient context now.
      const snapshot = await buildPatientSnapshot(conversation.patientId);
      if (!snapshot) throw new Error("Patient data not available");

      // Extract only the most relevant health data for message context
      const visitsNotes = await getPatientSoapNotes(conversation.patientId);
      const relevantHealthData = {
        conditions: snapshot.records.conditions,
        allergies: snapshot.records.allergies,
        currentWeekCalories: snapshot.week.avgCalories ? `${snapshot.week.avgCalories} kcal/day avg (${snapshot.week.daysLogged} days logged)` : null,
        nutritionStatus: snapshot.today_log.calories === null ? "Missing today's nutrition data" : "Nutrition data available",
        timezone: snapshot.timeZone,
      };

      const prompt = `You are a primary care physician responding to a patient in a chat conversation. 

PATIENT MESSAGES (most recent first):
${contextMessages
  .map((msg) => `${msg.senderType}: ${msg.content} (${msg.createdAt})`)
  .join("\n")}

PATIENT HEALTH CONTEXT:
- Chronic Conditions: ${
        relevantHealthData.conditions.length > 0
          ? relevantHealthData.conditions.join(", ")
          : "None documented"
      }
- Allergies: ${
        relevantHealthData.allergies.length > 0
          ? relevantHealthData.allergies.join(", ")
          : "None documented"
      }
- Current Week Calorie Intake: ${
        relevantHealthData.currentWeekCalories || "Not available"
      }
- Nutrition Status: ${relevantHealthData.nutritionStatus}

RECENT CLINICAL VISITS & SOAP NOTES:
${
  visitsNotes && visitsNotes.length > 0
    ? visitsNotes
        .map(
          (note: any) =>
            `Visit Type: ${note.visitType || "Unknown"}\n` +
            `Visit Date: ${note.visitTime || "Unknown"}\n` +
            `Assessment: ${note.postVisitNote || "Not documented"}\n` +
            `---`
        )
        .join("\n")
    : "No recent visit notes available"
}

Create a natural, conversational chat message that:
1. Responds directly to what the patient said
2. References specific health conditions, allergies, recent visit findings, or data when relevant (e.g., "this could be related to your [condition name]" or "based on our last visit where we discussed...")
3. Gives practical advice or next steps that align with recent clinical assessments
4. Sounds like a natural conversation, not a formal letter
5. Is warm and supportive but professional
6. No subject lines, signatures, or formal formatting - just the message content
7. When appropriate, reference recent visit discussions or follow-up on previous recommendations

Chat message:`;

      const stream = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content:
              "You are a primary care physician creating message drafts for patients. Be professional, empathetic, and helpful.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        max_tokens: 500,
        stream: true,
      });

      return {
        stream,
        // context: {
        //   messageCount: contextMessages.length,
        //   hasHealthData: true,
        //   conditions: relevantHealthData.conditions,
        //   allergies: relevantHealthData.allergies,
        // },
      };
    } catch (error: unknown) {
      console.error("Error creating the draft", error);
      throw error;
    }
  }
}

export default new MessagingService();
