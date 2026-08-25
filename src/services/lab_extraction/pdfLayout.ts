/**
 * Layout-aware PDF text extraction.
 *
 * `pdf-parse` flattens a page into a stream of strings with no notion of rows
 * or columns, so on tabular lab reports the result, reference range, previous
 * value and date columns get glued together ("496109/04/2024"). This module
 * reads every text item with its coordinates (pdf.js), groups items into rows
 * by their baseline, orders them left-to-right, and marks column gaps with
 * " | " so the downstream model sees one clean row per test.
 */
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.js";

export type LayoutRow = {
  page: number;
  y: number;
  cells: string[];
  text: string; // cells joined with " | "
};

export type PdfLayout = {
  pages: number;
  rows: LayoutRow[];
  text: string; // one row per line, page breaks as blank lines
  charCount: number;
  /** True when the PDF has (almost) no text layer — a scanned image. */
  isScanned: boolean;
};

type Item = { str: string; x: number; y: number; w: number; h: number };

const ROW_TOLERANCE_FACTOR = 0.45; // fraction of font height
const CELL_GAP_FACTOR = 1.6; // gap (in avg char widths) that starts a new cell
const MIN_CELL_GAP_PT = 7;

export const extractPdfLayout = async (data: Buffer | Uint8Array): Promise<PdfLayout> => {
  const pdf = await pdfjsLib.getDocument({
    data: data instanceof Uint8Array ? data : new Uint8Array(data),
    // Avoid worker/font warnings in Node
    disableFontFace: true,
    verbosity: 0,
  } as any).promise;

  const rows: LayoutRow[] = [];
  let charCount = 0;

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const items: Item[] = (content.items as any[])
      .filter((it) => typeof it.str === "string" && it.str.trim().length > 0)
      .map((it) => ({
        str: it.str,
        x: it.transform[4],
        y: it.transform[5],
        w: it.width || 0,
        h: Math.abs(it.transform[3]) || Math.abs(it.height) || 10,
      }));
    charCount += items.reduce((n, it) => n + it.str.trim().length, 0);
    if (items.length === 0) continue;

    // Group by baseline (top of page first: larger y first in PDF space)
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const groups: Item[][] = [];
    for (const it of items) {
      const g = groups[groups.length - 1];
      if (g && Math.abs(g[0].y - it.y) <= Math.max(2, g[0].h * ROW_TOLERANCE_FACTOR)) g.push(it);
      else groups.push([it]);
    }

    for (const g of groups) {
      g.sort((a, b) => a.x - b.x);
      const cells: string[] = [];
      let cur = "";
      let prevEnd = -Infinity;
      for (const it of g) {
        const avgChar = it.w > 0 && it.str.length > 0 ? it.w / it.str.length : it.h * 0.5;
        const gap = it.x - prevEnd;
        const newCell = cur !== "" && gap > Math.max(MIN_CELL_GAP_PT, avgChar * CELL_GAP_FACTOR);
        if (newCell) {
          cells.push(cur.trim());
          cur = it.str;
        } else {
          cur = cur === "" ? it.str : gap > avgChar * 0.3 ? `${cur} ${it.str}` : `${cur}${it.str}`;
        }
        prevEnd = it.x + it.w;
      }
      if (cur.trim()) cells.push(cur.trim());
      const cleaned = cells.map((c) => c.replace(/\s+/g, " ").trim()).filter(Boolean);
      if (cleaned.length) rows.push({ page: p, y: g[0].y, cells: cleaned, text: cleaned.join(" | ") });
    }
  }

  const text = (() => {
    const out: string[] = [];
    let lastPage = 0;
    for (const r of rows) {
      if (r.page !== lastPage && lastPage !== 0) out.push("");
      out.push(r.text);
      lastPage = r.page;
    }
    return out.join("\n");
  })();

  return {
    pages: pdf.numPages,
    rows,
    text,
    charCount,
    isScanned: charCount < 40 * pdf.numPages,
  };
};
