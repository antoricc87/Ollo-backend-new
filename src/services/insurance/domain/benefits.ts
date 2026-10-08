/**
 * PLAN BENEFITS — what a member's Summary of Benefits and Coverage (SBC) says,
 * and the arithmetic of an out-of-pocket ESTIMATE from it. Pure: no LLM, no
 * Prisma, no I/O. The model copies cells off the document (extract/); every
 * number a person is told comes out of this file so it can be unit-tested.
 *
 * What this can and cannot know. The SBC is the plan's own federally
 * standardised summary: deductible, out-of-pocket limit and what the member
 * pays per kind of service, in and out of network. It does NOT say what a
 * provider charges, whether a provider is in network, how much of the
 * deductible is already met, or how a visit will be coded. So an estimate is
 * exact only for flat copays; everything else is a range that needs a price,
 * and says which inputs it stood on.
 */
import { z } from "zod";

/* -------------------------------- services -------------------------------- */

/** The rows of the SBC's "Common Medical Event" table, in the form's order. */
export const SERVICES = [
  { key: "primary_care_visit", label: "Primary care visit" },
  { key: "specialist_visit", label: "Specialist visit" },
  { key: "preventive_care", label: "Preventive care, screening, immunization" },
  { key: "diagnostic_test", label: "Diagnostic test (x-ray, blood work)" },
  { key: "imaging", label: "Imaging (CT/PET scan, MRI)" },
  { key: "generic_drugs", label: "Generic drugs" },
  { key: "preferred_brand_drugs", label: "Preferred brand drugs" },
  { key: "non_preferred_brand_drugs", label: "Non-preferred brand drugs" },
  { key: "specialty_drugs", label: "Specialty drugs" },
  { key: "outpatient_surgery_facility", label: "Outpatient surgery, facility fee" },
  { key: "outpatient_surgery_physician", label: "Outpatient surgery, physician fees" },
  { key: "emergency_room", label: "Emergency room care" },
  { key: "emergency_transport", label: "Emergency medical transportation" },
  { key: "urgent_care", label: "Urgent care" },
  { key: "hospital_facility", label: "Hospital stay, facility fee" },
  { key: "hospital_physician", label: "Hospital stay, physician fees" },
  { key: "mental_health_outpatient", label: "Mental health, outpatient" },
  { key: "mental_health_inpatient", label: "Mental health, inpatient" },
  { key: "pregnancy_office_visits", label: "Pregnancy office visits" },
  { key: "childbirth_professional", label: "Childbirth, professional services" },
  { key: "childbirth_facility", label: "Childbirth, facility services" },
  { key: "home_health_care", label: "Home health care" },
  { key: "rehabilitation", label: "Rehabilitation services" },
  { key: "habilitation", label: "Habilitation services" },
  { key: "skilled_nursing", label: "Skilled nursing care" },
  { key: "durable_medical_equipment", label: "Durable medical equipment" },
  { key: "hospice", label: "Hospice services" },
  { key: "child_eye_exam", label: "Children's eye exam" },
  { key: "child_glasses", label: "Children's glasses" },
  { key: "child_dental_checkup", label: "Children's dental check-up" },
] as const;

export type ServiceKey = (typeof SERVICES)[number]["key"];
export const SERVICE_KEYS = SERVICES.map((s) => s.key) as [ServiceKey, ...ServiceKey[]];
export const serviceLabel = (key: string): string => SERVICES.find((s) => s.key === key)?.label ?? key;

/* --------------------------------- schema --------------------------------- */

/**
 * One cell of the table. `quote` is the cell as printed; the numbers must be
 * readable in it (see `review`). Every field is required-but-nullable because
 * the extraction runs under a strict schema.
 */
export const CostShareSchema = z.object({
  kind: z.enum(["no_charge", "copay", "coinsurance", "copay_and_coinsurance", "not_covered", "other"]),
  copayUsd: z.number().nullable(),
  coinsurancePct: z.number().nullable(),
  /** true = the member pays the deductible first; false = "deductible does not apply"; null = the cell does not say. */
  deductibleApplies: z.boolean().nullable(),
  quote: z.string(),
});
export type CostShare = z.infer<typeof CostShareSchema>;

const Tier = z.object({ individualUsd: z.number().nullable(), familyUsd: z.number().nullable() });
const Limit = z.object({ inNetwork: Tier, outOfNetwork: Tier, quote: z.string() });

