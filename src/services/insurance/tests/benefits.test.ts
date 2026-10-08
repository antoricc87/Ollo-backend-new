import { estimate, headline, isExpired, normalizeBenefits, reviewBenefits, ruleOf, type Benefits, type CostShare, type StoredBenefits } from "../domain/benefits";

const cell = (kind: CostShare["kind"], quote: string, o: Partial<CostShare> = {}): CostShare => ({ kind, copayUsd: null, coinsurancePct: null, deductibleApplies: null, quote, ...o });
const notCovered = cell("not_covered", "Not covered");

const plan = (over: Partial<Benefits> = {}): Benefits => ({
  isBenefitsSummary: true,
  planName: "Silver 3000",
  issuer: "Sample Health",
  planType: "PPO",
  coverageFor: "individual",
  periodStart: "2026-01-01",
  periodEnd: "2026-12-31",
  deductible: { inNetwork: { individualUsd: 3000, familyUsd: 6000 }, outOfNetwork: { individualUsd: 6000, familyUsd: 12000 }, quote: "$3,000 individual / $6,000 family in-network; $6,000 / $12,000 out-of-network" },
  outOfPocketMax: { inNetwork: { individualUsd: 8000, familyUsd: 16000 }, outOfNetwork: { individualUsd: null, familyUsd: null }, quote: "$8,000 individual / $16,000 family" },
  referralRequired: false,
  outOfNetworkCovered: true,
  services: [
    { service: "primary_care_visit", inNetwork: cell("copay", "$30 copay/visit; deductible does not apply", { copayUsd: 30, deductibleApplies: false }), outOfNetwork: cell("coinsurance", "40% coinsurance", { coinsurancePct: 40, deductibleApplies: true }), limits: null },
    { service: "preventive_care", inNetwork: cell("no_charge", "No charge", { deductibleApplies: false }), outOfNetwork: notCovered, limits: null },
    { service: "imaging", inNetwork: cell("coinsurance", "20% coinsurance", { coinsurancePct: 20, deductibleApplies: true }), outOfNetwork: notCovered, limits: "Prior authorization required" },
    { service: "urgent_care", inNetwork: cell("copay", "$75 copay/visit", { copayUsd: 75 }), outOfNetwork: notCovered, limits: null },
  ],
  ...over,
});
const stored = (b: Benefits = plan(), text: string | null = null): StoredBenefits => ({ ...b, review: reviewBenefits(b, text), source: { engine: "text", pages: 6, model: "test" } });

describe("ruleOf", () => {
  it("states the cell in plain words", () => {
    const p = plan();
    expect(ruleOf(p.services[0].inNetwork)).toBe("$30 copay, deductible does not apply");
    expect(ruleOf(p.services[2].inNetwork)).toBe("20% coinsurance after the deductible");
    expect(ruleOf(p.services[1].outOfNetwork)).toBe("Not covered");
  });
});

