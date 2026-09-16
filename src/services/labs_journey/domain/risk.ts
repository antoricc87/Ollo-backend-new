/**
 * Risk & biological age — revived from the retired post-visit report
 * (Aug 28 2026). Pure functions over the merged current-labs view; each block
 * computes when its inputs exist and otherwise says what is missing, instead
 * of the old all-or-nothing throw. The merged view already expresses values
 * in display units (utils/labUnits); the helpers below re-check units so a
 * value that slipped through unconverted is still read in what the
 * calculators expect (US conventional: mg/dL, g/dL, U/L, %, fL, K/µL).
 * A censored value ("<5") is never used as if it were the number: CRP falls
 * back to a below-detection assumption, anything else counts as missing.
 *
 * Models: Framingham general CVD 10-year risk (D'Agostino 2008), Framingham
 * Offspring 8-year diabetes risk (Wilson 2007), PhenoAge (Levine 2018).
 * Reference ranges and coefficients live in utils/risks_calculation_bio_age.
 */
import { calculateCVRisk } from "../../../utils/risks_calculation_bio_age/calculateCVRisk";
import { calculateDiabetesRisk } from "../../../utils/risks_calculation_bio_age/calculateDiabetesRisk";
import { calculatePhenotypicAge } from "../../../utils/risks_calculation_bio_age/calculateBioAge";
import { CurrentBiomarker, labFreshness } from "../../../utils/labBiomarkers";

export type Sex = "M" | "F";

export type RiskProfile = {
  age: number | null;
  sex: Sex | null;
  heightCm: number | null;
  weightKg: number | null;
  smoker: boolean;
  diabetic: boolean;
  parentalDiabetes: boolean;
  onBloodPressureTreatment: boolean;
  bloodPressure: { systolic: number; diastolic: number; source: "tracker" | "profile" | "assumed"; at: string | null };
};

/**
 * Why a computed number should be read with care: how many of its lab inputs
 * are past the 12-month "retest" threshold, and which values the model had to
 * assume or derive instead of measure. Both empty → the number is clean.
 */
export type BlockCaveats = {
  oldInputs: { count: number; total: number; oldestAt: string } | null;
  assumed: string[];
};

export type RiskReport = {
  age: number | null;
  sex: Sex | null;
  labsAsOf: string | null;
  bloodPressure: RiskProfile["bloodPressure"];
  cardiovascular:
    | {
        tenYearPercent: number;
        typicalPercent: number;
        optimalPercent: number;
        band: "low" | "moderate" | "high";
        drivers: string[];
        caveats: BlockCaveats;
      }
    | null;
  cardiovascularMissing: string[];
  diabetes: { eightYearPercent: string; drivers: string[]; caveats: BlockCaveats } | null;
  diabetesMissing: string[];
  biologicalAge: { phenotypicAge: number; delta: number; drivers: string[]; caveats: BlockCaveats } | null;
  biologicalAgeMissing: string[];
  assumptions: string[];
};

/* ------------------------------ unit helpers ------------------------------ */

const num = (b?: CurrentBiomarker | null): number | null => {
  if (!b || b.censored) return null;
  if (typeof b.value === "number" && Number.isFinite(b.value)) return b.value;
  const v = parseFloat(String(b.result).replace(/[^\d.-]/g, ""));
  return Number.isFinite(v) ? v : null;
};
const unit = (b?: CurrentBiomarker | null) => (b?.units ?? "").toLowerCase().replace(/\s/g, "");

/** mg/dL for lipids and glucose regardless of the reported unit. */
const mgdl = (b: CurrentBiomarker | null | undefined, kind: "chol" | "tg" | "glucose"): number | null => {
  const v = num(b);
  if (v === null) return null;
  const u = unit(b);
  if (u.includes("mmol")) return kind === "chol" ? v * 38.67 : kind === "tg" ? v * 88.57 : v * 18.016;
  return v;
};
/** CRP in mg/L (the PhenoAge helper converts to mg/dL itself). */
const crpMgL = (b: CurrentBiomarker | null | undefined): number | null => {
  const v = num(b);
  if (v === null) return null;
  return unit(b).includes("mg/dl") ? v * 10 : v;
};
/** Albumin in g/dL. */
const albuminGdl = (b: CurrentBiomarker | null | undefined): number | null => {
  const v = num(b);
  if (v === null) return null;
  const u = unit(b);
  return u === "g/l" ? v / 10 : v;
};
/** Creatinine in mg/dL. */
const creatinineMgdl = (b: CurrentBiomarker | null | undefined): number | null => {
  const v = num(b);
  if (v === null) return null;
  return /mol/.test(unit(b)) ? v / 88.4 : v;
};
/** WBC in thousands per µL. */
const wbcK = (b: CurrentBiomarker | null | undefined): number | null => {
  const v = num(b);
  if (v === null) return null;
  return v > 100 ? v / 1000 : v;
};

