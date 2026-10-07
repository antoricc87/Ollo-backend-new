import prisma from "../../utility/prismaClient";
import type { ApnsEnv } from "./apns/client";

/**
 * Device tokens. The app registers on every launch (and on token change);
 * logout unregisters. A token is unique across users — if a phone is handed
 * to another account, the row moves to the new user rather than duplicating.
 *
 * `apnsEnv` is a GUESS at registration: a build signed with a development
 * profile talks to sandbox APNs even in Release, so the sender corrects the
 * guess on BadDeviceToken (see notifications.service).
 */

const DEV_BUNDLE_SUFFIX = ".dev";

export const guessEnv = (bundleId: string): ApnsEnv => (bundleId.endsWith(DEV_BUNDLE_SUFFIX) ? "sandbox" : "production");

export async function registerDevice(userId: string, input: { token: string; bundleId: string; platform?: string; appVersion?: string | null }) {
  const token = input.token.trim().toLowerCase();
  const existing = await prisma.device.findUnique({ where: { token } });
  const data = {
    userId,
    bundleId: input.bundleId,
    platform: input.platform ?? "ios",
    appVersion: input.appVersion ?? null,
    lastSeenAt: new Date(),
    disabledAt: null,
  };
  if (!existing) return prisma.device.create({ data: { token, apnsEnv: guessEnv(input.bundleId), ...data } });
  // Keep a corrected apnsEnv unless the bundle changed (a new app on the same token is impossible, but cheap to guard).
  const apnsEnv = existing.bundleId === input.bundleId ? existing.apnsEnv : guessEnv(input.bundleId);
  return prisma.device.update({ where: { token }, data: { ...data, apnsEnv } });
}

export async function unregisterDevice(userId: string, token: string) {
  const t = token.trim().toLowerCase();
  const r = await prisma.device.updateMany({ where: { token: t, userId }, data: { disabledAt: new Date() } });
  return r.count > 0;
}

export const activeDevices = (userId: string) => prisma.device.findMany({ where: { userId, disabledAt: null }, orderBy: { lastSeenAt: "desc" } });

export const disableDevice = (id: string) => prisma.device.update({ where: { id }, data: { disabledAt: new Date() } });

export const setDeviceEnv = (id: string, apnsEnv: ApnsEnv) => prisma.device.update({ where: { id }, data: { apnsEnv } });
