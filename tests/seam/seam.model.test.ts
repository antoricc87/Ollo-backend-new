const mockPrisma = { clinician: { findUnique: jest.fn(), update: jest.fn(), upsert: jest.fn() } };
jest.mock("../../src/utility/prismaClient", () => ({ __esModule: true, default: mockPrisma }));
const { default: SeamService, SeamConflictError } = require("../../src/services/seam/model/seam.model");

const body = { email: "a@b.c", firstName: "A", lastName: "B", specialty: "GP" };

describe("SeamService.upsertClinician", () => {
  beforeEach(() => jest.clearAllMocks());

  it("adopts an existing row with the same email and no externalId", async () => {
    mockPrisma.clinician.findUnique.mockResolvedValueOnce({ id: "row", externalId: null });
    mockPrisma.clinician.update.mockResolvedValueOnce({ id: "row" });
    await SeamService.upsertClinician("ext-1", body);
    expect(mockPrisma.clinician.update).toHaveBeenCalledWith({ where: { id: "row" }, data: expect.objectContaining({ externalId: "ext-1", specialty: "GP" }) });
    expect(mockPrisma.clinician.upsert).not.toHaveBeenCalled();
  });

  it("refuses an email owned by another external id", async () => {
    mockPrisma.clinician.findUnique.mockResolvedValueOnce({ id: "row", externalId: "ext-other" });
    await expect(SeamService.upsertClinician("ext-1", body)).rejects.toBeInstanceOf(SeamConflictError);
  });

  it("upserts by externalId otherwise, defaulting isActive on create", async () => {
    mockPrisma.clinician.findUnique.mockResolvedValueOnce(null);
    await SeamService.upsertClinician("ext-1", { ...body, isActive: false });
    expect(mockPrisma.clinician.upsert).toHaveBeenCalledWith({
      where: { externalId: "ext-1" },
      create: expect.objectContaining({ externalId: "ext-1", isActive: false }),
      update: expect.objectContaining({ isActive: false }),
    });
  });
});