export const BenefitsSchema = z.object({
  /** false when the document is not a plan benefits summary — nothing else is then trusted. */
  isBenefitsSummary: z.boolean(),
  planName: z.string().nullable(),
  issuer: z.string().nullable(),
  planType: z.enum(["HMO", "PPO", "EPO", "POS", "HDHP", "OTHER"]).nullable(),
  coverageFor: z.enum(["individual", "family", "individual_and_family"]).nullable(),
  periodStart: z.string().nullable(), // YYYY-MM-DD
  periodEnd: z.string().nullable(),
  deductible: Limit,
  outOfPocketMax: Limit,
  referralRequired: z.boolean().nullable(),
  outOfNetworkCovered: z.boolean().nullable(),
  services: z.array(
    z.object({
      service: z.enum(SERVICE_KEYS),
      inNetwork: CostShareSchema,
      outOfNetwork: CostShareSchema,
      limits: z.string().nullable(),
    })
  ),
});
export type Benefits = z.infer<typeof BenefitsSchema>;

/** What is stored: the extraction plus what the code made of it. */
export type StoredBenefits = Benefits & {
  /** Cells whose numbers could not be read back from the document. Shown as "check this" and never used for dollars. */
  review: { where: string; why: string }[];
  source: { engine: "text" | "scan"; pages: number; model: string };
};

/* ------------------------------ verification ------------------------------ */

