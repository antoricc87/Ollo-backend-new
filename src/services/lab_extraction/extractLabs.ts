/**
 * Lab report extraction pipeline (replaces pdf-parse → gpt-4o-mini prompt).
 *
 *   PDF ─► layout rows (pdf.js coords) ─► collection date (pre-redaction)
 *       ─► PII redaction per row ─► model: copy values row-by-row (strict schema)
 *       ─► code-side validation (numeric, range parse, out-of-range, source-row
 *          verification) ─► entries with needsReview flags
 *
 * Model is configurable via LAB_EXTRACTION_MODEL (default gpt-4.1). The
 * legacy path stays reachable with LAB_EXTRACTION_ENGINE=legacy.
 */
import OpenAI from "openai";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { extractPdfLayout, PdfLayout } from "./pdfLayout";
import { detectCollectionDate, redactPIIText } from "../../utils/redactPI";
import { validateEntries, ValidatedEntry } from "./validateLabs";
import { LabCategoryEnum } from "../openAI/schemas/openai.schema";
import { getPatientById } from "../patient/model/patient.model";
import { calculateAgeFromDob } from "../../utils/calculateAgefromDob";
import { modelRequestParams } from "../meal_analysis/mealAnalysis.service";
import { extractLabsVision } from "./extractLabsVision";

export const DEFAULT_LAB_MODEL = process.env.LAB_EXTRACTION_MODEL || "gpt-4.1";

let client: OpenAI | null = null;
const getClient = () => {
  if (!client) client = new OpenAI({ apiKey: process.env.REACT_APP_OPENAI_API_KEY || "" });
  return client;
};

const ExtractionSchema = z.object({
  labResults: z.array(
    z.object({
      rowNumber: z.number().int().nullable(),
      testType: z.string(),
      category: LabCategoryEnum,
      result: z.string(),
      referenceRange: z.string(),
      units: z.string(),
      isOutOfRange: z.boolean(),
      aboutTestType: z.string(),
    })
  ),
  labReport: z.string(),
  recommendations: z.object({ nutrition: z.string(), exercise: z.string() }),
});

export type LabExtractionResult = {
  labResults: ValidatedEntry[];
  labReport: string;
  recommendations: { nutrition: string; exercise: string };
  collectedAt: Date | null;
  collectedAtDetected: boolean;
  extraction: {
    engine: "layout" | "vision";
    model: string;
    pages: number;
    rowCount: number;
    isScanned: boolean;
    reviewCount: number;
    /** Result-looking rows the first pass did not cite (triggered a second pass). */
    uncapturedRows: number;
    secondPassAdded: number;
    /** Vision path only: entries the independent second read confirmed / corrected / added. */
    visionConfirmed?: number;
    visionCorrected?: number;
    visionAdded?: number;
    latencyMs: number;
  };
};

/** A row with a number and something range-like next to it. */
const looksLikeResultRow = (row: string): boolean => {
  if (!/\d/.test(row)) return false;
  const hasRange = /\d\s*[-–—]\s*\d|[<>≤≥]\s*\d|\b(negative|non[- ]?reactive|not detected)\b/i.test(row);
  const hasLetters = /[a-z]{3,}/i.test(row);
  // Interpretation legends ("Negative | <36.0", "Prediabetes: 5.7 - 6.4") are not results
  const legend = /^\s*(negative|positive|equivocal|indeterminate|normal|abnormal|prediabetes|diabetes|glycemic|optimal|borderline|high|low|desirable|moderate|increased|decreased|comment|note|\*|=|cortisol (am|pm))\b/i.test(row);
  return hasRange && hasLetters && !legend;
};

export class ScannedPdfError extends Error {
  constructor() {
    super("This PDF has no readable text layer (it looks like a scanned image). Please upload the original digital report.");
    this.name = "ScannedPdfError";
  }
}

const SYSTEM_PROMPT = `You are a meticulous clinical data-entry assistant. You receive the rows of a laboratory report, one per line, numbered, with column boundaries marked by " | ". Personal identifiers and dates have already been replaced with [REDACTED].

YOUR JOB: transcribe every measured test result into structured JSON. Copy, never compute or infer.

RULES
1. One entry per row that contains a test name AND a measured value. Skip headers, footers, comments, panel titles, and rows with no measurement.
2. rowNumber = the number of the row you copied the value from.
3. result = the patient's measured value EXACTLY as printed (e.g. "5.3", "<0.5", "Negative"). Never put a range or an inequality-style limit in result. If a row has current and previous values, the CURRENT value is the one in the result column (usually the first value after the test name); ignore previous values and their dates. Never merge digits from adjacent cells.
4. referenceRange = the reference interval exactly as printed for THAT row ("70-99", "<200", "≥ 40", "Negative", "Not Estab."). Some labs print the interval on the row(s) immediately BELOW the value (e.g. "Cortisol | 8.4 | ug/dL" then "Cortisol AM | 6.2 - 19.4" / "Cortisol PM | 2.3 - 11.9"): use the interval that applies — for time-of-day ranges use AM unless the report states an afternoon collection. Some labs print the test name on one row and the value on the next (the value row may start with a site code like "C, 01"): pair them. Empty string only if no interval is printed anywhere near the row.
5. units = exactly as printed ("mg/dL", "x10E3/uL", "%"). Empty string if none.
6. testType = the test name as printed, but use these canonical names when they apply: "HDL", "LDL", "TCL" (total cholesterol), "Triglycerides", "Glucose", "HbA1c", "Albumin", "Creatinine", "CRP", "RDW", "WBC", "MCV", "Lymphocytes", "Alkaline Phosphatase".
7. category = the best fit from the allowed list.
8. isOutOfRange = your best reading of the row's flag (H/L/*/abnormal marker or comparison to the range). It will be re-checked.
9. aboutTestType = one plain-language sentence explaining what the test measures.
10. Do not drop normal results. Do not invent tests that are not on the page.

AFTER the entries, write:
- labReport: a structured, patient-friendly summary. For each out-of-range value: "Your [test] is [value] ([reference range]). [What it means]. [Sensible next step]." Then, only if the abnormalities form a recognisable pattern (e.g. metabolic syndrome, iron-deficiency anaemia), one cautious synthesis paragraph ("This pattern may suggest…"). Never diagnose.
- recommendations.nutrition: diet advice tied to specific abnormal results, each linked to the finding it addresses; conditional phrasing when the cause is unconfirmed; if nothing evidence-based applies, say so and refer to the provider.
- recommendations.exercise: 1-2 specific, evidence-based activity recommendations tied to the abnormal results (type, frequency, benefit); if none applies, say so.
Prioritise clinically significant findings (lipids, A1c, glucose, kidney, liver) over borderline ones.`;

