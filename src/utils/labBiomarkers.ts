/**
 * Lab biomarker helpers — the "current picture" of a patient's labs.
 *
 * Each uploaded PDF becomes one LabResultSummary (a report) with its own
 * LabResult rows. Reports never overlap-merge in the DB, so any consumer that
 * reads `labResults[0]` only sees the newest upload. These helpers build the
 * merged view instead: for every biomarker (normalised across the naming
 * variants the extractor produces) the most recent value, dated by the
 * report's collection date, plus its history.
 */

export type LabEntryLike = {
  id: string;
  category: string;
  testType: string;
  referenceRange: string;
  isOutOfRange: boolean;
  result: string;
  units?: string | null;
  aboutTestType?: string | null;
};

export type LabReportLike = {
  id: string;
  createdAt: Date | string;
  collectedAt?: Date | string | null;
  labReport?: string | null;
  recommendations?: unknown;
  labResults: LabEntryLike[];
};

export type LabHistoryPoint = {
  reportId: string;
  collectedAt: string; // ISO
  result: string;
  units: string | null;
  referenceRange: string;
  isOutOfRange: boolean;
};

export type CurrentBiomarker = LabEntryLike & {
  key: string; // canonical biomarker key
  reportId: string;
  collectedAt: string; // ISO — the date of the report the value comes from
  history: LabHistoryPoint[]; // newest first, includes the current value
};

/* ----------------------------- Canonical keys ------------------------------ */

