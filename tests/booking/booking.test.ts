import prisma from "../../src/utility/prismaClient";
import { slotsFrom } from "../../src/services/booking/domain/slots";
import { SIMULATED_PLACES, simulatedAdapter } from "../../src/services/booking/domain/simulated";
import { bookingLive, cancel, confirm, hold, minutesFor, placesFor, runBookingSweep, slotsAt, upcomingByItem } from "../../src/services/booking/booking.service";
import { loadPlan } from "../../src/services/preventive/model/preventive.model";

/**
 * Booking for preventive services (P1b): free times, hold → confirm, no double
 * booking, lapse, cancel, reminder, done, results back — against the local
 * database, on the simulated network. Nothing leaves the machine: the
 * reminder push and the signals' lab scan are mocked; no model is called.
 */
jest.mock("../../src/services/notifications/notifications.service", () => ({ queueNotification: jest.fn(async () => ({})) }));
jest.mock("../../src/services/signals/labs.service", () => ({ onLabReport: jest.fn() }));
jest.mock("../../src/services/agent/llm/openai.client", () => ({ getLLM: () => ({ json: async () => { throw new Error("no model in tests"); } }) }));
const { queueNotification } = jest.requireMock("../../src/services/notifications/notifications.service");
const { onLabReport } = jest.requireMock("../../src/services/signals/labs.service");

describe("free times (pure)", () => {
  const hours = { mon: ["09:00", "10:00"] as [string, string] };
  const monday = new Date("2026-11-23T05:00:00Z"); // Monday, local midnight in New York
  it("fills opening hours in steps, skips taken times and the next two hours", () => {
    const slots = slotsFrom({ hours, timeZone: "America/New_York", minutes: 15, from: monday, days: 1, taken: [{ startsAt: new Date("2026-11-23T14:15:00Z"), endsAt: new Date("2026-11-23T14:30:00Z") }], now: new Date("2026-11-20T12:00:00Z") });
    expect(slots.map((s) => s.startsAt)).toEqual(["2026-11-23T14:00:00.000Z", "2026-11-23T14:30:00.000Z", "2026-11-23T14:45:00.000Z"]);
  });
  it("a 45-minute service fits only where 45 minutes remain before closing", () => {
    expect(slotsFrom({ hours, timeZone: "America/New_York", minutes: 45, from: monday, days: 1, taken: [], now: new Date("2026-11-20T12:00:00Z") })).toHaveLength(1);
  });
  it("a blood draw is one sitting however many tests; an MRI adds up", () => {
    expect(minutesFor([{ key: "a", minutes: 15, priceUsd: [0, 0], prep: null }, { key: "b", minutes: 15, priceUsd: [0, 0], prep: null }])).toBe(15);
    expect(minutesFor([{ key: "a", minutes: 45, priceUsd: [0, 0], prep: null }, { key: "b", minutes: 20, priceUsd: [0, 0], prep: null }])).toBe(65);
  });
});

describe("the simulated network", () => {
  it("every place is marked as a test and none borrows a real name", () => {
    for (const p of SIMULATED_PLACES) {
      expect(p.name).toMatch(/\(test\)$/);
      expect(p.zip).toBe("00000");
    }
  });
  it("labs offer every lab item; pharmacies the vaccines; imaging the scans", () => {
    const lab = SIMULATED_PLACES.find((p) => p.kind === "lab")!;
    expect(lab.offerings.map((o) => o.key)).toEqual(expect.arrayContaining(["lipid_panel", "lipoprotein_a", "apob"]));
    expect(SIMULATED_PLACES.find((p) => p.kind === "pharmacy")!.offerings.map((o) => o.key)).toContain("flu");
    expect(SIMULATED_PLACES.find((p) => p.kind === "imaging")!.offerings.map((o) => o.key)).toEqual(expect.arrayContaining(["mammography", "cac", "fullbody_mri"]));
  });
  it("results only after two days", async () => {
    const done = new Date("2026-11-20T15:00:00Z");
    expect(await simulatedAdapter.results("x", ["lipid_panel"], done, new Date("2026-11-21T15:00:00Z"))).toBeNull();
    expect((await simulatedAdapter.results("x", ["lipid_panel"], done, new Date("2026-11-22T16:00:00Z")))?.map((v) => v.testType)).toContain("LDL cholesterol");
  });
});