export const LAB_LABEL: Record<string, string> = {
  tcl: "total cholesterol",
  hdl: "HDL",
  triglycerides: "triglycerides",
  glucose: "fasting glucose",
  albumin: "albumin",
  creatinine: "creatinine",
  crp: "CRP",
  rdw: "RDW",
  wbc: "white cells (WBC)",
  mcv: "MCV",
  lymphocytes: "lymphocytes %",
  "alkaline phosphatase": "alkaline phosphatase",
};

/* -------------------------------- caveats --------------------------------- */

/**
 * Caveats for one block from the biomarkers that actually fed it (each is the
 * latest value on record, so "old" means nothing newer exists) and the values
 * that were assumed rather than measured.
 */
const caveatsFor = (used: (CurrentBiomarker | null)[], assumed: string[], now: Date): BlockCaveats => {
  const present = used.filter((b): b is CurrentBiomarker => !!b);
  const old = present.filter((b) => labFreshness(b.collectedAt, now) === "stale");
  return {
    oldInputs: old.length ? { count: old.length, total: present.length, oldestAt: old.map((b) => b.collectedAt).sort()[0] } : null,
    assumed,
  };
};

const BP_ASSUMED = "Blood pressure assumed at 120/80 — no reading on record.";

/* --------------------------------- report --------------------------------- */

