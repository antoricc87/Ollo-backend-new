import prisma from "../../utility/prismaClient";
import { apnsConfigured, sendApns, type ApnsEnv, type ApnsResult } from "./apns/client";
import { activeDevices, disableDevice, setDeviceEnv } from "./devices.store";

/**
 * The notification outbox (docs/notifications-plan.md §3).
 *
 *   trigger → queueNotification() → Notification row (status queued)
 *          → sendDue() sweep (every minute) → APNs → device(s) → row sent/failed
 *
 * Nothing else in the backend talks to APNs. The policy gate (quiet hours,
 * budget, merge — plan §3.2) slots in between the row and the send once the
 * catalogue is decided; today only dedupe runs, so the transport can be
 * tested on its own.
 *
 * `kind` is free text here (the catalogue is still open) — callers pass a
 * stable snake_case name; the enum arrives with the gate.
 */

export type QueueInput = {
  userId: string;
  kind: string;
  title: string;
  body: string;
  /** In-app path the tap opens, without scheme, e.g. "ollie?threadId=abc" or "mylabs". */
  route?: string | null;
  threadId?: string | null;
  /** Default: now. */
  scheduledFor?: Date;
  /** Same key already queued/sent today for this user → row is suppressed as a duplicate. */
  dedupeKey?: string | null;
};

export type NotificationRow = Awaited<ReturnType<typeof prisma.notification.create>>;

const startOfUtcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

export async function queueNotification(input: QueueInput): Promise<NotificationRow> {
  const scheduledFor = input.scheduledFor ?? new Date();
  let status = "queued";
  let suppressedReason: string | null = null;
  if (input.dedupeKey) {
    const dup = await prisma.notification.findFirst({
      where: {
        userId: input.userId,
        dedupeKey: input.dedupeKey,
        status: { in: ["queued", "sent"] },
        createdAt: { gte: startOfUtcDay(scheduledFor) },
      },
      select: { id: true },
    });
    if (dup) {
      status = "suppressed";
      suppressedReason = "duplicate";
    }
  }
  return prisma.notification.create({
    data: {
      userId: input.userId,
      kind: input.kind,
      title: input.title,
      body: input.body,
      route: input.route ?? null,
      threadId: input.threadId ?? null,
      scheduledFor,
      dedupeKey: input.dedupeKey ?? null,
      status,
      suppressedReason,
    },
  });
}

/** Injectable for tests; production uses the real HTTP/2 client. */
type Sender = typeof sendApns;
let sender: Sender = sendApns;
export const _setApnsSender = (s: Sender | null) => {
  sender = s ?? sendApns;
};

/**
 * The custom keys ride twice: at the top level (what any native reader sees)
 * and under `body`, because expo-notifications on iOS exposes
 * `userInfo["body"]` as `notification.request.content.data` for a REMOTE
 * push (EXNotificationSerializer.m) — the tap handler read nothing until
 * this was nested (found on the first phone test, Oct 7 2026).
 */
const payloadFor = (n: { id: string; kind: string; title: string; body: string; route: string | null; threadId: string | null }) => {
  const data = {
    notificationId: n.id,
    kind: n.kind,
    ...(n.route ? { route: n.route } : {}),
    ...(n.threadId ? { threadId: n.threadId } : {}),
  };
  return { aps: { alert: { title: n.title, body: n.body }, sound: "default", "thread-id": n.kind }, ...data, body: data };
};

const otherEnv = (e: string): ApnsEnv => (e === "sandbox" ? "production" : "sandbox");

type Attempt = { deviceToken: string; topic: string; payload: ReturnType<typeof payloadFor>; collapseId?: string };

/** One device: send, flip environment once on BadDeviceToken, disable on a dead token. */
async function attempt(deviceId: string, env: ApnsEnv, base: Attempt): Promise<ApnsResult> {
  try {
    const first = await sender({ env, ...base });
    if (first.ok) return first;
    if (first.wrongEnv) {
      const flipped = otherEnv(env);
      const retry = await sender({ env: flipped, ...base });
      if (retry.ok) await setDeviceEnv(deviceId, flipped);
      else if (retry.wrongEnv) await disableDevice(deviceId); // bad on both: the token is garbage
      return retry;
    }
    if (first.unregistered) await disableDevice(deviceId);
    return first;
  } catch (e) {
    return { ok: false, status: 0, reason: (e as Error).message, unregistered: false, wrongEnv: false };
  }
}

/**
 * Deliver one row to every active device of its user. A device whose token
 * fails with BadDeviceToken is retried once on the other environment and the
 * row remembers which one worked; 410 disables the device. The row is `sent`
 * if at least one device took it.
 */
export async function deliver(n: NotificationRow): Promise<{ sent: number; failed: number }> {
  if (!apnsConfigured()) {
    await prisma.notification.update({ where: { id: n.id }, data: { status: "failed", suppressedReason: "no_transport", error: "APNs not configured" } });
    return { sent: 0, failed: 0 };
  }
  const devices = await activeDevices(n.userId);
  if (devices.length === 0) {
    await prisma.notification.update({ where: { id: n.id }, data: { status: "suppressed", suppressedReason: "no_device" } });
    return { sent: 0, failed: 0 };
  }
  let sent = 0;
  let failed = 0;
  let apnsId: string | null = null;
  const errors: string[] = [];
  for (const d of devices) {
    const base = { deviceToken: d.token, topic: d.bundleId, payload: payloadFor(n), collapseId: n.dedupeKey ?? undefined };
    const r = await attempt(d.id, d.apnsEnv as ApnsEnv, base);
    if (r.ok) {
      sent += 1;
      apnsId = apnsId ?? r.apnsId ?? null;
    } else {
      failed += 1;
      errors.push(`${d.bundleId}/${d.apnsEnv}: ${r.status} ${r.reason}`);
    }
  }
  await prisma.notification.update({
    where: { id: n.id },
    data: sent > 0 ? { status: "sent", sentAt: new Date(), apnsId, error: errors.length ? errors.join("; ") : null } : { status: "failed", error: errors.join("; ") || "no delivery" },
  });
  return { sent, failed };
}

/** The sweep: deliver every queued row whose time has come. Oldest first, bounded per run. */
export async function sendDue(now = new Date(), limit = 200): Promise<{ picked: number; sent: number; failed: number }> {
  const due = await prisma.notification.findMany({ where: { status: "queued", scheduledFor: { lte: now } }, orderBy: { scheduledFor: "asc" }, take: limit });
  let sent = 0;
  let failed = 0;
  for (const n of due) {
    const r = await deliver(n);
    sent += r.sent;
    failed += r.failed;
  }
  return { picked: due.length, sent, failed };
}

/** Queue and deliver at once — for events that should not wait for the next sweep, and for the dev test route. */
export async function sendNow(input: QueueInput) {
  const row = await queueNotification(input);
  if (row.status !== "queued") return { row, sent: 0, failed: 0 };
  const r = await deliver(row);
  const fresh = await prisma.notification.findUnique({ where: { id: row.id } });
  return { row: fresh ?? row, ...r };
}

export const listNotifications = (userId: string, limit = 30) => prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: limit });

export async function markOpened(userId: string, id: string) {
  const r = await prisma.notification.updateMany({ where: { id, userId, openedAt: null }, data: { openedAt: new Date() } });
  return r.count > 0;
}
