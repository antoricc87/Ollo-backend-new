import { RULE_TYPE } from "../../preventive/domain/plan";
import { OPTIONAL } from "../../preventive/domain/optional";
import { slotsFrom } from "./slots";
import { BookingAdapter, Hours, LabValue, Offering, PlaceSpec } from "./types";

/**
 * THE SIMULATED NETWORK — fictional places and generated times, so booking
 * can be built end to end before a real lab or imaging partner exists.
 * Every place name ends in "(test)" and the API marks it `simulated`, so it
 * can never pass for a real business. Results: a lab appointment "returns"
 * normal-range values two days after it happened — and those values are only
 * written to a person's record when BOOKING_SIMULATED_RESULTS=1 (local and
 * test accounts; never set it in production).
 */

const WEEKDAYS: Hours = { mon: ["07:00", "16:00"], tue: ["07:00", "16:00"], wed: ["07:00", "16:00"], thu: ["07:00", "16:00"], fri: ["07:00", "14:00"] };
const LONG: Hours = { ...WEEKDAYS, sat: ["08:00", "12:00"] };
const PHARMACY: Hours = { mon: ["09:00", "20:00"], tue: ["09:00", "20:00"], wed: ["09:00", "20:00"], thu: ["09:00", "20:00"], fri: ["09:00", "20:00"], sat: ["10:00", "18:00"], sun: ["10:00", "16:00"] };

const optionalOf = (type: string) => OPTIONAL.filter((o) => o.type === type).map((o) => o.key);
const ruleOf = (type: string) => Object.entries(RULE_TYPE).filter(([, t]) => t === type).map(([k]) => k);
const priceOf = (key: string): [number, number] => {
  const m = OPTIONAL.find((o) => o.key === key)?.price.match(/\$([\d,]+)(?:–\$([\d,]+))?/);
  return m ? [Number(m[1].replace(/,/g, "")), Number((m[2] ?? m[1]).replace(/,/g, ""))] : [0, 0];
};

const LAB_KEYS = [...ruleOf("lab"), ...optionalOf("lab")];
const FASTING = new Set(["hba1c_glucose", "insulin"]);
const labOfferings = (): Offering[] => LAB_KEYS.map((key) => ({ key, minutes: 15, priceUsd: priceOf(key), prep: FASTING.has(key) ? "Fast for 8 hours (water is fine)" : null }));

const IMAGING: Record<string, Omit<Offering, "key" | "priceUsd"> & { price?: [number, number] }> = {
  mammography: { minutes: 30, prep: "No deodorant or powder on the day", price: [0, 0] },
  dxa: { minutes: 20, prep: "No calcium supplements for 24 hours", price: [0, 0] },
  lung_ldct: { minutes: 20, prep: null, price: [0, 0] },
  aaa_ultrasound: { minutes: 30, prep: "Nothing to eat for 8 hours", price: [0, 0] },
  cac: { minutes: 20, prep: "No caffeine for 4 hours" },
  ccta: { minutes: 60, prep: "No caffeine for 12 hours; a driver is not needed" },
  carotid_us: { minutes: 30, prep: null },
  fullbody_mri: { minutes: 75, prep: "No metal; tell them about implants" },
  brain_mri: { minutes: 45, prep: "No metal; tell them about implants" },
  breast_mri: { minutes: 45, prep: "No metal; tell them about implants" },
  prostate_mri: { minutes: 45, prep: "No metal; tell them about implants" },
  dexa_body: { minutes: 20, prep: null },
  dexa_bone_opt: { minutes: 20, prep: "No calcium supplements for 24 hours" },
  lung_ct_opt: { minutes: 20, prep: null },
  fibroscan: { minutes: 20, prep: "Nothing to eat for 3 hours" },
  echo: { minutes: 45, prep: null },
  ecg: { minutes: 15, prep: null },
  stress_test: { minutes: 60, prep: "Comfortable shoes; no caffeine for 12 hours" },
  vo2max: { minutes: 45, prep: "Exercise clothes; a light meal 3 hours before" },
  sleep_study: { minutes: 30, prep: "A home kit is handed over; you wear it one night" },
};
const imagingOfferings = (): Offering[] => Object.entries(IMAGING).map(([key, o]) => ({ key, minutes: o.minutes, prep: o.prep, priceUsd: o.price ?? priceOf(key) }));

