import prisma from "../../utility/prismaClient";
import { queueNotification } from "../notifications/notifications.service";
import { onLabReport } from "../signals/labs.service";
import { simulatedAdapter } from "./domain/simulated";
import { BookingAdapter, Hours, LabValue, Offering, PlaceSpec, ProviderKind, Slot } from "./domain/types";

/**
 * BOOKING (P1b) — places, free times, hold → confirm → reminder → done, and
 * results back into the record. Every call goes through the adapter of the
 * place's network; today only "simulated" exists and it is OFF unless
 * BOOKING_ADAPTER=simulated (so production shows no fictional places).
 */

const ADAPTERS: Record<string, BookingAdapter> = { simulated: simulatedAdapter };

export const bookingLive = () => process.env.BOOKING_ADAPTER === "simulated";
const adapters = (): BookingAdapter[] => (bookingLive() ? [simulatedAdapter] : []);
/** Simulated lab values reach a person's record only with this switch (local and test accounts). */
const simulatedResultsAllowed = () => process.env.BOOKING_SIMULATED_RESULTS === "1";

export const HOLD_MINUTES = 10;
export const REMINDER_HOURS = 24;

const toSpec = (l: any): PlaceSpec => ({
  providerExternalId: l.provider?.externalId ?? "",
  providerName: l.provider?.name ?? "",
  kind: (l.provider?.kind ?? "lab") as ProviderKind,
  externalId: l.externalId,
  name: l.name,
  address: l.address,
  city: l.city,
  state: l.state,
  zip: l.zip,
  phone: l.phone,
  timeZone: l.timeZone,
  hours: l.hours as Hours,
  offerings: l.offerings as Offering[],
  inNetwork: l.inNetwork,
});

/** Store every place the live adapters know (idempotent). */
export const syncPlaces = async () => {
  for (const a of adapters()) {
    for (const p of a.places()) {
      const provider = await prisma.careProvider.upsert({
        where: { adapter_externalId: { adapter: a.key, externalId: p.providerExternalId } },
        create: { adapter: a.key, externalId: p.providerExternalId, name: p.providerName, kind: p.kind },
        update: { name: p.providerName, kind: p.kind },
      });
      const data = { name: p.name, address: p.address, city: p.city, state: p.state, zip: p.zip, phone: p.phone, timeZone: p.timeZone, offerings: p.offerings as any, hours: p.hours as any, inNetwork: p.inNetwork };
      await prisma.careLocation.upsert({
        where: { providerId_externalId: { providerId: provider.id, externalId: p.externalId } },
        create: { providerId: provider.id, externalId: p.externalId, ...data },
        update: data,
      });
    }
  }
};

/** A blood draw (or a round of shots) is one sitting however many tests; anything else adds up. */
export const minutesFor = (offers: Offering[]) => (offers.every((o) => o.minutes <= 15) ? 15 : offers.reduce((n, o) => n + o.minutes, 0));

const offersAll = (l: any, keys: string[]) => {
  const offers = (l.offerings as Offering[]).filter((o) => keys.includes(o.key));
  return offers.length === keys.length ? offers : null;
};

const takenAt = async (locationId: string, now: Date) =>
  (
    await prisma.serviceBooking.findMany({
      where: { locationId, OR: [{ status: "confirmed" }, { status: "held", holdExpiresAt: { gt: now } }] },
      select: { startsAt: true, endsAt: true },
    })
  ).map((b) => ({ startsAt: b.startsAt, endsAt: b.endsAt }));

const adapterOf = (l: any) => ADAPTERS[l.provider?.adapter ?? ""] ?? null;

export type PlaceOption = {
  id: string;
  name: string;
  address: string;
  kind: string;
  inNetwork: boolean;
  simulated: boolean;
  minutes: number;
  priceUsd: [number, number];
  prep: string[];
  nextFree: Slot | null;
};

/** Places that offer EVERY one of `keys`, nearest free time first. */
export const placesFor = async (keys: string[], now = new Date()): Promise<PlaceOption[]> => {
  if (!bookingLive() || !keys.length) return [];
  await syncPlaces();
  const rows = await prisma.careLocation.findMany({ include: { provider: true } });
  const out: PlaceOption[] = [];
  for (const l of rows) {
    const a = adapterOf(l);
    const offers = a ? offersAll(l, keys) : null;
    if (!a || !offers) continue;
    const minutes = minutesFor(offers);
    const free = a.availability(toSpec(l), minutes, now, 14, await takenAt(l.id, now));
    out.push({
      id: l.id,
      name: l.name,
      address: `${l.address}, ${l.city}`,
      kind: l.provider.kind,
      inNetwork: l.inNetwork,
      simulated: l.provider.adapter === "simulated",
      minutes,
      priceUsd: [offers.reduce((n, o) => n + o.priceUsd[0], 0), offers.reduce((n, o) => n + o.priceUsd[1], 0)],
      prep: [...new Set(offers.map((o) => o.prep).filter((p): p is string => !!p))],
      nextFree: free[0] ?? null,
    });
  }
  return out.sort((a, b) => (a.nextFree?.startsAt ?? "9").localeCompare(b.nextFree?.startsAt ?? "9"));
};

