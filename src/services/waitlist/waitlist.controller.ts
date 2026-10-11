import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import prisma from "../../utility/prismaClient";
import Util from "../../utils/response";
import sendEmail from "../../utils/emailService";
import { createRateLimiter, escapeHtml, waitlistSchema } from "./waitlist.model";

// 5 signups per IP per 10 minutes.
const allow = createRateLimiter(5, 10 * 60 * 1000);

const NOTIFY_TO = process.env.WAITLIST_NOTIFY_TO || "info@ollo-health.com";

export class WaitlistHandler {
  /**
   * POST /api/waitlist {email, source?} — public. Answers the same for a new
   * and an already-listed email so the endpoint can't be used to check who
   * signed up.
   */
  async join(request: Request, response: Response) {
    if (!allow(request.ip || "unknown")) {
      return response
        .status(429)
        .json(Util.error({}, "Too many requests. Please try again later."));
    }

    const parsed = waitlistSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return response
        .status(400)
        .json(Util.error({}, "Please enter a valid email address."));
    }
    const { email, source } = parsed.data;

    try {
      await prisma.waitlistEntry.create({ data: { email, source } });

      // sendEmail logs and swallows its own errors — a failed notification
      // never fails the signup.
      void sendEmail(
        NOTIFY_TO,
        `New waitlist signup: ${email}`,
        `<p><strong>${escapeHtml(email)}</strong> joined the Ollo waitlist${
          source ? ` (from <em>${escapeHtml(source)}</em>)` : ""
        }.</p>`,
        `${email} joined the Ollo waitlist${source ? ` (from ${source})` : ""}.`
      );
    } catch (error) {
      const duplicate =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
      if (!duplicate) {
        console.error("waitlist.join failed:", error);
        return response
          .status(500)
          .json(Util.error({}, "Something went wrong. Please try again."));
      }
    }

    return response.status(200).json(Util.success({}, "You're on the list."));
  }
}

export default new WaitlistHandler();
