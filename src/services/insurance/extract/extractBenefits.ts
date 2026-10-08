/**
 * Summary of Benefits and Coverage → structured benefits.
 *
 *   PDF ─► layout rows (pdf.js coords, the lab pipeline's reader)
 *       ─► model: COPY the cells of the standard SBC form (strict schema,
 *          every amount beside the text it was read from)
 *       ─► code: every number read back from its quote, every quote looked up
 *          in the document (domain/benefits.ts `reviewBenefits`)
 *
 * A scanned PDF (no text layer) goes through page images instead; quotes can
 * then only be checked against themselves, and the source says so.
 *
 * An SBC is a plan document, not a member document: it carries no name or
 * member id, so nothing is redacted. Model: INSURANCE_EXTRACTION_MODEL
 * (default: the lab extraction model).
 */
import { zodTextFormat } from "openai/helpers/zod";
import { extractPdfLayout } from "../../lab_extraction/pdfLayout";
import { renderPdfPages } from "../../lab_extraction/pdfRender";
import OpenAI from "openai";
import { modelRequestParams } from "../../meal_analysis/mealAnalysis.service";
import { BenefitsSchema, normalizeBenefits, reviewBenefits, type Benefits, type StoredBenefits } from "../domain/benefits";

// Read from the env here rather than imported from extractLabs: that file does not pass ts-jest's type check, and the agent tools import this one.
export const INSURANCE_MODEL = process.env.INSURANCE_EXTRACTION_MODEL || process.env.LAB_EXTRACTION_MODEL || "gpt-4.1";
const MAX_CHARS = 60_000;

// Its own client: a whole summary is one long structured answer (30–60 s), far past the meal client's 20 s cap.
let client: OpenAI | null = null;
export const getClient = () => {
  if (!client) client = new OpenAI({ apiKey: process.env.REACT_APP_OPENAI_API_KEY || "", timeout: Number(process.env.INSURANCE_OPENAI_TIMEOUT_MS || 180_000), maxRetries: 1 });
  return client;
};
const MAX_SCAN_PAGES = 8;

export const BENEFITS_PROMPT = `You transcribe a US health plan's "Summary of Benefits and Coverage" (SBC) into a fixed structure. You copy what is printed; you never infer, compute or fill in typical values.

Rules:
- isBenefitsSummary is true only for a plan benefits summary (an SBC or an equivalent schedule of benefits). For anything else (a bill, an EOB, a card, a lab report) return false and leave everything else null / empty.
- Amounts are US dollars as numbers (3000, not "$3,000"). A percentage is a number 0–100.
- deductible and outOfPocketMax: the "overall deductible" and the "out-of-pocket limit" from the Important Questions table, split into in-network and out-of-network, individual and family. An amount that is not printed is null. \`quote\` is the answer cell copied word for word.
- services: one entry per row of the "Common Medical Event" table that is printed, using the closest service key. Skip rows that are not printed. Never add a row.
- For each side (inNetwork = the network / in-network / preferred provider column, outOfNetwork = the out-of-network / non-preferred column):
  - kind: no_charge ("No charge", "$0"), copay (a dollar amount per visit/prescription), coinsurance (a percentage), copay_and_coinsurance (both), not_covered ("Not covered"), other (anything that does not fit, e.g. several tiers in one cell).
  - copayUsd / coinsurancePct: the numbers from that cell, else null (never 0 for an amount that is not printed).
  - The kind and the numbers describe the service the ROW is named for. When a cell also prices something else ("$35 copay/office visit and 20% coinsurance for other outpatient services"), take the part for the row's own service (copay, 35) and leave the rest to the quote.
  - deductibleApplies: false when the cell says the deductible does not apply / is waived; true when it says "after deductible" or the plan states that the deductible applies to this service; null when the cell does not say.
  - quote: the cell copied word for word.
- limits: the "Limitations, Exceptions & Other Important Information" cell for that row, word for word, or null when empty.
- referralRequired: from "Do you need a referral to see a specialist?". outOfNetworkCovered: false when the plan pays nothing out of network. null when not stated.
- periodStart / periodEnd: the coverage period as YYYY-MM-DD, null when not printed.`;

export type BenefitsExtraction = { benefits: StoredBenefits; isScanned: boolean };

export const extractBenefits = async (file: Buffer | Uint8Array, opts: { model?: string } = {}): Promise<BenefitsExtraction> => {
  const model = opts.model || INSURANCE_MODEL;
  // pdf.js detaches the buffer it is given, and a scan is read twice.
  const layout = await extractPdfLayout(Buffer.from(file));
  const content = layout.isScanned
    ? [
        { type: "input_text", text: `These are the pages of the document, in order.` },
        ...(await renderPdfPages(Buffer.from(file), { scale: 2, maxPages: MAX_SCAN_PAGES })).map((p) => ({
          type: "input_image",
          image_url: `data:image/png;base64,${p.png.toString("base64")}`,
          detail: "high",
        })),
      ]
    : [{ type: "input_text", text: `The document, one table row per line (" | " separates columns):\n\n${layout.text.slice(0, MAX_CHARS)}` }];

  const r = await getClient().responses.parse({
    model,
    ...(modelRequestParams(model) as any),
    input: [
      { role: "system", content: BENEFITS_PROMPT },
      { role: "user", content: content as any },
    ],
    text: { format: zodTextFormat(BenefitsSchema, "plan_benefits") },
  });
  const raw = r.output_parsed as Benefits | null;
  if (!raw) throw new Error("The benefits summary could not be read");
  const parsed = normalizeBenefits(raw);
  return {
    benefits: {
      ...parsed,
      review: reviewBenefits(parsed, layout.isScanned ? null : layout.text),
      source: { engine: layout.isScanned ? "scan" : "text", pages: layout.pages, model },
    },
    isScanned: layout.isScanned,
  };
};
