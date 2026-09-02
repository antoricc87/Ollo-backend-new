const mockPrisma = {
  clinician: { findUnique: jest.fn() },
  careTeamMember: { findFirst: jest.fn() },
  seamAccessLog: { create: jest.fn().mockResolvedValue({}) },
};
jest.mock("../../src/utility/prismaClient", () => ({ __esModule: true, default: mockPrisma }));
// required after the mock so the factory sees an initialised mockPrisma
const { logSeamAccess, requireClinician, requireGrant, requireSeamKey } = require("../../src/services/seam/seam.auth");

const KEY = "k".repeat(40);
const mockRes = () => {
  const res: any = { statusCode: 200, listeners: {} as Record<string, () => void> };
  res.status = jest.fn((c: number) => ((res.statusCode = c), res));
  res.json = jest.fn(() => res);
  res.on = jest.fn((ev: string, cb: () => void) => (res.listeners[ev] = cb));
  return res;
};
const req = (over: any = {}): any => ({ headers: {}, params: {}, method: "GET", originalUrl: "/api/seam/x?y=1", ...over });

describe("requireSeamKey", () => {
  afterEach(() => { delete process.env.SEAM_SERVICE_KEY; delete process.env.SEAM_SERVICE_KEYS; });

  it("503s when no key is configured (fail closed)", () => {
    const res = mockRes(); const next = jest.fn();
    requireSeamKey(req({ headers: { authorization: `Bearer ${KEY}` } }), res, next);
    expect(res.statusCode).toBe(503); expect(next).not.toHaveBeenCalled();
  });
  it("401s without / with a wrong bearer", () => {
    process.env.SEAM_SERVICE_KEY = KEY;
    for (const headers of [{}, { authorization: "Bearer nope" }, { authorization: KEY }]) {
      const res = mockRes(); const next = jest.fn();
      requireSeamKey(req({ headers }), res, next);
      expect(res.statusCode).toBe(401); expect(next).not.toHaveBeenCalled();
    }
  });
  it("passes with the key, and with any key in the rotation list", () => {
    process.env.SEAM_SERVICE_KEYS = `${"a".repeat(40)}, ${KEY}`;
    const next = jest.fn();
    requireSeamKey(req({ headers: { authorization: `Bearer ${KEY}` } }), mockRes(), next);
    expect(next).toHaveBeenCalled();
  });
});

describe("requireClinician / requireGrant", () => {
  beforeEach(() => jest.clearAllMocks());

  it("401s without the header, 403s for unknown or inactive clinicians", async () => {
    let res = mockRes(); await requireClinician(req(), res, jest.fn()); expect(res.statusCode).toBe(401);
    mockPrisma.clinician.findUnique.mockResolvedValueOnce(null);
    res = mockRes(); await requireClinician(req({ headers: { "x-clinician-external-id": "c1" } }), res, jest.fn());
    expect(res.statusCode).toBe(403);
    mockPrisma.clinician.findUnique.mockResolvedValueOnce({ id: "x", externalId: "c1", firstName: "A", lastName: "B", isActive: false });
    res = mockRes(); await requireClinician(req({ headers: { "x-clinician-external-id": "c1" } }), res, jest.fn());
    expect(res.statusCode).toBe(403);
  });

  it("attaches the clinician, then requireGrant checks an active CareTeamMember", async () => {
    mockPrisma.clinician.findUnique.mockResolvedValueOnce({ id: "cl-1", externalId: "c1", firstName: "A", lastName: "B", isActive: true });
    const r = req({ headers: { "x-clinician-external-id": "c1" }, params: { id: "pt-1" } });
    const next = jest.fn();
    await requireClinician(r, mockRes(), next);
    expect(next).toHaveBeenCalled(); expect(r.seam.clinician.id).toBe("cl-1");

    mockPrisma.careTeamMember.findFirst.mockResolvedValueOnce(null);
    let res = mockRes(); await requireGrant()(r, res, jest.fn()); expect(res.statusCode).toBe(403);
    expect(mockPrisma.careTeamMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { patientId: "pt-1", clinicianId: "cl-1", revokedAt: null } })
    );

    mockPrisma.careTeamMember.findFirst.mockResolvedValueOnce({ id: "g" });
    const next2 = jest.fn(); await requireGrant()(r, mockRes(), next2);
    expect(next2).toHaveBeenCalled(); expect(r.seam.patientId).toBe("pt-1");
  });

  it("logSeamAccess writes a row on finish with clinician, patient, resource and status", () => {
    const r = req({ seam: { clinician: { id: "cl-1", externalId: "c1" }, patientId: "pt-1" } });
    const res = mockRes(); const next = jest.fn();
    logSeamAccess("labs.current")(r, res, next);
    expect(next).toHaveBeenCalled();
    res.statusCode = 200; res.listeners.finish();
    expect(mockPrisma.seamAccessLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ clinicianExternalId: "c1", clinicianId: "cl-1", patientId: "pt-1", path: "/api/seam/x", resource: "labs.current", status: 200 }),
    });
  });
});