describe("estimate", () => {
  it("is exact for a flat copay and needs no price", () => {
    expect(estimate(stored(), { service: "primary_care_visit" })).toMatchObject({ lowUsd: 30, highUsd: 30, network: "in_network" });
  });

  it("is $0 for in-network preventive care", () => {
    expect(estimate(stored(), { service: "preventive_care" })).toMatchObject({ lowUsd: 0, highUsd: 0 });
  });

  it("gives no dollars for coinsurance without a price", () => {
    const e = estimate(stored(), { service: "imaging" })!;
    expect([e.lowUsd, e.highUsd]).toEqual([null, null]);
    expect(e.limits).toBe("Prior authorization required");
  });

  it("ranges over the deductible when what is paid is unknown", () => {
    // $1,200 MRI: deductible met → 20% = $240; nothing met → the whole $1,200.
    expect(estimate(stored(), { service: "imaging", priceUsd: 1200 })).toMatchObject({ lowUsd: 240, highUsd: 1200 });
  });

  it("is one number once the member says what they have paid", () => {
    // $2,500 paid of $3,000 → $500 deductible + 20% of the other $700.
    expect(estimate(stored(), { service: "imaging", priceUsd: 1200, deductiblePaidUsd: 2500 })).toMatchObject({ lowUsd: 640, highUsd: 640 });
    expect(estimate(stored(), { service: "imaging", priceUsd: 1200, deductiblePaidUsd: 9999 })).toMatchObject({ lowUsd: 240, highUsd: 240 });
  });

  it("widens the range when the cell does not say whether the deductible applies", () => {
    // $75 copay, deductible unstated, $200 visit: copay only … or the whole $200 toward the deductible.
    expect(estimate(stored(), { service: "urgent_care", priceUsd: 200 })).toMatchObject({ lowUsd: 75, highUsd: 200 });
    expect(estimate(stored(), { service: "urgent_care" })).toMatchObject({ lowUsd: null, highUsd: null });
  });

  it("charges the full price for a service the plan does not cover", () => {
    expect(estimate(stored(), { service: "imaging", network: "out_of_network", priceUsd: 900 })).toMatchObject({ lowUsd: 900, highUsd: 900, rule: "Not covered" });
  });

  it("never exceeds the out-of-pocket limit", () => {
    const b = plan();
    b.deductible.inNetwork.individualUsd = 3000;
    b.outOfPocketMax.inNetwork.individualUsd = 1000;
    b.outOfPocketMax.quote = "$1,000 individual / $16,000 family";
    expect(estimate(stored(b), { service: "imaging", priceUsd: 50000 })!.highUsd).toBe(1000);
  });

  it("returns null for a service the summary does not list", () => {
    expect(estimate(stored(), { service: "hospice" })).toBeNull();
  });
});

describe("reviewBenefits", () => {
  it("passes a consistent extraction", () => {
    expect(stored().review).toEqual([]);
  });

  it("flags an amount that is not in its own quote, and estimates nothing from it", () => {
    const b = plan();
    b.services[0].inNetwork = cell("copay", "$30 copay/visit", { copayUsd: 300, deductibleApplies: false });
    const s = stored(b);
    expect(s.review).toEqual([{ where: "primary_care_visit.inNetwork", why: "an amount is not in the quoted text" }]);
    expect(estimate(s, { service: "primary_care_visit" })).toBeNull();
    expect(headline(s).services[0].inNetwork).toBeNull();
  });

  it("ignores a zero the model put where nothing is printed", () => {
    const b = plan();
    b.services[2].inNetwork = cell("coinsurance", "20% coinsurance", { copayUsd: 0, coinsurancePct: 20, deductibleApplies: true });
    b.services[1].inNetwork = cell("no_charge", "No charge", { copayUsd: 0, coinsurancePct: 0, deductibleApplies: false });
    expect(reviewBenefits(b, null).map((r) => r.where)).toEqual(["preventive_care.inNetwork", "imaging.inNetwork"]);
    const clean = normalizeBenefits(b);
    expect(reviewBenefits(clean, null)).toEqual([]);
    expect(clean.services[2].inNetwork).toMatchObject({ copayUsd: null, coinsurancePct: 20 });
  });

  it("flags a quote that is not in the document", () => {
    const text = "Primary care visit to treat an injury or illness | $30 copay/visit; deductible does not apply | 40% coinsurance\nWhat is the overall deductible? | $3,000 individual / $6,000 family in-network; $6,000 / $12,000 out-of-network\n$8,000 individual / $16,000 family\nNo charge\nNot covered\n20% coinsurance";
    const s = stored(plan(), text);
    expect(s.review.map((r) => r.where)).toEqual(["urgent_care.inNetwork"]);
  });

  it("does not use a deductible under review for dollars", () => {
    const b = plan();
    b.deductible.quote = "$2,000 individual";
    const s = stored(b);
    expect(s.review[0].where).toBe("deductible");
    expect(estimate(s, { service: "imaging", priceUsd: 1200 })).toMatchObject({ lowUsd: null, highUsd: null });
    expect(headline(s).deductible).toBeNull();
  });
});

describe("isExpired", () => {
  it("is true once the plan year has ended", () => {
    expect(isExpired({ periodEnd: "2025-12-31" }, "2026-10-08")).toBe(true);
    expect(isExpired({ periodEnd: "2026-12-31" }, "2026-10-08")).toBe(false);
    expect(isExpired({ periodEnd: null }, "2026-10-08")).toBe(false);
  });
});
