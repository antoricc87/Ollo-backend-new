/**
 * Render PDF pages to PNG (for the vision path on scanned reports).
 * pdf.js + @napi-rs/canvas (prebuilt binaries — no native toolchain needed
 * on Railway). Scale 2.5 ≈ 180 dpi: enough for the small reference-range
 * print on lab reports without blowing past the model's image limits.
 */
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.js";
import { createCanvas } from "@napi-rs/canvas";

class NapiCanvasFactory {
  create(width: number, height: number) {
    const canvas = createCanvas(Math.max(1, Math.floor(width)), Math.max(1, Math.floor(height)));
    return { canvas, context: canvas.getContext("2d") };
  }
  reset(pair: any, width: number, height: number) {
    pair.canvas.width = Math.max(1, Math.floor(width));
    pair.canvas.height = Math.max(1, Math.floor(height));
  }
  destroy(pair: any) {
    pair.canvas.width = 0;
    pair.canvas.height = 0;
    pair.canvas = null;
    pair.context = null;
  }
}

export type RenderedPage = { page: number; png: Buffer; width: number; height: number };

export const renderPdfPages = async (
  data: Buffer | Uint8Array,
  opts: { scale?: number; maxPages?: number } = {}
): Promise<RenderedPage[]> => {
  const scale = opts.scale ?? 2.5;
  const pdf = await pdfjsLib.getDocument({
    data: data instanceof Uint8Array ? data : new Uint8Array(data),
    disableFontFace: true,
    verbosity: 0,
  } as any).promise;
  const factory = new NapiCanvasFactory();
  const out: RenderedPage[] = [];
  const n = Math.min(pdf.numPages, opts.maxPages ?? 20);
  for (let p = 1; p <= n; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale });
    const { canvas, context } = factory.create(viewport.width, viewport.height);
    await page.render({ canvasContext: context as any, viewport, canvasFactory: factory } as any).promise;
    out.push({ page: p, png: canvas.toBuffer("image/png"), width: canvas.width, height: canvas.height });
  }
  return out;
};

/* ------------------------------- Strips -----------------------------------
 * Cut a page into overlapping horizontal strips. Transcribing a strip (a
 * handful of rows) instead of a whole page keeps a vision model from shifting
 * a whole block of values by one row — the dominant error on scans where the
 * value is printed between two labels. Overlap guarantees no row is cut. */
import { loadImage } from "@napi-rs/canvas";

export type PageSegment = { page: number; index: number; count: number; png: Buffer; top: number; bottom: number };

export const cutStrips = async (page: RenderedPage, strips: number, overlap = 0.12): Promise<PageSegment[]> => {
  if (strips <= 1) return [{ page: page.page, index: 0, count: 1, png: page.png, top: 0, bottom: page.height }];
  const img = await loadImage(page.png);
  const stripH = page.height / strips;
  const pad = Math.round(stripH * overlap);
  const out: PageSegment[] = [];
  for (let i = 0; i < strips; i++) {
    const top = Math.max(0, Math.round(i * stripH) - pad);
    const bottom = Math.min(page.height, Math.round((i + 1) * stripH) + pad);
    const c = createCanvas(page.width, bottom - top);
    c.getContext("2d").drawImage(img, 0, top, page.width, bottom - top, 0, 0, page.width, bottom - top);
    out.push({ page: page.page, index: i, count: strips, png: c.toBuffer("image/png"), top, bottom });
  }
  return out;
};
