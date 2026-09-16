/**
 * Lab units — one display unit per biomarker, whatever the lab printed.
 *
 * Labs print the same quantity in different spellings ("Thousand/uL",
 * "x10E3/uL", "K/µL") and in different unit systems (glucose in mg/dL in the
 * US, mmol/L in Europe). The stored LabResult row keeps the value exactly as
 * printed; the merged current-labs view (utils/labBiomarkers) runs every
 * value through `canonicalise()` so lists, charts, Ollie and the risk
 * calculators compare like with like. When a value is changed, the printed
 * original travels alongside it as `printed`.
 *
 * Coverage is deliberately narrow: the biomarkers that genuinely vary
 * between labs. Anything unknown passes through untouched (unit spelling
 * still normalised when recognised).
 */

/* ------------------------------ unit spelling ----------------------------- */

/** Spelling families → one canonical spelling. Compared after `squash()`. */
const UNIT_SPELLINGS: Record<string, string[]> = {
  "K/µL": ["k/ul", "thousand/ul", "thou/ul", "x10e3/ul", "x10^3/ul", "10^3/ul", "10e3/ul", "x1000/ul", "10*3/ul", "x10³/ul", "10³/ul", "x10e9/l", "x10^9/l", "10^9/l", "10e9/l", "10*9/l", "x10⁹/l", "10⁹/l", "giga/l", "k/mm3", "x10^3/mm3", "10^3/mm3", "thousand/mm3", "x10e3/mm3", "/nl", "x1000/mm3", "mille/mm3", "migliaia/ul"],
  "M/µL": ["m/ul", "million/ul", "mil/ul", "x10e6/ul", "x10^6/ul", "10^6/ul", "10e6/ul", "10*6/ul", "x10⁶/ul", "10⁶/ul", "x10e12/l", "x10^12/l", "10^12/l", "10e12/l", "10*12/l", "x10¹²/l", "10¹²/l", "tera/l", "m/mm3", "x10^6/mm3", "10^6/mm3", "million/mm3", "milioni/ul", "/pl"],
  "cells/µL": ["cells/ul", "cell/ul", "/ul", "/mm3", "cells/mm3", "cellule/ul"],
  "U/L": ["u/l", "iu/l", "ui/l", "units/l", "unit/l", "iu/ml"],
  "mIU/L": ["miu/l", "uiu/ml", "µiu/ml", "mui/l", "ulu/ml", "µui/ml", "mu/l", "uu/ml", "µu/ml"],
  "mg/dL": ["mg/dl", "mg/100ml", "mg%", "mg/dl."],
  "mmol/L": ["mmol/l", "mmol/l."],
  "µmol/L": ["umol/l", "µmol/l", "micromol/l", "mcmol/l"],
  "nmol/L": ["nmol/l"],
  "pmol/L": ["pmol/l"],
  "g/dL": ["g/dl", "g/100ml", "gm/dl", "g%"],
  "g/L": ["g/l"],
  "mg/L": ["mg/l"],
  "µg/dL": ["ug/dl", "µg/dl", "mcg/dl"],
  "µg/L": ["ug/l", "µg/l", "mcg/l"],
  "ng/mL": ["ng/ml"],
  "pg/mL": ["pg/ml"],
  "ng/dL": ["ng/dl"],
  "%": ["%", "percent", "pct"],
  fL: ["fl"],
  pg: ["pg"],
  "mmol/mol": ["mmol/mol"],
  "mL/min/1.73m²": ["ml/min/1.73m2", "ml/min/1.73", "ml/min/1.73m^2", "ml/min/1.73 m2", "ml/min/1,73", "ml/min/1.73m²", "ml/min"],
};

const squash = (u: string) =>
  u
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/μ|µ/g, "u")
    .replace(/×/g, "x")
    .replace(/²/g, "2")
    .replace(/³/g, "3")
    .replace(/⁶/g, "6")
    .replace(/⁹/g, "9")
    .replace(/¹²/g, "12")
    .replace(/\.$/, "");

