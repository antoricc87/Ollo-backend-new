/**
 * BOOKING FOR PREVENTIVE SERVICES (P1b, Ollo/docs/preventive-plan-plan.md).
 *
 * Every provider network — a lab chain, an imaging group, a pharmacy — is
 * reached through one ADAPTER with the same five verbs: list its places,
 * say when a place is free, hold a time, confirm it, cancel it; and, once the
 * appointment has happened, hand back results. The app and the plan never
 * know which network they are talking to. Today the only adapter is
 * "simulated" (domain/simulated.ts): fictional places and generated times,
 * so the whole flow can be built and tested before a partner signs.
 */

export type ProviderKind = "lab" | "imaging" | "procedure" | "pharmacy";

/** One service a place offers, keyed by the plan item it fulfils. */
export type Offering = {
  key: string;
  minutes: number;
  /** Directional cash price range, USD. */
  priceUsd: [number, number];
  /** What to do before, in one line ("Fast for 8 hours"); null when nothing. */
  prep: string | null;
};

/** Weekly opening hours, local time: day → [open, close] ("07:00", "15:00"). */
export type Hours = Partial<Record<"sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat", [string, string]>>;

export type PlaceSpec = {
  providerExternalId: string;
  providerName: string;
  kind: ProviderKind;
  externalId: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string | null;
  timeZone: string;
  hours: Hours;
  offerings: Offering[];
  inNetwork: boolean;
};

export type Slot = { startsAt: string; endsAt: string };

/** A time that is already taken (a hold or a booking at that place). */
export type Taken = { startsAt: Date; endsAt: Date };

export type LabValue = { testType: string; result: string; units: string; referenceRange: string; isOutOfRange: boolean };

export interface BookingAdapter {
  readonly key: string;
  /** Every place this network has (stored as CareLocation rows on sync). */
  places(): PlaceSpec[];
  /** Free times at a place for a service that takes `minutes`, from `from` for `days` days. */
  availability(place: PlaceSpec, minutes: number, from: Date, days: number, taken: Taken[]): Slot[];
  /** The network's confirmation for a held time; its reference and a code to show. */
  confirm(place: PlaceSpec, startsAt: Date, itemKeys: string[]): Promise<{ externalRef: string; confirmationCode: string }>;
  cancel(externalRef: string): Promise<void>;
  /**
   * Results for a completed lab appointment, when the network has them; null
   * while pending. Only labs return values; imaging returns a report later
   * (not modelled yet).
   */
  results(externalRef: string, itemKeys: string[], completedAt: Date, now: Date): Promise<LabValue[] | null>;
}