/** Free times at one place for these services. */
export const slotsAt = async (locationId: string, keys: string[], from = new Date(), days = 14, now = new Date()): Promise<Slot[] | null> => {
  const l = await prisma.careLocation.findUnique({ where: { id: locationId }, include: { provider: true } });
  const a = l ? adapterOf(l) : null;
  const offers = l && a ? offersAll(l, keys) : null;
  if (!l || !a || !offers) return null;
  return a.availability(toSpec(l), minutesFor(offers), from, days, await takenAt(l.id, now));
};

export type BookingError = "not_found" | "not_offered" | "taken" | "expired" | "not_live";

/** Hold a time while they confirm (HOLD_MINUTES). Their earlier holds for the same items are released. */
export const hold = async (patientId: string, input: { locationId: string; keys: string[]; type: string; startsAt: string }, now = new Date()) => {
  if (!bookingLive()) return { error: "not_live" as BookingError };
  const slots = await slotsAt(input.locationId, input.keys, new Date(input.startsAt), 1, now);
  if (!slots) return { error: "not_offered" as BookingError };
  const slot = slots.find((s) => s.startsAt === new Date(input.startsAt).toISOString());
  if (!slot) return { error: "taken" as BookingError };
  await prisma.serviceBooking.updateMany({ where: { patientId, status: "held", itemKeys: { hasSome: input.keys } }, data: { status: "expired" } });
  const booking = await prisma.serviceBooking.create({
    data: { patientId, locationId: input.locationId, itemKeys: input.keys, type: input.type, startsAt: new Date(slot.startsAt), endsAt: new Date(slot.endsAt), status: "held", holdExpiresAt: new Date(now.getTime() + HOLD_MINUTES * 60_000) },
  });
  return { booking };
};

/** Confirm a held time with the network; the prep lines are kept on the booking. */
export const confirm = async (patientId: string, id: string, now = new Date()) => {
  const b = await prisma.serviceBooking.findFirst({ where: { id, patientId }, include: { location: { include: { provider: true } } } });
  if (!b) return { error: "not_found" as BookingError };
  if (b.status !== "held" || !b.holdExpiresAt || b.holdExpiresAt <= now) {
    if (b.status === "held") await prisma.serviceBooking.update({ where: { id }, data: { status: "expired" } });
    return { error: "expired" as BookingError };
  }
  const a = adapterOf(b.location);
  if (!a) return { error: "not_live" as BookingError };
  const offers = offersAll(b.location, b.itemKeys) ?? [];
  const { externalRef, confirmationCode } = await a.confirm(toSpec(b.location), b.startsAt, b.itemKeys);
  const booking = await prisma.serviceBooking.update({
    where: { id },
    data: { status: "confirmed", holdExpiresAt: null, externalRef, confirmationCode, prep: [...new Set(offers.map((o) => o.prep).filter(Boolean))].join(" · ") || null },
  });
  return { booking };
};

export const cancel = async (patientId: string, id: string, now = new Date()) => {
  const b = await prisma.serviceBooking.findFirst({ where: { id, patientId }, include: { location: { include: { provider: true } } } });
  if (!b) return { error: "not_found" as BookingError };
  if (b.status !== "held" && b.status !== "confirmed") return { error: "expired" as BookingError };
  if (b.externalRef) await adapterOf(b.location)?.cancel(b.externalRef);
  return { booking: await prisma.serviceBooking.update({ where: { id }, data: { status: "cancelled", cancelledAt: now } }) };
};

export const listBookings = (patientId: string) =>
  prisma.serviceBooking.findMany({
    where: { patientId, status: { in: ["confirmed", "completed", "held"] } },
    orderBy: { startsAt: "desc" },
    take: 50,
    include: { location: { select: { name: true, address: true, city: true, provider: { select: { adapter: true } } } } },
  });

