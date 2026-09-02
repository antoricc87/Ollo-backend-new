const mockPrisma = {
  clinician: { findUnique: jest.fn(), update: jest.fn(), upsert: jest.fn() },
  booking: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  timeSlot: { findFirst: jest.fn(), update: jest.fn() },
  userToken: { findFirst: jest.fn() },
  weeklyAvailability: { findMany: jest.fn(), deleteMany: jest.fn(), findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
  dailyAvailability: { deleteMany: jest.fn(), create: jest.fn() },
  $transaction: jest.fn(),
};
jest.mock("../../src/utility/prismaClient", () => ({ __esModule: true, default: mockPrisma }));
jest.mock("../../src/utils/push_notifications", () => ({ sendSingleNotification: jest.fn().mockResolvedValue({ success: true }) }));
jest.mock("../../src/services/agent/context/snapshot", () => ({ buildPatientSnapshot: jest.fn() }));
jest.mock("../../src/services/patient/model/patient.model", () => ({ fetchCurrentLabs: jest.fn() }));
jest.mock("../../src/services/labs_journey/model/labsJourney.model", () => ({ __esModule: true, default: { getRisk: jest.fn() } }));
jest.mock("../../src/services/plan/model/plan.model", () => ({ __esModule: true, default: { getActivePlan: jest.fn() } }));
const { SeamScheduleService, splitBookingDate } = require("../../src/services/seam/model/seam.model");
const { sendSingleNotification } = require("../../src/utils/push_notifications");

describe("splitBookingDate", () => {
  it("reads the app's booking date shape", () => {
    expect(splitBookingDate("09-04-2026T09:30:00.000+00:00")).toEqual({ date: "09-04-2026", time: "09:30" });
    expect(splitBookingDate("garbage")).toBeNull();
  });
});

describe("replaceAvailability", () => {
  it("keeps a booked slot even when the new rules drop it, and marks it booked", async () => {
    mockPrisma.booking.findMany.mockResolvedValueOnce([{ appointmentDate: "09-07-2026T10:00:00.000+00:00", durationMinutes: 30 }]);
    const tx = {
      weeklyAvailability: { findMany: jest.fn().mockResolvedValue([{ id: "legacy", weekStartDate: "09-05-2026", weekEndDate: "09-11-2026" }, { id: "past", weekStartDate: "08-24-2026", weekEndDate: "08-30-2026" }]), deleteMany: jest.fn(), findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: "w1" }), update: jest.fn() },
      dailyAvailability: { deleteMany: jest.fn(), create: jest.fn().mockResolvedValue({ id: "d1" }) },
      timeSlot: { createMany: jest.fn() },
    };
    mockPrisma.$transaction.mockImplementationOnce(async (fn: (t: unknown) => Promise<void>) => fn(tx));
    const r = await SeamScheduleService.replaceAvailability("cl-1", {
      from: "09-07-2026", to: "09-13-2026",
      weeks: [{ weekStartDate: "09-07-2026", weekEndDate: "09-13-2026", days: [{ date: "09-07-2026", slots: [{ startTime: "09:00", endTime: "09:30" }] }] }],
    });
    // the legacy Saturday-based week overlaps the horizon → replaced; the past week is left alone
    expect(tx.weeklyAvailability.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["legacy"] } } });
    const data = tx.timeSlot.createMany.mock.calls[0][0].data;
    expect(data.map((s: { startTime: string; isBooked: boolean; isAvailable: boolean }) => [s.startTime, s.isBooked, s.isAvailable])).toEqual([["09:00", false, true], ["10:00", true, false]]);
    expect(r).toMatchObject({ weeks: 1, slots: 2, bookedPreserved: 1 });
  });
});

describe("setBookingStatus", () => {
  beforeEach(() => jest.clearAllMocks());
  it("refuses another clinician's booking", async () => {
    mockPrisma.booking.findFirst.mockResolvedValueOnce(null);
    expect(await SeamScheduleService.setBookingStatus("cl-1", "b1", "CONFIRMED")).toBeNull();
  });
  it("confirms, books the slot and pushes to the patient", async () => {
    mockPrisma.booking.findFirst.mockResolvedValueOnce({ id: "b1", patientId: "p1", appointmentDate: "09-07-2026T10:00:00.000+00:00", clinician: { lastName: "Rossi" } });
    mockPrisma.booking.update.mockResolvedValueOnce({ id: "b1", status: "CONFIRMED" });
    mockPrisma.timeSlot.findFirst.mockResolvedValueOnce({ id: "s1" });
    mockPrisma.timeSlot.update.mockResolvedValueOnce({});
    mockPrisma.userToken.findFirst.mockResolvedValueOnce({ token: "fcm" });
    await SeamScheduleService.setBookingStatus("cl-1", "b1", "CONFIRMED");
    expect(mockPrisma.booking.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "CONFIRMED", confirmed: true }) }));
    expect(mockPrisma.timeSlot.update).toHaveBeenCalledWith({ where: { id: "s1" }, data: { isBooked: true, isAvailable: false } });
    expect(sendSingleNotification).toHaveBeenCalledWith(expect.objectContaining({ token: "fcm", title: "Appointment confirmed" }));
  });
});