const UNIT_LOOKUP = new Map<string, string>();
for (const [canon, spellings] of Object.entries(UNIT_SPELLINGS)) {
  UNIT_LOOKUP.set(squash(canon), canon);
  for (const s of spellings) UNIT_LOOKUP.set(squash(s), canon);
}

/** Canonical spelling for a printed unit; unknown spellings come back trimmed. */
export const normaliseUnit = (units: string | null | undefined): string | null => {
  const raw = (units ?? "").trim();
  if (!raw) return null;
  return UNIT_LOOKUP.get(squash(raw)) ?? raw;
};

/* ------------------------------ conversions ------------------------------ */

/** Display unit, conversions from other units, and decimals to print in the display unit. */
type Convert = { to: string; decimals: number; from: Record<string, (v: number) => number> };

const lipid = (): Convert => ({ to: "mg/dL", decimals: 0, from: { "mmol/L": (v) => v * 38.67 } });
const count = (): Convert => ({ to: "K/µL", decimals: 1, from: { "cells/µL": (v) => v / 1000 } });
const gdl = (): Convert => ({ to: "g/dL", decimals: 1, from: { "g/L": (v) => v / 10 } });

/**
 * Display unit and conversions, by canonical biomarker key
 * (utils/labBiomarkers ALIASES). Factors are the standard molar masses.
 */
export const CONVERSIONS: Record<string, Convert> = {
  glucose: { to: "mg/dL", decimals: 0, from: { "mmol/L": (v) => v * 18.016 } },
  tcl: lipid(),
  hdl: lipid(),
  ldl: lipid(),
  "non hdl cholesterol": lipid(),
  vldl: lipid(),
  triglycerides: { to: "mg/dL", decimals: 0, from: { "mmol/L": (v) => v * 88.57 } },
  creatinine: { to: "mg/dL", decimals: 2, from: { "µmol/L": (v) => v / 88.4 } },
  urea: { to: "mg/dL", decimals: 0, from: {} }, // BUN vs urea differ by 2.14 — printed as-is, see notes
  albumin: gdl(),
  "total protein": gdl(),
  globulin: gdl(),
  hemoglobin: { to: "g/dL", decimals: 1, from: { "g/L": (v) => v / 10, "mmol/L": (v) => v * 1.611 } },
  "bilirubin total": { to: "mg/dL", decimals: 2, from: { "µmol/L": (v) => v / 17.1 } },
  "bilirubin direct": { to: "mg/dL", decimals: 2, from: { "µmol/L": (v) => v / 17.1 } },
  calcium: { to: "mg/dL", decimals: 1, from: { "mmol/L": (v) => v * 4.008 } },
  iron: { to: "µg/dL", decimals: 0, from: { "µmol/L": (v) => v * 5.585 } },
  tibc: { to: "µg/dL", decimals: 0, from: { "µmol/L": (v) => v * 5.585 } },
  uibc: { to: "µg/dL", decimals: 0, from: { "µmol/L": (v) => v * 5.585 } },
  "vitamin d": { to: "ng/mL", decimals: 0, from: { "nmol/L": (v) => v / 2.496 } },
  "vitamin b12": { to: "pg/mL", decimals: 0, from: { "pmol/L": (v) => v * 1.355, "ng/L": (v) => v } },
  folate: { to: "ng/mL", decimals: 1, from: { "nmol/L": (v) => v / 2.266, "µg/L": (v) => v } },
  ferritin: { to: "ng/mL", decimals: 0, from: { "µg/L": (v) => v, "pmol/L": (v) => v * 2.247 } },
  crp: { to: "mg/L", decimals: 1, from: { "mg/dL": (v) => v * 10 } },
  hba1c: { to: "%", decimals: 1, from: { "mmol/mol": (v) => v / 10.929 + 2.15 } }, // NGSP ↔ IFCC
  tsh: { to: "mIU/L", decimals: 2, from: {} }, // mIU/L and µIU/mL are the same number
  cortisol: { to: "µg/dL", decimals: 1, from: { "nmol/L": (v) => v / 27.59 } },
  "free t4": { to: "ng/dL", decimals: 2, from: { "pmol/L": (v) => v / 12.87 } },
  wbc: count(),
  platelets: count(),
  "lymphocytes absolute": count(),
  "neutrophils absolute": count(),
  "monocytes absolute": count(),
  "eosinophils absolute": count(),
  "basophils absolute": count(),
  rbc: { to: "M/µL", decimals: 2, from: {} },
};

