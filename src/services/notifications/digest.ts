import moment from "moment-timezone";
import prisma from "../../utility/prismaClient";
import { safeTz } from "../agent/memory/dates";
import { DIGEST_HOUR, digestPush, WEEKLY_CAP } from "./gate";
import { agentPushCounts, queueNotification } from "./notifications.service";

/**
 * THE MORNING DIGEST — everything Ollie did since the last one, as ONE push.
 *
 * Held rows (gate.ts) wait here. A note the person already opened is not
 * news and drops out; the rest become one row of kind `digest`, which the
 * minute sweep delivers like any other. The held rows are marked `merged`, so
 * the outbox still shows what each push stood for.
 *
 * The work itself never depends on this: every note is in the app (Ollie's
 * row on the dashboard, the Ready list) whether or not a push goes out.
 */

export type DigestResult = { userId: string; items: number; dropped: number; pushed: boolean; reason?: string };

export async function runDigestFor(userId: string, now = new Date()): Promise<DigestResult> {
  const held = await prisma.notification.findMany({ where: { userId, status: "held", scheduledFor: { lte: now } }, orderBy: { createdAt: "asc" } });
  if (!held.length) return { userId, items: 0, dropped: 0, pushed: false, reason: "nothing held" };

  const threadIds = held.map((h) => h.threadId).filter((t): t is string => !!t);
  const seen = new Set(
    (await prisma.agentThread.findMany({ where: { id: { in: threadIds }, seenAt: { not: null } }, select: { id: true } })).map((t) => t.id)
  );
  const stale = held.filter((h) => h.threadId && seen.has(h.threadId));
  const live = held.filter((h) => !(h.threadId && seen.has(h.threadId)));
  if (stale.length) await prisma.notification.updateMany({ where: { id: { in: stale.map((s) => s.id) } }, data: { status: "merged", suppressedReason: "seen" } });
  if (!live.length) return { userId, items: 0, dropped: stale.length, pushed: false, reason: "all already opened" };

  const patient = await prisma.patient.findUnique({ where: { id: userId }, select: { timeZone: true } });
  const counts = await agentPushCounts(userId, now, safeTz(patient?.timeZone));
  // Over the week's cap the work stays in the app, unannounced.
  if (counts.pushedThisWeek >= WEEKLY_CAP) {
    await prisma.notification.updateMany({ where: { id: { in: live.map((l) => l.id) } }, data: { status: "merged", suppressedReason: "weekly_cap" } });
    return { userId, items: live.length, dropped: stale.length, pushed: false, reason: "weekly cap" };
  }

  const push = digestPush(live.map((l) => ({ kind: l.kind, threadId: l.threadId })))!;
  const row = await queueNotification({
    userId,
    kind: "digest",
    title: "Ollie",
    body: push.body,
    route: push.route,
    threadId: push.threadId,
    scheduledFor: now,
    dedupeKey: `digest:${moment(now).tz(safeTz(patient?.timeZone)).format("YYYY-MM-DD")}`,
  });
  await prisma.notification.updateMany({ where: { id: { in: live.map((l) => l.id) } }, data: { status: "merged", suppressedReason: `digest:${row.id}` } });
  return { userId, items: live.length, dropped: stale.length, pushed: row.status === "queued" };
}

/** Called by the hourly agent tick after the morning tasks: everyone whose local clock is at the digest hour. */
export async function runDigestDue(now = new Date()) {
  const waiting = await prisma.notification.findMany({ where: { status: "held", scheduledFor: { lte: now } }, distinct: ["userId"], select: { userId: true, user: { select: { timeZone: true } } } });
  const results: DigestResult[] = [];
  for (const w of waiting) {
    if (moment(now).tz(safeTz(w.user.timeZone)).hour() !== DIGEST_HOUR) continue;
    try {
      results.push(await runDigestFor(w.userId, now));
    } catch (e) {
      console.error(`digest failed for ${w.userId}`, e);
    }
  }
  return results;
}
