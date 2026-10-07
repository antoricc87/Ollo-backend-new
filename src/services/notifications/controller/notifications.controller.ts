import { Response } from "express";
import { z } from "zod";
import Util from "../../../utils/response";
import { registerDevice, unregisterDevice, activeDevices } from "../devices.store";
import { listNotifications, markOpened, sendNow } from "../notifications.service";
import { apnsConfigured } from "../apns/client";

/** Devices and notifications — patient-scoped; identity from the token only. */

const RegisterBody = z.object({
  token: z.string().regex(/^[0-9a-fA-F]{32,200}$/, "APNs token must be hex"),
  bundleId: z.string().min(3).max(120),
  platform: z.enum(["ios"]).default("ios"),
  appVersion: z.string().max(40).nullish(),
});

const TestBody = z.object({
  title: z.string().max(80).optional(),
  body: z.string().max(200).optional(),
  route: z.string().max(200).optional(),
});

class NotificationsHandler {
  register = async (request: any, response: Response) => {
    const userId = request.user?.id;
    if (!userId) return response.status(401).json(Util.error({}, "Unauthorized"));
    const parsed = RegisterBody.safeParse(request.body);
    if (!parsed.success) return response.status(400).json(Util.error(parsed.error.flatten(), "Invalid device"));
    const d = await registerDevice(userId, parsed.data as { token: string; bundleId: string; platform?: string; appVersion?: string | null });
    return response.status(200).json(Util.success({ id: d.id, apnsEnv: d.apnsEnv, bundleId: d.bundleId }, "Device registered"));
  };

  unregister = async (request: any, response: Response) => {
    const userId = request.user?.id;
    if (!userId) return response.status(401).json(Util.error({}, "Unauthorized"));
    const token = String(request.params.token ?? "");
    const ok = await unregisterDevice(userId, token);
    return response.status(200).json(Util.success({ removed: ok }, ok ? "Device removed" : "No such device"));
  };

  devices = async (request: any, response: Response) => {
    const userId = request.user?.id;
    if (!userId) return response.status(401).json(Util.error({}, "Unauthorized"));
    const list = await activeDevices(userId);
    return response.status(200).json(
      Util.success(
        { devices: list.map((d) => ({ id: d.id, bundleId: d.bundleId, apnsEnv: d.apnsEnv, appVersion: d.appVersion, lastSeenAt: d.lastSeenAt })), transport: apnsConfigured() ? "apns" : "none" },
        "Devices"
      )
    );
  };

  list = async (request: any, response: Response) => {
    const userId = request.user?.id;
    if (!userId) return response.status(401).json(Util.error({}, "Unauthorized"));
    const limit = Math.min(100, Math.max(1, parseInt(String(request.query.limit ?? "30"), 10) || 30));
    const rows = await listNotifications(userId, limit);
    return response.status(200).json(Util.success({ notifications: rows }, "Notifications"));
  };

  opened = async (request: any, response: Response) => {
    const userId = request.user?.id;
    if (!userId) return response.status(401).json(Util.error({}, "Unauthorized"));
    const ok = await markOpened(userId, String(request.params.id ?? ""));
    return response.status(200).json(Util.success({ opened: ok }, ok ? "Marked opened" : "Not found or already opened"));
  };

  /**
   * Send yourself a push now. Only ever to the caller's own devices, so it is
   * safe to leave on: it is how the transport is checked on a real phone.
   */
  test = async (request: any, response: Response) => {
    const userId = request.user?.id;
    if (!userId) return response.status(401).json(Util.error({}, "Unauthorized"));
    const parsed = TestBody.safeParse(request.body ?? {});
    if (!parsed.success) return response.status(400).json(Util.error(parsed.error.flatten(), "Invalid test"));
    const r = await sendNow({
      userId,
      kind: "test",
      title: parsed.data.title ?? "Ollo",
      body: parsed.data.body ?? "Test notification — tap to open Ollie.",
      route: parsed.data.route ?? "ollie",
    });
    return response.status(200).json(Util.success({ notification: r.row, sent: r.sent, failed: r.failed, transport: apnsConfigured() ? "apns" : "none" }, r.sent > 0 ? "Sent" : "Not sent"));
  };
}

export default new NotificationsHandler();