/* -------------------------------- parsing -------------------------------- */

export type ParsedResult = {
  /** Numeric value, or null when the result is not a number ("NEGATIVE"). */
  value: number | null;
  /** "<" or ">" when the lab printed a detection limit rather than a value. */
  censored: "<" | ">" | null;
};

/** "5.1" → 5.1 · "<0.5" → 0.5 censored "<" · "1,015" → 1.015 · "NEGATIVE" → null. */
export const parseResult = (result: string | null | undefined): ParsedResult => {
  const raw = String(result ?? "").trim();
  const m = raw.match(/^(<|>|≤|≥|<=|>=)?\s*(-?\d+(?:[.,]\d+)?)/);
  if (!m) return { value: null, censored: null };
  const value = parseFloat(m[2].replace(",", "."));
  if (!Number.isFinite(value)) return { value: null, censored: null };
  const c = m[1];
  return { value, censored: c ? (c.startsWith("<") || c === "≤" ? "<" : ">") : null };
};

/** Print a converted number with the display unit's decimals, trailing zeros dropped. */
const round = (v: number, decimals: number) => String(Number(v.toFixed(decimals)));

/** Apply `fn` to every number in a printed range ("3.9-6.1", "<5.2", "≥ 1.0"). */
export const convertRange = (range: string | null | undefined, fn: (v: number) => number, decimals = 1): string => {
  const raw = String(range ?? "");
  if (!raw.trim()) return raw;
  // Strip a trailing unit if the lab printed one inside the range ("<200 mg/dL").
  return raw
    .replace(/\s*(mg\/dl|mmol\/l|g\/l|g\/dl|[uµ]mol\/l|nmol\/l|pmol\/l|cells\/[uµ]l|x?10[e^]?\d+\/[ul]l?|thousand\/[uµ]l)\s*$/i, "")
    .replace(/-?\d+(?:[.,]\d+)?/g, (n) => round(fn(parseFloat(n.replace(",", "."))), decimals));
};

/* ------------------------------ canonicalise ----------------------------- */

export type Printed = { result: string; units: string | null; referenceRange: string };

export type Canonical = {
  result: string;
  units: string | null;
  referenceRange: string;
  value: number | null;
  censored: "<" | ">" | null;
  /** True when the number itself changed (unit conversion), not just the unit's spelling. */
  converted: boolean;
  /** What the report printed, when anything (number or unit text) was changed. */
  printed: Printed | null;
};

/**
 * One value in its biomarker's display unit. Unknown units, unknown
 * biomarkers and non-numeric results pass through with the printed unit
 * spelling normalised.
 */
export const canonicalise = (key: string, result: string, units: string | null | undefined, referenceRange: string): Canonical => {
  const printedUnits = (units ?? "").trim() || null;
  const unit = normaliseUnit(units);
  const { value, censored } = parseResult(result);
  const printed: Printed = { result, units: printedUnits, referenceRange };
  const base = (over: Partial<Canonical>): Canonical => ({
    result,
    units: unit,
    referenceRange,
    value,
    censored,
    converted: false,
    printed: unit !== printedUnits ? printed : null,
    ...over,
  });

  const conv = CONVERSIONS[key];
  if (!conv || value === null || !unit || unit === conv.to) return base({});
  const fn = conv.from[unit];
  if (!fn) return base({});
  const v = fn(value);
  const prefix = censored ?? "";
  return base({
    result: `${prefix}${round(v, conv.decimals)}`,
    units: conv.to,
    referenceRange: convertRange(referenceRange, fn, conv.decimals),
    value: v,
    converted: true,
    printed,
  });
};