// Aliases the extractor is known to emit for the same biomarker. Keys and
// values are compared after `normalise()`.
const ALIASES: Record<string, string[]> = {
  hdl: ["colesterolo hdl", "hdl colesterolo", "hdl", "hdl cholesterol", "high density lipoprotein", "hdl-c", "cholesterol hdl"],
  ldl: ["colesterolo ldl", "ldl colesterolo", "ldl", "lcl", "ldl cholesterol", "low density lipoprotein", "ldl-c", "cholesterol ldl", "ldl calc", "ldl calculated"],
  tcl: ["colesterolo totale", "colesterolo", "tcl", "total cholesterol", "cholesterol total", "cholesterol", "cholesterol, total"],
  triglycerides: ["trigliceridi", "triglyceridi", "trigliceridis", "triglicerides", "triglycerides", "triglyceride", "tg"],
  glucose: ["glucosio", "glicemia", "glucose", "fasting glucose", "glucose fasting", "blood glucose", "glucose, fasting"],
  hba1c: ["emoglobina glicata", "emoglobina glicosilata", "hba1c", "a1c", "hemoglobin a1c", "haemoglobin a1c", "glycated hemoglobin", "glycated haemoglobin"],
  albumin: ["albumina", "albumin", "albumin serum"],
  creatinine: ["creatinina", "creatinine", "creatinine serum"],
  crp: ["proteina c reattiva", "proteina c reattiva pcr", "pcr", "crp", "c reactive protein", "c-reactive protein", "hs-crp", "hs crp", "high sensitivity crp"],
  rdw: ["rdw", "red cell distribution width", "rdw-cv"],
  wbc: ["leucociti", "leucociti wbc", "globuli bianchi", "wbc", "white blood cell count", "white blood cells", "leukocytes", "white cell count"],
  rbc: ["eritrociti", "globuli rossi", "rbc", "red blood cell count", "red blood cells", "erythrocytes"],
  mcv: ["mcv", "mean corpuscular volume"],
  // Differential: percentage and absolute count are DIFFERENT biomarkers
  lymphocytes: ["linfociti", "lymphs", "lymphocyte", "lymphocytes", "lymphocyte count", "lympocite", "lymphs %", "lymphocytes %"],
  "lymphocytes absolute": ["lymphocyte absolute", "lymphs absolute", "lympocite absolute", "lymphocyte (absolute)", "lymphs (absolute)", "absolute lymphocytes", "abs lymphocytes", "lymphocytes abs", "linfociti assoluti"],
  neutrophils: ["neutrophils", "neutrophil", "neutrofili", "neut", "neutrophils %"],
  "neutrophils absolute": ["neutrophils (absolute)", "neutrophils absolute", "absolute neutrophils", "abs neutrophils", "neutrophils abs", "anc", "neutrofili assoluti"],
  monocytes: ["monocytes", "monocyte", "monociti", "mono", "monocytes %"],
  "monocytes absolute": ["monocytes (absolute)", "monocytes(absolute)", "monocytes absolute", "absolute monocytes", "abs monocytes", "monociti assoluti"],
  eosinophils: ["eosinophils", "eosinophil", "eos", "eosinofili", "eosinophils %"],
  "eosinophils absolute": ["eos (absolute)", "eosinophils (absolute)", "eosinophils absolute", "absolute eosinophils", "abs eosinophils", "eosinofili assoluti"],
  basophils: ["basophils", "basophil", "basos", "baso", "basofili", "basophils %"],
  "basophils absolute": ["baso (absolute)", "basos (absolute)", "basophils (absolute)", "basophils absolute", "absolute basophils", "abs basophils", "basofili assoluti"],
  "alkaline phosphatase": ["fosfatasi alcalina", "alkaline phosphatase", "alp", "alk phos"],
  "vitamin d": ["vitamina d", "vitamina d 25-oh", "vitamina d (25-oh)", "25-oh vitamina d", "vitamin d 25-oh total", "vitamin d, 25-oh, total", "vitamin d 25 oh total", "vitamin d (25-oh) total", "vitamin d", "25-oh vitamin d", "25 oh vitamin d", "vitamin d 25-hydroxy", "vitamin d, 25-hydroxy", "25-hydroxyvitamin d", "25 hydroxy vitamin d", "vitamin d (25-oh)", "vitamin d 25-oh", "25(oh)d", "25-oh d", "vitamin d total", "vitamin d3", "vitamin d 25 hydroxy total"],
  "vitamin b12": ["vitamina b12", "vitamin b12", "b12", "cobalamin"],
  ferritin: ["ferritina", "ferritin"],
  tsh: ["tireotropina", "tsh w/reflex to ft4", "tsh w reflex to ft4", "tsh with reflex", "tsh reflex", "tsh rfx", "tsh", "thyroid stimulating hormone"],
  hemoglobin: ["emoglobina", "hemoglobin", "haemoglobin", "hgb", "hb"],
  hematocrit: ["ematocrito", "hematocrit", "haematocrit", "hct"],
  platelets: ["piastrine", "platelets", "platelet count", "plt"],
  mpv: ["mpv", "mean platelet volume"],
  mch: ["mch", "mean corpuscular hemoglobin"],
  mchc: ["mchc", "mean corpuscular hemoglobin concentration"],
  "non hdl cholesterol": ["non hdl", "non hdl cholesterol", "non-hdl cholesterol", "non-hdl-c"],
  "vldl": ["vldl", "vldl cholesterol", "vldl cholesterol cal", "vldl cholesterol calc"],
  "chol hdl ratio": ["chol/hdlc ratio", "chol hdl ratio", "cholesterol hdl ratio", "tc/hdl ratio"],
  "total protein": ["protein total", "protein, total", "total protein", "proteine totali"],
  "globulin": ["globulin", "globulin total", "globulin, total", "globulin (calc)"],
  "albumin globulin ratio": ["albumin/globulin ratio", "a/g ratio", "albumin globulin ratio"],
  "bilirubin total": ["bilirubin total", "bilirubin, total", "total bilirubin", "bilirubina totale"],
  "bilirubin direct": ["bilirubin direct", "bilirubin, direct", "direct bilirubin", "bilirubina diretta"],
  "carbon dioxide": ["carbon dioxide", "carbon dioxide total", "carbon dioxide, total", "co2", "bicarbonate"],
  chloride: ["chloride", "cloro", "cl"],
  "bun creatinine ratio": ["bun/creatinine ratio", "bun creatinine ratio"],
  "free t4": ["free t4", "t4 free", "t4,free(direct)", "t4 free direct", "ft4", "thyroxine free"],
  folate: ["folate", "folic acid", "folate (folic acid), serum", "folate serum", "folati"],
  cortisol: ["cortisol", "cortisolo"],
  iron: ["iron", "ferro", "iron serum"],
  tibc: ["tibc", "iron bind.cap.(tibc)", "iron binding capacity", "total iron binding capacity"],
  uibc: ["uibc", "unsaturated iron binding capacity"],
  "iron saturation": ["iron saturation", "transferrin saturation", "saturazione transferrina"],
  sodium: ["sodio", "sodium", "na"],
  potassium: ["potassio", "potassium", "k"],
  calcium: ["calcio", "calcium", "ca"],
  alt: ["gpt", "alt gpt", "transaminasi gpt", "alt", "alanine aminotransferase", "sgpt"],
  ast: ["got", "ast got", "transaminasi got", "ast", "aspartate aminotransferase", "sgot"],
  ggt: ["ggt", "gamma gt", "gamma-glutamyl transferase"],
  urea: ["azotemia", "urea", "bun", "blood urea nitrogen"],
  egfr: ["egfr", "estimated gfr", "gfr"],
};