export const buildRiskReport = (profile: RiskProfile, labs: CurrentBiomarker[], now: Date = new Date()): RiskReport => {
  const by = new Map(labs.map((b) => [b.key, b]));
  const raw = (k: string) => by.get(k) ?? null;
  /** A usable measurement: present and an actual number, not a printed limit. */
  const get = (k: string) => {
    const b = raw(k);
    return b && !b.censored ? b : null;
  };
  /** Missing-list label; says so when the lab only printed a limit. */
  const label = (k: string) => {
    const b = raw(k);
    return b?.censored ? `${LAB_LABEL[k]} (report only says ${b.result} ${b.units ?? ""})`.replace(/\s+\)/, ")") : LAB_LABEL[k];
  };
  const assumptions: string[] = [];
  const labsAsOf = labs.length ? labs.map((b) => b.collectedAt).sort().slice(-1)[0] : null;

  if (profile.bloodPressure.source === "assumed")
    assumptions.push("No blood pressure on record — 120/80 assumed. Log a reading to make this yours.");

  /* ---- cardiovascular ---- */
  const tclB = get("tcl");
  const hdlB = get("hdl");
  const ldlB = get("ldl");
  const tgB = get("triglycerides");
  const ldl = mgdl(ldlB, "chol");
  const tg = mgdl(tgB, "tg");
  const hdl = mgdl(hdlB, "chol");
  let tcl = mgdl(tclB, "chol");
  let tclUsed: (CurrentBiomarker | null)[] = [tclB];
  const cvAssumed: string[] = [];
  if (tcl === null && ldl !== null && hdl !== null && tg !== null) {
    tcl = ldl + hdl + tg / 5; // Friedewald, reversed
    tclUsed = [ldlB, tgB];
    const note = "Total cholesterol estimated from LDL, HDL and triglycerides.";
    assumptions.push(note);
    cvAssumed.push(note);
  }
  if (profile.bloodPressure.source === "assumed") cvAssumed.push(BP_ASSUMED);
  const cvMissing: string[] = [];
  if (profile.age === null) cvMissing.push("birth date");
  if (profile.sex === null) cvMissing.push("sex");
  if (tcl === null) cvMissing.push(label("tcl"));
  if (hdl === null) cvMissing.push(label("hdl"));
  let cardiovascular: RiskReport["cardiovascular"] = null;
  if (cvMissing.length === 0 && profile.age !== null && profile.sex !== null && tcl !== null && hdl !== null) {
    try {
      const r = calculateCVRisk({
        gender: profile.sex,
        age: profile.age,
        sbp: profile.bloodPressure.systolic,
        tcl,
        hdl,
        smoker: profile.smoker,
        diabetic: profile.diabetic,
        treatmentStatus: profile.onBloodPressureTreatment ? "treatment" : "noTreatment",
      });
      const pct = r.patientRiskScore * 100;
      const drivers: string[] = [];
      if (profile.smoker) drivers.push("Smoking is the largest modifiable driver here.");
      if (profile.diabetic) drivers.push("Diabetes on record roughly doubles the baseline.");
      if (profile.bloodPressure.systolic >= 130) drivers.push(`Systolic ${profile.bloodPressure.systolic} mmHg adds to it.`);
      if (tcl >= 200) drivers.push(`Total cholesterol ${Math.round(tcl)} mg/dL is above 200.`);
      if (hdl < (profile.sex === "M" ? 40 : 50)) drivers.push(`HDL ${Math.round(hdl)} mg/dL is on the low side.`);
      if (!drivers.length) drivers.push("Nothing measured is pushing this up; age does most of the work.");
      cardiovascular = {
        tenYearPercent: Math.round(pct * 10) / 10,
        typicalPercent: Math.round(r.normalCVRiskScore * 1000) / 10,
        optimalPercent: Math.round(r.optimalCVRisk * 1000) / 10,
        band: pct < 10 ? "low" : pct < 20 ? "moderate" : "high",
        drivers,
        caveats: caveatsFor([...tclUsed, hdlB], cvAssumed, now),
      };
    } catch (e) {
      cvMissing.push("valid inputs");
    }
  }

  /* ---- diabetes ---- */
  const glucoseB = get("glucose");
  const glucose = mgdl(glucoseB, "glucose");
  const dMissing: string[] = [];
  if (profile.age === null) dMissing.push("birth date");
  if (profile.sex === null) dMissing.push("sex");
  if (profile.heightCm === null || profile.weightKg === null) dMissing.push("height and weight");
  if (hdl === null) dMissing.push(label("hdl"));
  if (tg === null) dMissing.push(label("triglycerides"));
  if (glucose === null) dMissing.push(label("glucose"));
  let diabetes: RiskReport["diabetes"] = null;
  if (
    dMissing.length === 0 &&
    profile.age !== null &&
    profile.sex !== null &&
    profile.heightCm !== null &&
    profile.weightKg !== null &&
    hdl !== null &&
    tg !== null &&
    glucose !== null
  ) {
    const dCaveats = caveatsFor([hdlB, tgB, glucoseB], profile.bloodPressure.source === "assumed" ? [BP_ASSUMED] : [], now);
    if (profile.diabetic) {
      diabetes = {
        eightYearPercent: "—",
        drivers: ["Diabetes is already on your record; this score is for people without it."],
        caveats: dCaveats,
      };
    } else {
      const eightYearPercent = calculateDiabetesRisk({
        age: profile.age,
        gender: profile.sex,
        systolicBp: profile.bloodPressure.systolic,
        diastolicBp: profile.bloodPressure.diastolic,
        hypertensionTreatment: profile.onBloodPressureTreatment,
        // the calculator's BMI formula expects pounds and inches
        height: profile.heightCm / 2.54,
        weight: profile.weightKg * 2.20462,
        hdl,
        triglycerides: tg,
        fastingGlucose: glucose,
        parentalDiabetes: profile.parentalDiabetes,
      });
      const bmi = profile.weightKg / Math.pow(profile.heightCm / 100, 2);
      const drivers: string[] = [];
      if (glucose >= 100) drivers.push(`Fasting glucose ${Math.round(glucose)} mg/dL is in the prediabetes range — the biggest factor.`);
      if (bmi >= 30) drivers.push(`BMI ${bmi.toFixed(1)} counts heavily.`);
      else if (bmi >= 25) drivers.push(`BMI ${bmi.toFixed(1)} adds a little.`);
      if (hdl < (profile.sex === "M" ? 40 : 50)) drivers.push("Low HDL adds to it.");
      if (tg >= 150) drivers.push(`Triglycerides ${Math.round(tg)} mg/dL are above 150.`);
      if (profile.parentalDiabetes) drivers.push("A parent with diabetes adds to it.");
      if (profile.bloodPressure.systolic > 130 || profile.bloodPressure.diastolic > 85) drivers.push("Blood pressure above 130/85 adds to it.");
      if (!drivers.length) drivers.push("None of the usual drivers are present.");
      diabetes = { eightYearPercent, drivers, caveats: dCaveats };
    }
  }

  /* ---- biological age (PhenoAge) ---- */
  const bioB = {
    albumin: get("albumin"),
    creatinine: get("creatinine"),
    glucose: glucoseB,
    crp: get("crp"),
    rdw: get("rdw"),
    wbc: get("wbc"),
    mcv: get("mcv"),
    lymphocytes: get("lymphocytes"),
    alp: get("alkaline phosphatase"),
  };
  const bio = {
    albumin: albuminGdl(bioB.albumin),
    creatinine: creatinineMgdl(bioB.creatinine),
    glucose,
    crp: crpMgL(bioB.crp),
    rdw: num(bioB.rdw),
    wbc: wbcK(bioB.wbc),
    mcv: num(bioB.mcv),
    lymphocytes: num(bioB.lymphocytes),
    alp: num(bioB.alp),
  };
  const bMissing: string[] = [];
  if (profile.age === null) bMissing.push("birth date");
  (["albumin", "creatinine", "glucose", "rdw", "wbc", "mcv", "lymphocytes"] as const).forEach((k) => {
    if (bio[k] === null) bMissing.push(label(k));
  });
  if (bio.alp === null) bMissing.push(label("alkaline phosphatase"));
  let biologicalAge: RiskReport["biologicalAge"] = null;
  if (bMissing.length === 0 && profile.age !== null) {
    let crp = bio.crp;
    const bAssumed: string[] = [];
    if (crp === null) {
      const censoredCrp = raw("crp");
      const limit = censoredCrp?.censored === "<" ? crpMgL({ ...censoredCrp, censored: null }) : null;
      if (limit !== null && limit > 0) {
        // The lab only says "below X": use half the limit, capped at the usual default.
        crp = Math.min(1, Math.round((limit / 2) * 100) / 100);
        assumptions.push(`CRP reported as below ${limit} mg/L — ${crp} mg/L assumed for biological age.`);
        bAssumed.push(`CRP reported as below ${limit} mg/L — ${crp} mg/L assumed.`);
      } else {
        crp = 1;
        assumptions.push("CRP not measured — 1 mg/L assumed for biological age.");
        bAssumed.push("CRP not measured — 1 mg/L assumed.");
      }
    }
    const phenotypicAge = calculatePhenotypicAge({
      age: profile.age,
      albumin: bio.albumin!,
      creatinine: bio.creatinine!,
      glucose: bio.glucose!,
      crp,
      rdw: bio.rdw!,
      wbc: bio.wbc!,
      mcv: bio.mcv!,
      lympocyte: bio.lymphocytes!,
      alkalinePhosphatase: bio.alp!,
    });
    const delta = phenotypicAge - profile.age;
    const drivers: string[] = [];
    if (bio.glucose! >= 100) drivers.push("Fasting glucose above 100 ages the estimate.");
    if (crp > 3) drivers.push("CRP above 3 mg/L (inflammation) ages it.");
    if (bio.albumin! < 4) drivers.push("Albumin under 4 g/dL ages it.");
    if (bio.rdw! > 14.5) drivers.push("RDW above 14.5% ages it.");
    if (bio.wbc! > 8) drivers.push("White cells above 8 K/µL age it.");
    if (!drivers.length) drivers.push(delta < 0 ? "Every input sits on the young side of its range." : "No single value stands out; the sum is close to your age.");
    biologicalAge = {
      phenotypicAge: Math.round(phenotypicAge * 10) / 10,
      delta: Math.round(delta * 10) / 10,
      drivers,
      caveats: caveatsFor(
        [bioB.albumin, bioB.creatinine, bioB.glucose, bioB.rdw, bioB.wbc, bioB.mcv, bioB.lymphocytes, bioB.alp, bio.crp === null ? null : bioB.crp],
        bAssumed,
        now
      ),
    };
  }

  return {
    age: profile.age,
    sex: profile.sex,
    labsAsOf,
    bloodPressure: profile.bloodPressure,
    cardiovascular,
    cardiovascularMissing: cvMissing,
    diabetes,
    diabetesMissing: dMissing,
    biologicalAge,
    biologicalAgeMissing: bMissing,
    assumptions,
  };
};
