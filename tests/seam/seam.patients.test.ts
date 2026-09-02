const mockPrisma = {
  clinician: { findUnique: jest.fn(), update: jest.fn(), upsert: jest.fn() },
  careTeamMember: { findMany: jest.fn() },
  agentAuditLog: { findFirst: jest.fn() },
  weightEntry: { findMany: jest.fn() }, bFPEntry: { findMany: jest.fn() }, bloodPressureEntry: { findMany: jest.fn() },
  glucoseEntry: { findMany: jest.fn() }, dailyCalories: { findMany: jest.fn() }, dailyExercise: { findMany: jest.fn() },
};
jest.mock("../../src/utility/prismaClient", () => ({ __esModule: true, default: mockPrisma }));
jest.mock("../../src/services/agent/context/snapshot", () => ({ buildPatientSnapshot: jest.fn() }));
jest.mock("../../src/services/patient/model/patient.model", () => ({ fetchCurrentLabs: jest.fn() }));
jest.mock("../../src/services/labs_journey/model/labsJourney.model", () => ({ __esModule: true, default: { getRisk: jest.fn() } }));
jest.mock("../../src/services/plan/model/plan.model", () => ({ __esModule: true, default: { getActivePlan: jest.fn() } }));
const { SeamPatientService } = require("../../src/services/seam/model/seam.model");
const { buildPatientSnapshot } = require("../../src/services/agent/context/snapshot");

describe("SeamPatientService", () => {
  beforeEach(() => jest.clearAllMocks());

  it("lists only active grants with the grant source and last Ollie activity", async () => {
    mockPrisma.careTeamMember.findMany.mockResolvedValueOnce([
      { patientId: "p1", source: "BOOKING", addedAt: new Date("2026-09-01"), patient: { id: "p1", firstName: "A", lastName: "B", dob: null, gender: "f", email: "a@b.c" } },
    ]);
    mockPrisma.agentAuditLog.findFirst.mockResolvedValueOnce({ createdAt: new Date("2026-09-02") });
    const rows = await SeamPatientService.patientsOf("cl-1");
    expect(mockPrisma.careTeamMember.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { clinicianId: "cl-1", revokedAt: null } }));
    expect(rows[0]).toMatchObject({ id: "p1", grant: { source: "BOOKING" }, lastActivityAt: new Date("2026-09-02") });
  });

  it("strips the patient's private context from the snapshot", async () => {
    buildPatientSnapshot.mockResolvedValueOnce({ patientId: "p1", profile: {}, memories: [{ id: "m" }], subAccounts: [{ id: "s" }], client: { x: 1 }, mealPlan: { id: "mp" }, labs: {} });
    const s = await SeamPatientService.snapshot("p1");
    expect(s).toEqual({ patientId: "p1", profile: {}, labs: {} });
  });

  it("returns tracker series inside the window, ascending, as ISO", async () => {
    const day = 24 * 3600 * 1000;
    const recent = new Date(Date.now() - 2 * day).toISOString();
    const old = new Date(Date.now() - 400 * day).toISOString();
    mockPrisma.weightEntry.findMany.mockResolvedValueOnce([{ createdAt: recent, weight: 80, unit: "kg" }, { createdAt: old, weight: 90, unit: "kg" }]);
    mockPrisma.bFPEntry.findMany.mockResolvedValueOnce([]);
    mockPrisma.bloodPressureEntry.findMany.mockResolvedValueOnce([{ createdAt: recent, systolic: 120, diastolic: 80, pulse: null }]);
    mockPrisma.glucoseEntry.findMany.mockResolvedValueOnce([{ createdAt: "not a date", value: 1 }]);
    mockPrisma.dailyCalories.findMany.mockResolvedValueOnce([]);
    mockPrisma.dailyExercise.findMany.mockResolvedValueOnce([]);
    const t = await SeamPatientService.trackers("p1", 90);
    expect(t.weight).toEqual([{ at: recent, value: 80, unit: "kg" }]);
    expect(t.bloodPressure[0]).toMatchObject({ systolic: 120 });
    expect(t.glucose).toEqual([]);
  });
});