const normalise = (s: string) =>
  s
    .toLowerCase()
    .replace(/\(.*?\)/g, (m) => " " + m.slice(1, -1) + " ")
    .replace(/[^a-z0-9%]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const ALIAS_LOOKUP: Map<string, string> = new Map();
for (const [key, names] of Object.entries(ALIASES)) {
  ALIAS_LOOKUP.set(normalise(key), key);
  for (const n of names) ALIAS_LOOKUP.set(normalise(n), key);
}

const URINE_CATEGORY = /urin/i;
const URINE_IN_NAME = /\b(urine|urinary|ur)\b|\(u\)/i;

/**
 * Canonical key for a biomarker name; unknown names normalise to themselves.
 * Urinalysis results are scoped with a "urine " prefix so urine glucose /
 * WBC / protein never collide with the blood tests of the same name.
 */
export const canonicalBiomarkerKey = (testType: string, category?: string | null): string => {
  const raw = testType || "";
  const urine = (category ? URINE_CATEGORY.test(category) : false) || URINE_IN_NAME.test(raw);
  const cleaned = raw.replace(/\(\s*urine\s*\)|\burine\b|\burinary\b/gi, " ");
  const n = normalise(cleaned);
  // 1. exact alias; 2. name without parentheticals ("Trigliceridi (TG)");
  // 3. the parenthetical alone ("(TG)"); 4. the name itself
  const candidates = [
    n,
    normalise(cleaned.replace(/\(.*?\)/g, " ")),
    ...Array.from(cleaned.matchAll(/\(([^)]+)\)/g)).map((m) => normalise(m[1])),
  ].filter(Boolean);
  let key = n;
  for (const c of candidates) {
    const hit = ALIAS_LOOKUP.get(c);
    if (hit) { key = hit; break; }
  }
  return urine ? `urine ${key}` : key;
};

/* --------------------------------- Dates ----------------------------------- */

/** Effective test date of a report: collectedAt, falling back to upload time. */
export const reportDate = (report: Pick<LabReportLike, "createdAt" | "collectedAt">): Date =>
  new Date((report.collectedAt ?? report.createdAt) as any);

export type LabFreshness = "current" | "aging" | "stale";

export const FRESHNESS_MONTHS = { current: 6, aging: 12 } as const;

export const monthsBetween = (from: Date, to: Date): number => {
  const ms = to.getTime() - from.getTime();
  return ms / (1000 * 60 * 60 * 24 * 30.4375);
};

/** ≤6 months → current, ≤12 → aging, older → stale (retest). */
export const labFreshness = (collectedAt: Date | string, now: Date = new Date()): LabFreshness => {
  const months = monthsBetween(new Date(collectedAt as any), now);
  if (months <= FRESHNESS_MONTHS.current) return "current";
  if (months <= FRESHNESS_MONTHS.aging) return "aging";
  return "stale";
};

/* --------------------------------- Merge ----------------------------------- */

/** Reports sorted newest test date first (ties broken by upload time). */
export const sortReportsNewestFirst = <T extends LabReportLike>(reports: T[]): T[] =>
  [...reports].sort((a, b) => {
    const d = reportDate(b).getTime() - reportDate(a).getTime();
    if (d !== 0) return d;
    return new Date(b.createdAt as any).getTime() - new Date(a.createdAt as any).getTime();
  });

/**
 * Latest value per biomarker across all reports, with history.
 * Result is ordered: flagged first, then by category/name — callers regroup as needed.
 */
export const buildCurrentLabs = (reports: LabReportLike[]): CurrentBiomarker[] => {
  const byKey = new Map<string, CurrentBiomarker>();
  for (const report of sortReportsNewestFirst(reports ?? [])) {
    const collectedAt = reportDate(report).toISOString();
    for (const entry of report.labResults ?? []) {
      if (!entry || !entry.testType) continue;
      const key = canonicalBiomarkerKey(entry.testType, entry.category);
      const point: LabHistoryPoint = {
        reportId: report.id,
        collectedAt,
        result: entry.result,
        units: entry.units ?? null,
        referenceRange: entry.referenceRange,
        isOutOfRange: !!entry.isOutOfRange,
      };
      const existing = byKey.get(key);
      if (existing) {
        // Same report listing a biomarker twice (e.g. duplicate lines) — keep first.
        if (existing.reportId === report.id) continue;
        existing.history.push(point);
      } else {
        byKey.set(key, { ...entry, key, reportId: report.id, collectedAt, history: [point] });
      }
    }
  }
  return Array.from(byKey.values());
};

/**
 * Drop-in replacement for the old `labResults[0].labResults`: the merged
 * latest-per-biomarker entries, shaped like LabResult rows plus collectedAt.
 */
export const currentLabEntries = (reports: LabReportLike[] | null | undefined) =>
  buildCurrentLabs(reports ?? []).map(({ history, key, ...entry }) => entry);
