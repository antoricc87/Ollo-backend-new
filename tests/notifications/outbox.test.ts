/**
 * The notification outbox: a row first, APNs second. The transport is
 * injected so these run without a key or a network; what they pin is the
 * delivery rules — dedupe, environment flip on BadDeviceToken, a dead token
 * disabling its device, and the row's final status.
 */
const mockPrisma = {
  notification: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn() },
  device: { findMany: jest.fn(), update: jest.fn(), findUnique: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
};
jest.mock("../../src/utility/prismaClient", () => ({ __esModule: true, default: mockPrisma }));

const svc = require("../../src/services/notifications/notifications.service");
const { registerDevice, guessEnv } = require("../../src/services/notifications/devices.store");

const row = (over: Partial<any> = {}) => ({ id: "n1", userId: "u1", kind: "weekly_update", title: "Ollie", body: "Your weekly update", route: "ollie?threadId=t1", threadId: "t1", dedupeKey: "weekly_update:t1", status: "queued", ...over });
const device = (over: Partial<any> = {}) => ({ id: "d1", userId: "u1", token: "abc", bundleId: "com.ollohealth.ollo", apnsEnv: "production", disabledAt: null, ...over });

describe("queueNotification", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.notification.create.mockImplementation(async ({ data }: any) => ({ id: "n1", ...data }));
  });

  it("queues a row with the route and dedupe key", async () => {
    mockPrisma.notification.findFirst.mockResolvedValueOnce(null);
    const r = await svc.queueNotification({ userId: "u1", kind: "weekly_update", title: "Ollie", body: "x", route: "ollie?threadId=t1", dedupeKey: "k" });
    expect(r.status).toBe("queued");
    expect(mockPrisma.notification.create.mock.calls[0][0].data).toMatchObject({ userId: "u1", kind: "weekly_update", route: "ollie?threadId=t1", dedupeKey: "k", status: "queued" });
  });

  it("suppresses a second row with the same dedupe key the same day", async () => {
    mockPrisma.notification.findFirst.mockResolvedValueOnce({ id: "earlier" });
    const r = await svc.queueNotification({ userId: "u1", kind: "weekly_update", title: "Ollie", body: "x", dedupeKey: "k" });
    expect(r.status).toBe("suppressed");
    expect(r.suppressedReason).toBe("duplicate");
  });
});

describe("deliver", () => {
  const send = jest.fn();
  beforeAll(() => {
    process.env.APNS_KEY_ID = "KEY";
    process.env.APNS_TEAM_ID = "TEAM";
    process.env.APNS_KEY_P8 = "-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----";
    svc._setApnsSender(send);
  });
  afterAll(() => svc._setApnsSender(null));
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.notification.update.mockResolvedValue({});
    mockPrisma.device.update.mockResolvedValue({});
  });

  it("sends to every active device with the route in the payload and marks the row sent", async () => {
    mockPrisma.device.findMany.mockResolvedValueOnce([device(), device({ id: "d2", token: "def", bundleId: "com.ollohealth.ollo.dev", apnsEnv: "sandbox" })]);
    send.mockResolvedValue({ ok: true, apnsId: "apns-1" });
    const r = await svc.deliver(row());
    expect(r).toEqual({ sent: 2, failed: 0 });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0]).toMatchObject({ env: "production", topic: "com.ollohealth.ollo", deviceToken: "abc" });
    expect(send.mock.calls[0][0].payload).toMatchObject({ aps: { alert: { title: "Ollie", body: "Your weekly update" } }, route: "ollie?threadId=t1", notificationId: "n1" });
    expect(mockPrisma.notification.update.mock.calls[0][0].data).toMatchObject({ status: "sent", apnsId: "apns-1" });
  });

  it("flips the environment once on BadDeviceToken and remembers it on the device", async () => {
    mockPrisma.device.findMany.mockResolvedValueOnce([device()]);
    send.mockResolvedValueOnce({ ok: false, status: 400, reason: "BadDeviceToken", wrongEnv: true, unregistered: false }).mockResolvedValueOnce({ ok: true, apnsId: "apns-2" });
    const r = await svc.deliver(row());
    expect(r.sent).toBe(1);
    expect(send.mock.calls[1][0].env).toBe("sandbox");
    expect(mockPrisma.device.update).toHaveBeenCalledWith({ where: { id: "d1" }, data: { apnsEnv: "sandbox" } });
  });

  it("disables a device whose token APNs reports as unregistered", async () => {
    mockPrisma.device.findMany.mockResolvedValueOnce([device()]);
    send.mockResolvedValueOnce({ ok: false, status: 410, reason: "Unregistered", wrongEnv: false, unregistered: true });
    const r = await svc.deliver(row());
    expect(r).toEqual({ sent: 0, failed: 1 });
    expect(mockPrisma.device.update.mock.calls[0][0].data.disabledAt).toBeInstanceOf(Date);
    expect(mockPrisma.notification.update.mock.calls[0][0].data.status).toBe("failed");
  });

  it("suppresses as no_device when the user has no active phone", async () => {
    mockPrisma.device.findMany.mockResolvedValueOnce([]);
    await svc.deliver(row());
    expect(send).not.toHaveBeenCalled();
    expect(mockPrisma.notification.update.mock.calls[0][0].data).toMatchObject({ status: "suppressed", suppressedReason: "no_device" });
  });
});

describe("devices", () => {
  beforeEach(() => jest.clearAllMocks());

  it("guesses sandbox for the Dev app and production otherwise", () => {
    expect(guessEnv("com.ollohealth.ollo.dev")).toBe("sandbox");
    expect(guessEnv("com.ollohealth.ollo")).toBe("production");
  });

  it("moves a known token to the registering user and revives it", async () => {
    mockPrisma.device.findUnique.mockResolvedValueOnce(device({ userId: "someone-else", apnsEnv: "sandbox", disabledAt: new Date() }));
    mockPrisma.device.update.mockImplementation(async ({ data }: any) => data);
    const d = await registerDevice("u1", { token: "ABC", bundleId: "com.ollohealth.ollo" });
    expect(mockPrisma.device.update.mock.calls[0][0].where).toEqual({ token: "abc" });
    expect(d).toMatchObject({ userId: "u1", disabledAt: null, apnsEnv: "sandbox" }); // a corrected env survives re-registration
  });
});
