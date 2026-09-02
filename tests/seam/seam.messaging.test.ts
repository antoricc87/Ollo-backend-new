const mockPrisma = {
  clinician: { findUnique: jest.fn(), update: jest.fn(), upsert: jest.fn() },
  chat: { findMany: jest.fn(), findFirst: jest.fn(), upsert: jest.fn(), update: jest.fn() },
  message: { groupBy: jest.fn(), updateMany: jest.fn(), create: jest.fn() },
  userToken: { findFirst: jest.fn() },
  $transaction: jest.fn(),
};
jest.mock("../../src/utility/prismaClient", () => ({ __esModule: true, default: mockPrisma }));
jest.mock("../../src/utils/push_notifications", () => ({ sendSingleNotification: jest.fn().mockResolvedValue({ success: true }) }));
jest.mock("../../src/services/agent/context/snapshot", () => ({ buildPatientSnapshot: jest.fn() }));
jest.mock("../../src/services/patient/model/patient.model", () => ({ fetchCurrentLabs: jest.fn() }));
jest.mock("../../src/services/labs_journey/model/labsJourney.model", () => ({ __esModule: true, default: { getRisk: jest.fn() } }));
jest.mock("../../src/services/plan/model/plan.model", () => ({ __esModule: true, default: { getActivePlan: jest.fn() } }));
const { SeamMessagingService } = require("../../src/services/seam/model/seam.model");
const { sendSingleNotification } = require("../../src/utils/push_notifications");

describe("SeamMessagingService", () => {
  beforeEach(() => jest.clearAllMocks());

  it("lists threads only where the grant is active, with unread counts", async () => {
    mockPrisma.chat.findMany.mockResolvedValueOnce([{ id: "c1", patient: { id: "p1", firstName: "A", lastName: "B" }, messages: [{ content: "hi", senderType: "PATIENT", createdAt: new Date() }], updatedAt: new Date(), createdAt: new Date() }]);
    mockPrisma.message.groupBy.mockResolvedValueOnce([{ chatId: "c1", _count: { _all: 2 } }]);
    const rows = await SeamMessagingService.chatsOf("cl-1");
    expect(mockPrisma.chat.findMany.mock.calls[0][0].where).toEqual({ clinicianId: "cl-1", patient: { careTeam: { some: { clinicianId: "cl-1", revokedAt: null } } } });
    expect(rows[0]).toMatchObject({ id: "c1", unread: 2, lastMessage: { content: "hi" } });
  });

  it("reading a thread marks the patient's messages read; unknown/foreign thread → null", async () => {
    mockPrisma.chat.findFirst.mockResolvedValueOnce({ id: "c1", patient: {}, messages: [{ id: "m", senderType: "PATIENT", isRead: false }], createdAt: new Date(), updatedAt: new Date() });
    const c = await SeamMessagingService.chat("cl-1", "c1");
    expect(mockPrisma.message.updateMany).toHaveBeenCalledWith({ where: { chatId: "c1", senderType: "PATIENT", isRead: false }, data: { isRead: true } });
    expect(c.messages[0].isRead).toBe(true);
    mockPrisma.chat.findFirst.mockResolvedValueOnce(null);
    expect(await SeamMessagingService.chat("cl-1", "nope")).toBeNull();
  });

  it("sends as CLINICIAN and pushes to the patient", async () => {
    mockPrisma.chat.findFirst.mockResolvedValueOnce({ id: "c1", patientId: "p1", clinician: { lastName: "Rossi" } });
    mockPrisma.$transaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) => fn({ message: { create: jest.fn().mockResolvedValue({ id: "m1", senderType: "CLINICIAN" }) }, chat: { update: jest.fn() } }));
    mockPrisma.userToken.findFirst.mockResolvedValueOnce({ token: "fcm" });
    const m = await SeamMessagingService.send("cl-1", "c1", "Hello");
    expect(m).toMatchObject({ id: "m1" });
    expect(sendSingleNotification).toHaveBeenCalledWith(expect.objectContaining({ title: "Dr. Rossi replied", body: "Hello" }));
  });
});
