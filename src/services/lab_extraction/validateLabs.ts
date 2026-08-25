/**
 * Deterministic checks on model-extracted lab values.
 * The model copies values; the code decides whether they are trustworthy:
 *  - numeric parse of the result
 *  - reference-range parse ("70-99", "<200", "≥ 40", "3.4-10.8 x10E3/uL", "Negative")
 *  - isOutOfRange computed here, never taken from the model when the range parses
 *  - the printed result must appear in the PDF row the model says it came from
 */

export type ParsedRange =
  | { kind: "between"; min: number; max: number }
  | { kind: "below"; max: number; inclusive: boolean }
  | { kind: "above"; min: number; inclusive: boolean }
  | { kind: "text"; value: string }
  | { kind: "none" } // "Not Estab.", "N/A" — no interval exists for this test
  | null;

const NUM = "(-?\\d+(?:[.,]\\d+)?)";
const toNum = (s: string) => parseFloat(s.replace(",", "."));

export const parseNumericResult = (result: string): number | null => {
  if (!result) return null;
  // Microscopy-style "NONE" / "NONE SEEN" / "ABSENT" is a count of zero
  if (/^(none|none seen|absent|nil|0 seen)\b/i.test(result.trim())) return 0;
  const s = result.trim().replace(/,/g, ".");
  // Reject inequality/range-looking results — those are ranges, not values
  if (/^[<>≤≥]/.test(s) || /\d\s*[-–—]\s*\d/.test(s)) return null;
  const m = s.match(/^-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  return Number.isFinite(n) ? n : null;
};

export const parseReferenceRange = (range: string): ParsedRange => {
  if (!range) return null;
  const s = range
    .trim()
    .replace(/,(?=\d{1,2}\b)/g, ".")
    .replace(/<\s*or\s*=\s*/i, "≤")
    .replace(/>\s*or\s*=\s*/i, "≥");
  if (/^(not\s*estab\.?(lished)?|n\/?a|none|not applicable|not established|see (below|note|comment)|-+)$/i.test(s))
    return { kind: "none" };
  let m: RegExpMatchArray | null;
  if ((m = s.match(new RegExp(`^${NUM}\\s*(?:-|–|—|to)\\s*${NUM}`)))) {
    const min = toNum(m[1]), max = toNum(m[2]);
    if (max > min) return { kind: "between", min, max };
  }
  if ((m = s.match(new RegExp(`^(<|≤|<=|less than)\\s*${NUM}`, "i"))))
    return { kind: "below", max: toNum(m[2]), inclusive: /≤|<=/.test(m[1]) };
  if ((m = s.match(new RegExp(`^(>|≥|>=|greater than|more than)\\s*${NUM}`, "i"))))
    return { kind: "above", min: toNum(m[2]), inclusive: /≥|>=/.test(m[1]) };
  if ((m = s.match(new RegExp(`^${NUM}\\s*(?:or|and)\\s*(?:less|lower|below)`, "i"))))
    return { kind: "below", max: toNum(m[1]), inclusive: true };
  if ((m = s.match(new RegExp(`^${NUM}\\s*(?:or|and)\\s*(?:more|higher|above|greater)`, "i"))))
    return { kind: "above", min: toNum(m[1]), inclusive: true };
  if (/^(negative|non[- ]?reactive|not detected|normal|absent|none)/i.test(s))
    return { kind: "text", value: s.toLowerCase() };
  return null;
};

/** "<0.5" / ">1000" — a censored value at the assay limit. */
export const parseLimitResult = (result: string): { op: "<" | ">"; value: number } | null => {
  const m = (result || "").trim().replace(",", ".").match(/^(<|≤|<=|>|≥|>=)\s*(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  return { op: m[1].startsWith("<") || m[1] === "≤" ? "<" : ">", value: parseFloat(m[2]) };
};

/** null when it cannot be decided from the data. */
export const computeOutOfRange = (
  result: string,
  range: ParsedRange
): boolean | null => {
  if (!range) return null;
  if (range.kind === "none") return false;
  const limit = parseLimitResult(result);
  if (limit && range.kind !== "text") {
    // "<0.5" against "<3.0": everything below 0.5 is below 3.0 → in range.
    // "<36.0" against "0.0-35.9": the assay's cut-off IS the upper bound → in range.
    if (limit.op === "<") {
      if (range.kind === "below") return limit.value <= range.max ? false : null;
      if (range.kind === "between")
        return limit.value <= range.min ? true : limit.value <= range.max * 1.01 + 0.15 ? false : null;
      if (range.kind === "above") return limit.value <= range.min ? true : null;
    } else {
      if (range.kind === "above") return limit.value >= range.min ? false : null;
      if (range.kind === "between") return limit.value >= range.max ? true : null;
      if (range.kind === "below") return limit.value >= range.max ? true : null;
    }
  }
  if (range.kind === "text") {
    const r = result.trim().toLowerCase();
    if (!r) return null;
    if (/\b(negative|non[- ]?reactive|not detected|normal|absent|none|undetectable)\b/.test(r)) return false;
    if (/\b(positive|reactive|detected|abnormal|present|equivocal|indeterminate)\b/.test(r)) return true;
    return null;
  }
  const v = parseNumericResult(result);
  if (v === null) return null;
  switch (range.kind) {
    case "between":
      return v < range.min || v > range.max;
    case "below":
      return range.inclusive ? v > range.max : v >= range.max;
    case "above":
      return range.inclusive ? v < range.min : v <= range.min;
  }
};

const norm = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9%]+/g, " ").trim();

/** Does the row contain the result as a standalone number token? */
const rowHasResult = (row: string, result: string): boolean => {
  if (/^(none|none seen|absent|nil)\b/i.test(result.trim())) return /\b(none|absent|nil)\b/i.test(row);
  const v = parseNumericResult(result) ?? parseLimitResult(result)?.value ?? null;
  const r = row.replace(/,/g, ".");
  if (v === null) return norm(row).includes(norm(result)) && norm(result).length > 0;
  const tokens = r.match(/-?\d+(?:\.\d+)?/g) ?? [];
  return tokens.some((t) => Math.abs(parseFloat(t) - v) < 1e-9);
};

/** Does the row mention the test name (≥ half of its meaningful tokens)? */
const rowHasName = (row: string, testType: string): boolean => {
  const nr = norm(row);
  const tokens = norm(testType).split(" ").filter((t) => t.length > 1);
  if (tokens.length === 0) return false;
  const hits = tokens.filter((t) => nr.includes(t)).length;
  return hits / tokens.length >= 0.5;
};

const QUALITATIVE = /^(trace|turbid|cloudy|clear|hazy|positive|negative|reactive|non-?reactive|small|moderate|large|abnormal|normal|present|absent|detected|not detected|none seen|yellow|dark yellow|amber|straw|red|brown|orange)$/i;

/** "123H", "8.5 L", "TRACEA", "TURBIDA" — abnormal-flag letters printed after the value. */
export const stripFlag = (raw: string): string => {
  const s = raw.trim();
  const num = s.match(/^(-?\d+(?:[.,]\d+)?)\s*(?:[HLA*]|HH|LL|H\*|L\*)$/i);
  if (num) return num[1];
  const qual = s.match(/^(.*?)\s*([HLA])$/);
  if (qual && QUALITATIVE.test(qual[1])) return qual[1];
  return s;
};

export type ExtractedEntry = {
  rowNumber: number | null;
  testType: string;
  category: string;
  result: string;
  referenceRange: string;
  units: string;
  aboutTestType: string;
  isOutOfRange: boolean; // model's opinion — overridden when the range parses
};

export type ValidatedEntry = ExtractedEntry & {
  needsReview: boolean;
  reviewReason: string | null;
  sourceRow: string | null;
};

export const validateEntries = (
  entries: ExtractedEntry[],
  rows: string[],
  opts: { verifySource?: boolean } = {}
): ValidatedEntry[] => {
  const verifySource = opts.verifySource !== false;
  const seen = new Set<string>();
  const out: ValidatedEntry[] = [];
  for (const e of entries) {
    const reasons: string[] = [];
    // "123H", "8.5 L", "3.4L" — lab flag letters printed after the value are not the value
    const result = stripFlag((e.result ?? "").toString());
    const numeric = parseNumericResult(result);
    const range = parseReferenceRange(e.referenceRange ?? "");

    // Dedupe identical test+result pairs the model may emit twice
    const key = `${norm(e.testType)}|${result}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // 1. Value must be a value
    if (!result) reasons.push("no result value");
    else if (numeric === null && !parseLimitResult(result) && !(range && range.kind === "text"))
      reasons.push("result is not a number");

    // 2. Locate the source row: the model's rowNumber first, then search
    let sourceRow: string | null = null;
    const claimed = e.rowNumber != null ? rows[e.rowNumber - 1] : undefined;
    if (claimed && rowHasResult(claimed, result)) sourceRow = claimed;
    else {
      const candidates = rows.filter((r) => rowHasName(r, e.testType) && rowHasResult(r, result));
      if (candidates.length > 0) sourceRow = candidates[0];
    }
    if (verifySource && !sourceRow && result) reasons.push("value not found next to the test name in the PDF");

    // 3. Out-of-range decided in code when possible
    let isOutOfRange = !!e.isOutOfRange;
    const computed = computeOutOfRange(result, range);
    if (computed !== null) isOutOfRange = computed;
    else if (e.referenceRange) reasons.push("reference range could not be parsed");

    out.push({
      ...e,
      result,
      isOutOfRange,
      needsReview: reasons.length > 0,
      reviewReason: reasons.length ? reasons.join("; ") : null,
      sourceRow,
    });
  }
  return out;
};