describe("booking end to end (local database, simulated network)", () => {
  const env = { ...process.env };
  let patientId = "";
  let other = "";
  beforeAll(async () => {
    process.env.BOOKING_ADAPTER = "simulated";
    const mk = (n: string) => prisma.patient.create({ data: { email: `booking-${n}-${Date.now()}@ollo.local`, password: "x", gender: "male", dob: new Date("1987-05-10"), onBoardingComplete: true, timeZone: "America/New_York" } as any });
    patientId = (await mk("a")).id;
    other = (await mk("b")).id;
  });
  afterAll(async () => {
    process.env = env;
    for (const id of [patientId, other]) {
      await prisma.serviceBooking.deleteMany({ where: { patientId: id } });
      const s = await prisma.patientSummary.findUnique({ where: { patientId: id } });
      if (s) {
        const r = await prisma.labResultSummary.findMany({ where: { patientSummaryId: s.id }, select: { id: true } });
        await prisma.labResult.deleteMany({ where: { labResultSummaryId: { in: r.map((x) => x.id) } } });
        await prisma.labResultSummary.deleteMany({ where: { patientSummaryId: s.id } });
      }
      await prisma.patient.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  it("is off unless switched on, and off means no places", async () => {
    process.env.BOOKING_ADAPTER = "";
    expect(bookingLive()).toBe(false);
    expect(await placesFor(["lipid_panel"])).toEqual([]);
    process.env.BOOKING_ADAPTER = "simulated";
    expect(bookingLive()).toBe(true);
  });

  const LABS = ["lipid_panel", "lipoprotein_a", "hiv"];
  let bookingId = "";
  let startsAt = "";

  it("finds places offering every lab at once, with the earliest free time", async () => {
    const places = await placesFor(LABS);
    expect(places.length).toBe(2);
    expect(places.every((p) => p.kind === "lab" && p.simulated && p.nextFree)).toBe(true);
    expect(await placesFor(["lipid_panel", "mammography"])).toEqual([]); // no one place does both
  });

  it("holds a time, which another person then cannot take; confirms it", async () => {
    const place = (await placesFor(LABS))[0];
    startsAt = place.nextFree!.startsAt;
    const h = await hold(patientId, { locationId: place.id, keys: LABS, type: "lab", startsAt });
    expect("booking" in h && h.booking.status).toBe("held");
    bookingId = (h as any).booking.id;
    expect(await hold(other, { locationId: place.id, keys: LABS, type: "lab", startsAt })).toEqual({ error: "taken" });
    expect((await slotsAt(place.id, LABS))!.map((s) => s.startsAt)).not.toContain(startsAt);
    const c = await confirm(patientId, bookingId);
    expect("booking" in c && c.booking).toMatchObject({ status: "confirmed" });
    expect((c as any).booking.confirmationCode).toBeTruthy();
  });

  it("the plan shows the booking on each lab it covers", async () => {
    const by = await upcomingByItem(patientId);
    expect(Object.keys(by)).toEqual(expect.arrayContaining(LABS));
    const plan = await loadPlan(patientId, { words: false });
    const lipid = plan!.groups.find((g) => g.type === "lab")!.items.find((i: any) => i.key === "lipid_panel");
    expect(lipid.booking).toMatchObject({ id: bookingId, startsAt });
  });

  it("a hold that lapses cannot be confirmed", async () => {
    const place = (await placesFor(["flu"]))[0];
    const h: any = await hold(patientId, { locationId: place.id, keys: ["flu"], type: "vaccine", startsAt: place.nextFree!.startsAt });
    const later = new Date(Date.now() + 11 * 60_000);
    expect(await confirm(patientId, h.booking.id, later)).toEqual({ error: "expired" });
  });

  it("someone else's booking cannot be touched", async () => {
    expect(await cancel(other, bookingId)).toEqual({ error: "not_found" });
  });

  it("the sweep reminds the day before, marks it done after, and brings results back only when allowed", async () => {
    const b = await prisma.serviceBooking.findUniqueOrThrow({ where: { id: bookingId } });
    const dayBefore = new Date(b.startsAt.getTime() - 20 * 3_600_000);
    expect((await runBookingSweep(dayBefore)).reminded).toBeGreaterThanOrEqual(1);
    expect(queueNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: patientId, kind: "booking_reminder", dedupeKey: `booking_reminder:${bookingId}` }));

    const after = new Date(b.endsAt.getTime() + 60_000);
    await runBookingSweep(after);
    expect((await prisma.serviceBooking.findUniqueOrThrow({ where: { id: bookingId } })).status).toBe("completed");

    const threeDays = new Date(b.endsAt.getTime() + 3 * 86_400_000);
    delete process.env.BOOKING_SIMULATED_RESULTS;
    await runBookingSweep(threeDays);
    expect((await prisma.serviceBooking.findUniqueOrThrow({ where: { id: bookingId } })).resultReportId).toBeNull();

    process.env.BOOKING_SIMULATED_RESULTS = "1";
    await runBookingSweep(threeDays);
    const done = await prisma.serviceBooking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(done.resultReportId).toBeTruthy();
    expect(onLabReport).toHaveBeenCalledWith(patientId, done.resultReportId);
  });

  it("with results back, the cholesterol panel moves to Up to date", async () => {
    const plan = await loadPlan(patientId, { words: false });
    expect(plan!.upToDate.map((i: any) => i.key)).toContain("lipid_panel");
  });
});