export const extractLabReport = async (
  file: Buffer | Uint8Array,
  ctx: { firstName: string; lastName: string; dob: string; patientId: string; model?: string }
): Promise<LabExtractionResult> => {
  const started = Date.now();
  const layout: PdfLayout = await extractPdfLayout(file);
  if (layout.isScanned) {
    if (process.env.LAB_VISION_FALLBACK === "false") throw new ScannedPdfError();
    const v = await extractLabsVision(file, { model: ctx.model });
    return {
      labResults: v.labResults,
      labReport: v.labReport,
      recommendations: v.recommendations,
      collectedAt: v.collectedAt,
      collectedAtDetected: !!v.collectedAt,
      extraction: {
        engine: "vision",
        model: ctx.model || DEFAULT_LAB_MODEL,
        pages: layout.pages,
        rowCount: 0,
        isScanned: true,
        reviewCount: v.labResults.filter((l) => l.needsReview).length,
        uncapturedRows: 0,
        secondPassAdded: 0,
        visionConfirmed: v.confirmedCount,
        visionCorrected: v.correctedCount,
        visionAdded: v.addedCount,
        latencyMs: Date.now() - started,
      },
    };
  }

  const collectedAt = detectCollectionDate(layout.text, ctx.dob);
  const redactedRows = layout.rows.map((r) =>
    redactPIIText(r.text, ctx.firstName, ctx.lastName, ctx.dob)
  );

  const patient = await getPatientById(ctx.patientId);
  const patientContext = patient
    ? {
        gender: patient.gender ?? "unknown",
        age: calculateAgeFromDob(patient.dob),
        conditions: patient.patientSummary?.conditions?.map((c: any) => c.condition.name) ?? [],
        medications: patient.patientSummary?.medications?.map((m: any) => m.medication.name) ?? [],
      }
    : {};

  const numbered = redactedRows.map((r, i) => `${i + 1}. ${r}`).join("\n");
  const model = ctx.model || DEFAULT_LAB_MODEL;
  const response = await getClient().responses.parse({
    model,
    ...(modelRequestParams(model) as any),
    input: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `PATIENT CONTEXT (for the summary only): ${JSON.stringify(patientContext)}\n\nREPORT ROWS (${redactedRows.length} rows, ${layout.pages} page(s)):\n${numbered}`,
      },
    ],
    text: { format: zodTextFormat(ExtractionSchema, "lab_extraction") },
  });
  const parsed = response.output_parsed;
  if (!parsed) throw new Error("Lab extraction returned no structured output");

  let labResults = validateEntries(parsed.labResults, redactedRows);

  // Completeness net: result-looking rows the model never cited get one
  // targeted second pass. Weaker models tend to skip normal rows silently.
  const cited = new Set(labResults.map((l) => l.sourceRow).filter(Boolean) as string[]);
  const uncaptured = redactedRows
    .map((row, i) => ({ row, n: i + 1 }))
    .filter(({ row }) => looksLikeResultRow(row) && !cited.has(row));
  let secondPassAdded = 0;
  if (uncaptured.length > 0) {
    const retry = await getClient().responses.parse({
      model,
      ...(modelRequestParams(model) as any),
      input: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `These rows from the same report were not transcribed in a first pass. Transcribe every one that contains a test name and a measured value; return an empty labResults array if none do. Keep the original row numbers.\n\n${uncaptured
            .map(({ row, n }) => `${n}. ${row}`)
            .join("\n")}`,
        },
      ],
      text: { format: zodTextFormat(ExtractionSchema, "lab_extraction_retry") },
    });
    const extra = retry.output_parsed?.labResults ?? [];
    if (extra.length) {
      const known = new Set(labResults.map((l) => `${l.testType.toLowerCase()}|${l.result}`));
      const merged = validateEntries(extra, redactedRows).filter(
        (l) => !known.has(`${l.testType.toLowerCase()}|${l.result}`)
      );
      secondPassAdded = merged.length;
      labResults = [...labResults, ...merged];
    }
  }

  return {
    labResults,
    labReport: parsed.labReport,
    recommendations: parsed.recommendations,
    collectedAt,
    collectedAtDetected: !!collectedAt,
    extraction: {
      engine: "layout",
      model,
      pages: layout.pages,
      rowCount: layout.rows.length,
      isScanned: layout.isScanned,
      reviewCount: labResults.filter((l) => l.needsReview).length,
      uncapturedRows: uncaptured.length,
      secondPassAdded,
      latencyMs: Date.now() - started,
    },
  };
};
