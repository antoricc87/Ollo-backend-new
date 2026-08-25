import { Prisma } from "@prisma/client";
import prisma from "../../../utility/prismaClient";

/**
 * Append-only audit trail for everything the agent does on a patient's
 * behalf. Writes are fire-and-forget — an audit failure must never break a
 * response — but they are awaited by tests via the returned promise.
 */

export type AuditEvent =
  | "tool_call"
  | "tool_commit"
  | "safety_flag"
  | "red_flag"
  | "response"
  | "memory_write"
  | "error";

export const audit = (
  patientId: string,
  event: AuditEvent,
  details: {
    threadId?: string | null;
    messageId?: string | null;
    toolName?: string | null;
    payload?: unknown;
  } = {}
) =>
  prisma.agentAuditLog
    .create({
      data: {
        patientId,
        event,
        threadId: details.threadId ?? null,
        messageId: details.messageId ?? null,
        toolName: details.toolName ?? null,
        payload:
          details.payload === undefined
            ? undefined
            : (details.payload as Prisma.InputJsonValue),
      },
    })
    .catch((error) => {
      console.error("agent audit write failed", event, error);
      return null;
    });

export const listAudit = (patientId: string, limit = 100) =>
  prisma.agentAuditLog.findMany({
    where: { patientId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