const procedureOfferings = (): Offering[] => [
  { key: "colorectal", minutes: 240, priceUsd: [0, 0], prep: "Bowel prep the day before; someone must drive you home" },
  { key: "colon_early", minutes: 240, priceUsd: priceOf("colon_early"), prep: "Bowel prep the day before; someone must drive you home" },
  { key: "endoscopy", minutes: 180, priceUsd: priceOf("endoscopy"), prep: "Nothing to eat for 8 hours; someone must drive you home" },
];
const womensOfferings = (): Offering[] => [{ key: "cervical", minutes: 30, priceUsd: [0, 0], prep: "Best not during your period" }];
const VACCINES = ["flu", "tdap", "shingles", "pneumococcal", "hpv", "hepatitis_b", "rsv", "rsv_pregnancy", "covid"];
const pharmacyOfferings = (): Offering[] => VACCINES.map((key) => ({ key, minutes: 15, priceUsd: [0, 0], prep: null }));

const place = (p: Omit<PlaceSpec, "city" | "state" | "zip" | "timeZone">): PlaceSpec => ({ ...p, city: "Testville", state: "NY", zip: "00000", timeZone: "America/New_York" });

export const SIMULATED_PLACES: PlaceSpec[] = [
  place({ providerExternalId: "sim-lab", providerName: "Harbor Labs (test)", kind: "lab", externalId: "sim-lab-1", name: "Harbor Labs — Main St (test)", address: "120 Main St", phone: null, hours: LONG, offerings: labOfferings(), inNetwork: true }),
  place({ providerExternalId: "sim-lab", providerName: "Harbor Labs (test)", kind: "lab", externalId: "sim-lab-2", name: "Harbor Labs — Park Ave (test)", address: "48 Park Ave", phone: null, hours: WEEKDAYS, offerings: labOfferings(), inNetwork: true }),
  place({ providerExternalId: "sim-imaging", providerName: "Elm Street Imaging (test)", kind: "imaging", externalId: "sim-img-1", name: "Elm Street Imaging (test)", address: "9 Elm St", phone: null, hours: WEEKDAYS, offerings: imagingOfferings(), inNetwork: true }),
  place({ providerExternalId: "sim-imaging-2", providerName: "Northgate Diagnostics (test)", kind: "imaging", externalId: "sim-img-2", name: "Northgate Diagnostics (test)", address: "300 North Rd", phone: null, hours: LONG, offerings: imagingOfferings(), inNetwork: false }),
  place({ providerExternalId: "sim-gi", providerName: "Riverside Endoscopy Center (test)", kind: "procedure", externalId: "sim-gi-1", name: "Riverside Endoscopy Center (test)", address: "55 River Rd", phone: null, hours: WEEKDAYS, offerings: procedureOfferings(), inNetwork: true }),
  place({ providerExternalId: "sim-womens", providerName: "Maple Women's Health (test)", kind: "procedure", externalId: "sim-wh-1", name: "Maple Women's Health (test)", address: "17 Maple Ave", phone: null, hours: WEEKDAYS, offerings: womensOfferings(), inNetwork: true }),
  place({ providerExternalId: "sim-pharmacy", providerName: "Corner Pharmacy (test)", kind: "pharmacy", externalId: "sim-rx-1", name: "Corner Pharmacy (test)", address: "2 Corner Sq", phone: null, hours: PHARMACY, offerings: pharmacyOfferings(), inNetwork: true }),
];

/** Deterministic "taken by someone else": roughly one time in three. */
const hashBusy = (seed: string) => (start: Date) => {
  let h = 0;
  for (const ch of `${seed}${start.toISOString()}`) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 3 === 0;
};

