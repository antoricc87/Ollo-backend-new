/**
 * Vision fallback for scanned / photographed lab reports (no text layer).
 *
 * Pages are rendered here at ~180 dpi (pdfRender.ts) — letting the API
 * rasterise the PDF itself produced misreads of the small reference-range
 * print — and sent to a vision-capable model twice:
 *   pass 1 — PER SEGMENT (page, or overlapping strips of a page): transcribe
 *            every result row. Small segments stop the block-shift errors a
 *            whole-page read makes on "value between two labels" layouts.
 *   pass 2 — PER SEGMENT, independent VERIFY: re-read the segment against the
 *            entries claimed for it; confirm or question (never overwrite).
 * Only entries confirmed unchanged by pass 2 are trusted; corrections and
 * additions are kept but flagged needsReview. Source-row verification is not
 * possible here (there are no rows), so this double read replaces it.
 *
 * PRIVACY: a scanned PDF cannot be text-redacted, so the pages go to the
 * model with identifiers visible. Disable with LAB_VISION_FALLBACK=false.
 */
import OpenAI from "openai";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { LabCategoryEnum } from "../openAI/schemas/openai.schema";
import { modelRequestParams } from "../meal_analysis/mealAnalysis.service";
import { validateEntries, ValidatedEntry, ExtractedEntry } from "./validateLabs";
import { renderPdfPages, cutStrips, PageSegment } from "./pdfRender";

export const DEFAULT_LAB_VISION_MODEL =
  process.env.LAB_VISION_MODEL || process.env.LAB_EXTRACTION_MODEL || "gpt-4.1";
/** Independent second reader; a different model family catches correlated misreads. */
export const DEFAULT_LAB_VISION_VERIFY_MODEL = process.env.LAB_VISION_VERIFY_MODEL || "";
const RENDER_SCALE = Number(process.env.LAB_VISION_SCALE || 3);
/** Horizontal strips per page for transcription (1 = whole page). */
const STRIPS = Math.max(1, Number(process.env.LAB_VISION_STRIPS || 3));
const CONCURRENCY = 4;

const mapLimit = async <T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> => {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
};

let client: OpenAI | null = null;
const getClient = () => {
  if (!client) client = new OpenAI({ apiKey: process.env.REACT_APP_OPENAI_API_KEY || "" });
  return client;
};

const Entry = z.object({
  testType: z.string(),
  category: LabCategoryEnum,
  result: z.string(),
  referenceRange: z.string(),
  units: z.string(),
  isOutOfRange: z.boolean(),
  aboutTestType: z.string(),
  page: z.number().int().nullable(),
});

const TranscribeSchema = z.object({
  collectedAt: z.string().nullable(), // ISO date
  labResults: z.array(Entry),
  labReport: z.string(),
  recommendations: z.object({ nutrition: z.string(), exercise: z.string() }),
});

const VerifySchema = z.object({
  collectedAt: z.string().nullable(),
  checks: z.array(
    z.object({
      index: z.number().int(),
      confirmed: z.boolean(),
      correctedResult: z.string().nullable(),
      correctedReferenceRange: z.string().nullable(),
      correctedUnits: z.string().nullable(),
      note: z.string().nullable(),
    })
  ),
  missing: z.array(Entry),
});

const TRANSCRIBE_PROMPT = `You are a meticulous clinical data-entry assistant reading a scanned laboratory report. Transcribe every measured test result from every page. Copy values EXACTLY as printed — never compute, round, or infer. Do not put a range or an inequality limit in result. If a row shows current and previous values, take the current one. Use these canonical names when they apply: HDL, LDL, TCL (total cholesterol), Triglycerides, Glucose, HbA1c, Albumin, Creatinine, CRP, RDW, WBC, MCV, Lymphocytes, Alkaline Phosphatase; otherwise the name as printed. referenceRange and units exactly as printed ("" if none). page = page number the value is on. collectedAt = the sample collection date (Collected / Drawn / Data prelievo / Date of service) as YYYY-MM-DD, or null if not printed. Do not use the report/print date. Ignore patient identifiers entirely. Then write labReport (patient-friendly summary: for each out-of-range value "Your [test] is [value] ([range]). [Meaning]. [Next step]."; cautious synthesis only if a pattern is clear; never diagnose) and recommendations.nutrition / recommendations.exercise tied to specific abnormal findings (say when nothing evidence-based applies).`;