/** The next confirmed booking for each plan item (the plan shows "Booked · Tue 25 Nov"). */
export const upcomingByItem = async (patientId: string, now = new Date()) => {
  const rows = await prisma.serviceBooking.findMany({
    where: { patientId, status: "confirmed", startsAt: { gt: now } },
    orderBy: { startsAt: "asc" },
    include: { location: { select: { name: true } } },
  });
  const out: Record<string, { id: string; startsAt: string; place: string }> = {};
  for (const r of rows) for (const k of r.itemKeys) out[k] ??= { id: r.id, startsAt: r.startsAt.toISOString(), place: r.location.name };
  return out;
};

/* ---------------------------------- Sweep ---------------------------------- */

/** Results into the record as a lab report — the same path an upload takes, so the plan and the signals see them. */
const saveResults = async (patientId: string, values: LabValue[], collectedAt: Date, source: string) => {
  const summary = (await prisma.patientSummary.findUnique({ where: { patientId } })) ?? (await prisma.patientSummary.create({ data: { patientId, immunizations: [] } as any }));
  const report = await prisma.labResultSummary.create({
    data: {
      patientSummaryId: summary.id,
      labReport: `Results from ${source}`,
      recommendations: [],
      collectedAt,
      labResults: { create: values.map((v) => ({ category: "Others", testType: v.testType, result: v.result, units: v.units || null, referenceRange: v.referenceRange, isOutOfRange: v.isOutOfRange, aboutTestType: "" })) },
    },
  });
  onLabReport(patientId, report.id);
  return report.id;
};

/**
 * Hourly (agent tick): lapse holds, send tomorrow's reminders, mark past
 * appointments done, bring lab results back.
 */
export const runBookingSweep = async (now = new Date(), opts: { patientIds?: string[] } = {}) => {
  const out = { expired: 0, reminded: 0, completed: 0, results: 0 };
  // Tests pass a made-up `now` and their own accounts: never touch anyone else's bookings.
  const who = opts.patientIds ? { patientId: { in: opts.patientIds } } : {};
  out.expired = (await prisma.serviceBooking.updateMany({ where: { ...who, status: "held", holdExpiresAt: { lte: now } }, data: { status: "expired" } })).count;

  const soon = await prisma.serviceBooking.findMany({
    where: { ...who, status: "confirmed", reminderSentAt: null, startsAt: { gt: now, lte: new Date(now.getTime() + REMINDER_HOURS * 3_600_000) } },
    include: { location: { select: { name: true, timeZone: true } } },
  });
  for (const b of soon) {
    const at = b.startsAt.toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: b.location.timeZone });
    await queueNotification({
      userId: b.patientId,
      kind: "booking_reminder",
      title: "Tomorrow's appointment",
      body: `${b.location.name}, ${at}.${b.prep ? ` ${b.prep}.` : ""}`,
      route: "plan/preventive",
      dedupeKey: `booking_reminder:${b.id}`,
    }).catch((e) => console.error("booking reminder", e));
    await prisma.serviceBooking.update({ where: { id: b.id }, data: { reminderSentAt: now } });
    out.reminded++;
  }

  // Done: the appointment's end has passed. Each item it covered is recorded as done that day
  // (the plan's "last done" → "next due"); a lab's results come back separately below.
  const finished = await prisma.serviceBooking.findMany({ where: { ...who, status: "confirmed", endsAt: { lte: now } }, select: { id: true, patientId: true, itemKeys: true, startsAt: true } });
  for (const b of finished) {
    await prisma.serviceBooking.update({ where: { id: b.id }, data: { status: "completed", completedAt: now } });
    await prisma.preventiveDone.createMany({ data: b.itemKeys.map((k) => ({ patientId: b.patientId, itemKey: k, doneOn: b.startsAt, source: "booking", bookingId: b.id })) });
  }
  out.completed = finished.length;

  const waiting = await prisma.serviceBooking.findMany({
    where: { ...who, status: "completed", type: "lab", resultReportId: null, externalRef: { not: null } },
    include: { location: { include: { provider: true } } },
  });
  for (const b of waiting) {
    const a = adapterOf(b.location);
    if (!a) continue;
    if (a.key === "simulated" && !simulatedResultsAllowed()) continue;
    const values = await a.results(b.externalRef!, b.itemKeys, b.completedAt ?? b.endsAt, now);
    if (!values?.length) continue;
    const reportId = await saveResults(b.patientId, values, b.startsAt, b.location.name);
    await prisma.serviceBooking.update({ where: { id: b.id }, data: { resultReportId: reportId } });
    out.results++;
  }
  return out;
};