/** Normal-range values per lab plan item — what the simulated lab "returns". */
const NORMAL: Record<string, LabValue[]> = {
  lipid_panel: [
    { testType: "Total cholesterol", result: "182", units: "mg/dL", referenceRange: "<200", isOutOfRange: false },
    { testType: "LDL cholesterol", result: "104", units: "mg/dL", referenceRange: "<130", isOutOfRange: false },
    { testType: "HDL cholesterol", result: "56", units: "mg/dL", referenceRange: ">40", isOutOfRange: false },
    { testType: "Triglycerides", result: "108", units: "mg/dL", referenceRange: "<150", isOutOfRange: false },
  ],
  hba1c_glucose: [
    { testType: "Hemoglobin A1c", result: "5.3", units: "%", referenceRange: "<5.7", isOutOfRange: false },
    { testType: "Glucose", result: "88", units: "mg/dL", referenceRange: "70-99", isOutOfRange: false },
  ],
  metabolic_panel: [
    { testType: "Creatinine", result: "0.9", units: "mg/dL", referenceRange: "0.7-1.3", isOutOfRange: false },
    { testType: "eGFR", result: "104", units: "mL/min/1.73m2", referenceRange: ">60", isOutOfRange: false },
    { testType: "ALT", result: "22", units: "U/L", referenceRange: "7-56", isOutOfRange: false },
  ],
  cbc: [{ testType: "Hemoglobin", result: "14.6", units: "g/dL", referenceRange: "13.5-17.5", isOutOfRange: false }],
  tsh: [{ testType: "TSH", result: "1.8", units: "mIU/L", referenceRange: "0.4-4.5", isOutOfRange: false }],
  vitamin_d: [{ testType: "Vitamin D, 25-OH", result: "34", units: "ng/mL", referenceRange: "30-100", isOutOfRange: false }],
  lipoprotein_a: [{ testType: "Lipoprotein (a)", result: "24", units: "nmol/L", referenceRange: "<75", isOutOfRange: false }],
  ferritin_b12: [
    { testType: "Ferritin", result: "96", units: "ng/mL", referenceRange: "30-400", isOutOfRange: false },
    { testType: "Vitamin B12", result: "480", units: "pg/mL", referenceRange: "200-900", isOutOfRange: false },
  ],
  hiv: [{ testType: "HIV-1/2 antigen/antibody", result: "Non reactive", units: "", referenceRange: "Non reactive", isOutOfRange: false }],
  hepatitis_c: [{ testType: "Hepatitis C antibody", result: "Non reactive", units: "", referenceRange: "Non reactive", isOutOfRange: false }],
  apob: [{ testType: "Apolipoprotein B", result: "84", units: "mg/dL", referenceRange: "<90", isOutOfRange: false }],
  hscrp: [{ testType: "hs-CRP", result: "0.8", units: "mg/L", referenceRange: "<1.0", isOutOfRange: false }],
};

/** How long after the appointment a simulated lab's results come back. */
export const RESULTS_AFTER_DAYS = 2;

export const simulatedAdapter: BookingAdapter = {
  key: "simulated",
  places: () => SIMULATED_PLACES,
  availability: (p, minutes, from, days, taken) => slotsFrom({ hours: p.hours, timeZone: p.timeZone, minutes, from, days, taken, busy: hashBusy(p.externalId) }),
  confirm: async (p, startsAt) => {
    const ref = `SIM-${p.externalId}-${startsAt.getTime().toString(36)}`;
    return { externalRef: ref, confirmationCode: ref.slice(-6).toUpperCase() };
  },
  cancel: async () => undefined,
  results: async (_ref, itemKeys, completedAt, now) => {
    if (now.getTime() - completedAt.getTime() < RESULTS_AFTER_DAYS * 86_400_000) return null;
    const values = itemKeys.flatMap((k) => NORMAL[k] ?? []);
    return values.length ? values : null;
  },
};