const VERIFY_PROMPT = `You are independently auditing a transcription of a scanned laboratory report. Re-read every page carefully. For EACH entry in the list below, check the result value, reference range and units against the page. Return one check per entry: confirmed=true only when all three match the page exactly; otherwise confirmed=false and give the corrected values EXACTLY as printed (correctedReferenceRange must be "" — an empty string, not null — when no interval is printed for that test; a flag letter like H/L/A after a value is NOT part of the value). Check that each entry's range belongs to ITS OWN row, not the row above or below — misaligned rows are the most common transcription error. Then list in "missing" any measured test on this page that is absent from the list. Also give collectedAt (sample collection date, YYYY-MM-DD, or null). Be strict: a single wrong digit is a mismatch.`;

export type VisionExtraction = {
  labResults: ValidatedEntry[];
  labReport: string;
  recommendations: { nutrition: string; exercise: string };
  collectedAt: Date | null;
  passes: 2;
  confirmedCount: number;
  correctedCount: number;
  addedCount: number;
};

const parseIso = (s: string | null | undefined): Date | null => {
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return isNaN(d.getTime()) || d.getTime() > Date.now() + 86400000 ? null : d;
};

export const extractLabsVision = async (
  file: Buffer | Uint8Array,
  opts: { model?: string; verifyModel?: string; filename?: string } = {}
): Promise<VisionExtraction> => {
  const model = opts.model || DEFAULT_LAB_VISION_MODEL;
  const pages = await renderPdfPages(file, { scale: RENDER_SCALE, maxPages: 20 });
  const verifyModel = opts.verifyModel || DEFAULT_LAB_VISION_VERIFY_MODEL || model;
  const imagePart = (p: { png: Buffer }) => ({
    type: "input_image",
    image_url: `data:image/png;base64,${p.png.toString("base64")}`,
    detail: "high",
  });

  const segments: PageSegment[] = (await Promise.all(pages.map((p) => cutStrips(p, STRIPS)))).flat();
  const segLabel = (sg: PageSegment) => sg.count > 1 ? `page ${sg.page}, strip ${sg.index + 1} of ${sg.count}` : `page ${sg.page}`;

  // Pass 1: transcribe each segment
  const transcribed = await mapLimit(segments, CONCURRENCY, async (sg) => {
    const r = await getClient().responses.parse({
      model,
      ...(modelRequestParams(model) as any),
      input: [
        { role: "system", content: TRANSCRIBE_PROMPT },
        {
          role: "user",
          content: [
            { type: "input_text", text: `This image is ${segLabel(sg)} of a ${pages.length}-page report${sg.count > 1 ? "; strips overlap slightly, so a row cut at the edge may be incomplete — transcribe only rows whose label AND value are fully visible" : ""}. Use page = ${sg.page}.` },
            imagePart(sg) as any,
          ],
        },
      ],
      text: { format: zodTextFormat(TranscribeSchema, "lab_vision_transcribe") },
    });
    return { sg, out: r.output_parsed };
  });

  // Merge segments: overlapping strips may repeat a row — same test+value → one entry;
  // same test, different value → keep the first and flag it.
  const merged: { e: z.infer<typeof Entry>; sg: PageSegment; note: string | null }[] = [];
  const keyOf = (e: z.infer<typeof Entry>) => `${e.page}|${e.testType.toLowerCase().replace(/[^a-z0-9%]+/g, " ").trim()}`;
  const seen = new Map<string, number>();
  for (const { sg, out } of transcribed) {
    if (!out) continue;
    for (const e of out.labResults) {
      const k = keyOf(e);
      const idx = seen.get(k);
      if (idx === undefined) { seen.set(k, merged.length); merged.push({ e, sg, note: null }); continue; }
      const prev = merged[idx];
      if (prev.e.result.trim().toLowerCase() !== e.result.trim().toLowerCase())
        prev.note = `scan: overlapping strips disagree — "${prev.e.result}" vs "${e.result}"`;
    }
  }
  const t = {
    collectedAt: transcribed.map((x) => x.out?.collectedAt).find(Boolean) ?? null,
    labResults: merged.map((m) => m.e),
    labReport: transcribed.map((x) => x.out?.labReport).filter(Boolean).sort((a, b) => (b?.length ?? 0) - (a?.length ?? 0))[0] ?? "",
    recommendations: transcribed.map((x) => x.out?.recommendations).find((r) => r && (r.nutrition || r.exercise)) ?? { nutrition: "", exercise: "" },
  };
  const stripNotes = merged.map((m) => m.note);

  // Pass 2: verify per segment (entries are checked against the segment they came from)
  const indexed = t.labResults.map((e, i) => ({ e, i, sg: merged[i].sg }));
  const listingFor = (items: { e: z.infer<typeof Entry>; i: number }[]) =>
    items.map(({ e, i }) => `${i}. ${e.testType} | result: ${e.result} | range: ${e.referenceRange} | units: ${e.units}`).join("\n");
  const pageResults = (
    await mapLimit(segments, CONCURRENCY, async (sg) => {
      const items = indexed.filter((x) => x.sg === sg);
      if (items.length === 0) return null;
      const r = await getClient().responses.parse({
        model: verifyModel,
        ...(modelRequestParams(verifyModel) as any),
        input: [
          { role: "system", content: VERIFY_PROMPT },
          {
            role: "user",
            content: [
              { type: "input_text", text: `Image: ${segLabel(sg)}. ENTRIES CLAIMED FOR THIS IMAGE (${items.length}):\n${listingFor(items)}` },
              imagePart(sg) as any,
            ],
          },
        ],
        text: { format: zodTextFormat(VerifySchema, "lab_vision_verify") },
      });
      return r.output_parsed;
    })
  ).filter(Boolean) as z.infer<typeof VerifySchema>[];
  const v = {
    collectedAt: pageResults.map((r) => r.collectedAt).find(Boolean) ?? null,
    checks: pageResults.flatMap((r) => r.checks),
    missing: pageResults.flatMap((r) => r.missing),
  };

  const checks = new Map(v.checks.map((c) => [c.index, c]));
  let confirmedCount = 0, correctedCount = 0;
  const checked: (ExtractedEntry & { _review: string | null })[] = t.labResults.map((e, i) => {
    const c = checks.get(i);
    const base: ExtractedEntry = { rowNumber: null, ...e };
    if (c && c.confirmed) {
      confirmedCount++;
      return { ...base, _review: null };
    }
    if (c && !c.confirmed) {
      const same = (a: string | null | undefined, b: string) =>
        a == null || a.replace(/\s+/g, "").toLowerCase() === (b || "").replace(/\s+/g, "").toLowerCase();
      // A "correction" that repeats the original is a confirmation.
      if (same(c.correctedResult, e.result) && same(c.correctedReferenceRange, e.referenceRange) && same(c.correctedUnits, e.units)) {
        confirmedCount++;
        return { ...base, _review: null };
      }
      // Only the reference range / units are taken from the second read when
      // the first read had none; the VALUE is never overwritten — a
      // disagreement on the value is surfaced for the user to check.
      correctedCount++;
      const disagreeValue = !same(c.correctedResult, e.result);
      return {
        ...base,
        referenceRange: e.referenceRange ? e.referenceRange : c.correctedReferenceRange ?? "",
        units: e.units ? e.units : c.correctedUnits ?? "",
        _review: disagreeValue
          ? `scan: two reads disagree — "${e.result}" vs "${c.correctedResult}"${c.note ? ` (${c.note})` : ""}`
          : `scan: second read questioned the range/units${c.note ? ` (${c.note})` : ""}`,
      };
    }
    return { ...base, _review: "scan: second read did not confirm this entry" };
  });
  const known = new Set(t.labResults.map((e) => keyOf(e)));
  const added = v.missing
    .filter((e) => !known.has(keyOf(e)))
    .map((e) => ({ rowNumber: null, ...e, _review: "scan: found only on the second read" }));
  const all = [...checked, ...added];

  const validated = validateEntries(all, [], { verifySource: false }).map((entry, i) => {
    const r = all[i]?._review ?? (i < stripNotes.length ? stripNotes[i] : null);
    if (!r) return entry;
    return {
      ...entry,
      needsReview: true,
      reviewReason: entry.reviewReason ? `${r}; ${entry.reviewReason}` : r,
    };
  });

  return {
    labResults: validated,
    labReport: t.labReport,
    recommendations: t.recommendations,
    collectedAt: parseIso(v.collectedAt) ?? parseIso(t.collectedAt),
    passes: 2,
    confirmedCount,
    correctedCount,
    addedCount: added.length,
  };
};