const norm = (s: string) => s.toLowerCase().replace(/[\s ]+/g, " ").replace(/[,]/g, "").trim();
const numbersIn = (s: string) => (norm(s).match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
const has = (quote: string, n: number | null) => n === null || numbersIn(quote).includes(n);

/**
 * Drop the numbers a cell's kind has no use for. Under a strict schema the
 * model fills an absent amount with 0 as often as with null ("40% coinsurance"
 * comes back with copayUsd 0), and a 0 that is printed nowhere would fail the
 * read-back below for a cell that was copied correctly.
 */
export const normalizeBenefits = (b: Benefits): Benefits => {
  const cell = (c: CostShare): CostShare => {
    const copay = c.kind === "copay" || c.kind === "copay_and_coinsurance";
    const pct = c.kind === "coinsurance" || c.kind === "copay_and_coinsurance";
    return { ...c, copayUsd: copay ? c.copayUsd : null, coinsurancePct: pct ? c.coinsurancePct : null };
  };
  return { ...b, services: b.services.map((s) => ({ ...s, inNetwork: cell(s.inNetwork), outOfNetwork: cell(s.outOfNetwork), limits: s.limits?.trim() || null })) };
};

/**
 * Check every number against the text it was copied from, and every quote
 * against the document when the document has a text layer. Same idea as the
 * lab pipeline's source-row check: the model may misplace a value, so a value
 * is only used once it can be read back where the model says it is.
 */
export const reviewBenefits = (b: Benefits, sourceText: string | null): StoredBenefits["review"] => {
  const out: StoredBenefits["review"] = [];
  const doc = sourceText ? norm(sourceText).replace(/ \| /g, " ") : null;
  const inDoc = (quote: string) => {
    if (!doc) return true;
    const q = norm(quote).replace(/ \| /g, " ");
    if (!q) return false;
    // Cells wrap across rows in the layout text, so match on the numbers and the first words rather than the whole string.
    return doc.includes(q) || (numbersIn(q).every((n) => doc.includes(String(n))) && q.split(" ").slice(0, 2).every((w) => doc.includes(w)));
  };
  const limit = (name: string, l: Benefits["deductible"]) => {
    const nums = [l.inNetwork.individualUsd, l.inNetwork.familyUsd, l.outOfNetwork.individualUsd, l.outOfNetwork.familyUsd];
    if (nums.every((n) => n === null)) return;
    if (!nums.every((n) => has(l.quote, n))) out.push({ where: name, why: "an amount is not in the quoted text" });
    else if (!inDoc(l.quote)) out.push({ where: name, why: "the quoted text was not found in the document" });
  };
  limit("deductible", b.deductible);
  limit("outOfPocketMax", b.outOfPocketMax);
  for (const s of b.services)
    for (const side of ["inNetwork", "outOfNetwork"] as const) {
      const c = s[side];
      const where = `${s.service}.${side}`;
      if (!has(c.quote, c.copayUsd) || !has(c.quote, c.coinsurancePct)) out.push({ where, why: "an amount is not in the quoted text" });
      else if ((c.kind === "copay" || c.kind === "copay_and_coinsurance") && c.copayUsd === null) out.push({ where, why: "a copay with no amount" });
      else if ((c.kind === "coinsurance" || c.kind === "copay_and_coinsurance") && c.coinsurancePct === null) out.push({ where, why: "coinsurance with no percentage" });
      else if (c.coinsurancePct !== null && (c.coinsurancePct < 0 || c.coinsurancePct > 100)) out.push({ where, why: "a percentage outside 0–100" });
      else if (!inDoc(c.quote)) out.push({ where, why: "the quoted text was not found in the document" });
    }
  return out;
};

/* -------------------------------- estimate -------------------------------- */

export type Network = "in_network" | "out_of_network";

export type EstimateInput = {
  service: ServiceKey;
  network?: Network;
  /** What the provider would be paid for it, when the member knows (a quoted or posted price). */
  priceUsd?: number | null;
  /** What the member says they have already paid toward this year's deductible. */
  deductiblePaidUsd?: number | null;
};

export type Estimate = {
  service: ServiceKey;
  label: string;
  network: Network;
  /** The plan's rule in plain words, built from the cell: "$30 copay, deductible does not apply". */
  rule: string;
  /** The cell as printed on the summary. */
  quote: string;
  /** Dollars, only when they can be stood behind; both null when the plan pays a share of an unknown price. */
  lowUsd: number | null;
  highUsd: number | null;
  /** What the range stands on, and what would narrow it. */
  basis: string[];
  limits: string | null;
};

const usd = (n: number) => `$${Number.isInteger(n) ? n.toLocaleString("en-US") : n.toFixed(2)}`;
const round = (n: number) => Math.round(n * 100) / 100;

export const ruleOf = (c: CostShare): string => {
  const ded = c.deductibleApplies === true ? " after the deductible" : c.deductibleApplies === false ? ", deductible does not apply" : "";
  switch (c.kind) {
    case "no_charge": return `No charge${ded}`;
    case "copay": return `${usd(c.copayUsd ?? 0)} copay${ded}`;
    case "coinsurance": return `${c.coinsurancePct}% coinsurance${ded}`;
    case "copay_and_coinsurance": return `${usd(c.copayUsd ?? 0)} copay plus ${c.coinsurancePct}% coinsurance${ded}`;
    case "not_covered": return "Not covered";
    default: return c.quote.trim() || "Not stated";
  }
};

/** What the member pays for one service at `price`, with `remaining` of the deductible still to meet. */
const pay = (c: CostShare, price: number, remaining: number): number => {
  if (c.kind === "not_covered") return price;
  const ded = c.deductibleApplies ? Math.min(price, Math.max(0, remaining)) : 0;
  const rest = price - ded;
  const copay = Math.min(c.copayUsd ?? 0, rest);
  switch (c.kind) {
    case "no_charge": return ded;
    case "copay": return ded + copay;
    case "coinsurance": return ded + (rest * (c.coinsurancePct ?? 0)) / 100;
    case "copay_and_coinsurance": return ded + copay + ((rest - copay) * (c.coinsurancePct ?? 0)) / 100;
    default: return price;
  }
};

/**
 * An out-of-pocket estimate for one kind of service. Returns null when the
 * summary has no usable row for it (missing, unparseable, or under review) —
 * the caller says the summary does not cover it instead of guessing.
 */
export const estimate = (b: StoredBenefits, input: EstimateInput): Estimate | null => {
  const network: Network = input.network ?? "in_network";
  const side = network === "in_network" ? "inNetwork" : "outOfNetwork";
  const row = b.services.find((s) => s.service === input.service);
  if (!row) return null;
  if (b.review.some((r) => r.where === `${row.service}.${side}`)) return null;
  const c = row[side];
  if (c.kind === "other") return null;

  const base = { service: row.service, label: serviceLabel(row.service), network, rule: ruleOf(c), quote: c.quote, limits: row.limits };
  const basis: string[] = [];
  const price = input.priceUsd != null && input.priceUsd > 0 ? input.priceUsd : null;

  if (c.kind === "not_covered") {
    basis.push("the plan's summary lists this as not covered, so the full price is yours");
    return { ...base, lowUsd: price, highUsd: price, basis };
  }

  // The deductible only matters when the cell says it applies (or does not say).
  const dedReviewed = b.review.some((r) => r.where === "deductible");
  const deductible = dedReviewed ? null : b.deductible[side].individualUsd;
  const dedInPlay = c.deductibleApplies !== false;
  const flat = !dedInPlay && (c.kind === "no_charge" || c.kind === "copay");

  if (flat) {
    const amount = c.kind === "no_charge" ? 0 : c.copayUsd ?? 0;
    basis.push("a flat amount on the plan's summary; it does not depend on the provider's price");
    return { ...base, lowUsd: amount, highUsd: amount, basis };
  }
  if (price === null) {
    basis.push("the plan pays a share of the price, and no price is known — a dollar figure needs the provider's price for this service");
    return { ...base, lowUsd: null, highUsd: null, basis };
  }
  basis.push(`a price of ${usd(price)}`);

  // Deductible still to meet: exact when the member told us what they have paid, else both ends.
  let low: number;
  let high: number;
  if (!dedInPlay) {
    low = high = pay({ ...c, deductibleApplies: false }, price, 0);
  } else if (deductible === null) {
    basis.push("the deductible amount could not be read from the summary, so no dollar figure");
    return { ...base, lowUsd: null, highUsd: null, basis };
  } else {
    const applies = { ...c, deductibleApplies: true };
    const paid = input.deductiblePaidUsd;
    if (paid != null && paid >= 0) {
      const remaining = Math.max(0, deductible - paid);
      high = pay(applies, price, remaining);
      low = c.deductibleApplies === null ? pay({ ...c, deductibleApplies: false }, price, 0) : high;
      basis.push(`${usd(Math.min(paid, deductible))} of the ${usd(deductible)} deductible already paid, as you entered it`);
    } else {
      low = pay(applies, price, 0);
      high = pay(applies, price, deductible);
      basis.push(`how much of the ${usd(deductible)} deductible is already paid is not known: the low end assumes all of it, the high end none`);
    }
    if (c.deductibleApplies === null) {
      low = Math.min(low, pay({ ...c, deductibleApplies: false }, price, 0));
      basis.push("the summary does not say whether the deductible applies to this service");
    }
  }

  const cap = b.review.some((r) => r.where === "outOfPocketMax") ? null : b.outOfPocketMax[side].individualUsd;
  if (cap !== null) { low = Math.min(low, cap); high = Math.min(high, cap); }
  [low, high] = [Math.min(low, high), Math.max(low, high)];
  return { ...base, lowUsd: round(low), highUsd: round(high), basis };
};

/* ---------------------------------- views --------------------------------- */

/** The headline facts of a stored summary, for the app's card and Ollie's context. */
export const headline = (b: StoredBenefits) => {
  const flagged = new Set(b.review.map((r) => r.where));
  const tier = (name: "deductible" | "outOfPocketMax") => (flagged.has(name) ? null : { inNetwork: b[name].inNetwork, outOfNetwork: b[name].outOfNetwork });
  return {
    planName: b.planName,
    issuer: b.issuer,
    planType: b.planType,
    coverageFor: b.coverageFor,
    period: b.periodStart || b.periodEnd ? { start: b.periodStart, end: b.periodEnd } : null,
    deductible: tier("deductible"),
    outOfPocketMax: tier("outOfPocketMax"),
    referralRequired: b.referralRequired,
    outOfNetworkCovered: b.outOfNetworkCovered,
    services: b.services.map((s) => ({
      service: s.service,
      label: serviceLabel(s.service),
      inNetwork: flagged.has(`${s.service}.inNetwork`) ? null : ruleOf(s.inNetwork),
      outOfNetwork: flagged.has(`${s.service}.outOfNetwork`) ? null : ruleOf(s.outOfNetwork),
      limits: s.limits,
    })),
    needsReview: b.review.length,
  };
};

/** True when the plan year on the summary has ended — its numbers are last year's. */
export const isExpired = (b: Pick<Benefits, "periodEnd">, today: string): boolean => !!b.periodEnd && b.periodEnd < today;

/**
 * The one caveat every estimate carries, in the app and in Ollie's words. Fixed
 * copy, written once: an estimate from the member's own plan summary is not a
 * quote, a guarantee of coverage or a bill.
 */
export const ESTIMATE_CAVEAT =
  "This is an estimate from the plan summary you uploaded, not a quote or a guarantee of coverage or payment. What you are charged may be different: it depends on the provider's price, whether they are in your network, how the visit is billed and what you have already paid this year. Your insurer decides the final amount — the number on your card can confirm it.";
