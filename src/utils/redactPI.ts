import { UploadedFile } from "express-fileupload";
import pdfParse from "pdf-parse";
import { PDFDocument, rgb } from "pdf-lib";
import fs from "fs";
import path from "path";

export const redactPII = (
  text: string,
  firstName: string,
  lastName: string,
  dob: string
): string => {
  // Redact first and last name
  const firstNameRegex = new RegExp(`\\b${firstName}\\b`, "gi");
  text = text.replace(firstNameRegex, "[REDACTED]");
  const lastNameRegex = new RegExp(`\\b${lastName}\\b`, "gi");
  text = text.replace(lastNameRegex, "[REDACTED]");

  // Redact date of birth in multiple formats
  const [year, month, day] = dob.split(/[-\/]/);
  if (year && month && day) {
    const dobPatterns = [
      `${year}[-/]${month}[-/]${day}`,
      `${day}[-/]${month}[-/]${year}`,
      `${month}[-/]${day}[-/]${year}`,
    ];
    const dobRegex = new RegExp(`\\b(${dobPatterns.join("|")})\\b`, "g");
    text = text.replace(dobRegex, "[REDACTED]");
  }

  // Keep only relevant lab result sections
  text = text
    .split("\n") // Split text into lines
    .filter((line) =>
      /Result|Reference Range|Panel|Test|mg\/dL|x10E/.test(line)
    ) // Keep lines with lab-related keywords
    .join("\n"); // Rejoin the filtered lines

  return text;
};

/**
 * Parse a lab PDF, detect its collection (test) date from the raw text, then
 * redact PII. The date has to be read BEFORE redaction because the redaction
 * pass below strips every date/time from the text.
 */
export const parseLabPdf = async (
  file: UploadedFile,
  firstName: string,
  lastName: string,
  dob: string
): Promise<{ redactedText: string; detectedCollectedAt: Date | null }> => {
  const parsedData = await pdfParse(file.data);
  const rawText: string = parsedData.text ?? "";
  const detectedCollectedAt = detectCollectionDate(rawText, dob);
  const redactedText = redactPIIText(rawText, firstName, lastName, dob);
  return { redactedText, detectedCollectedAt };
};

export const PDFParseAndRedactPII = async (
  file: UploadedFile,
  firstName: string,
  lastName: string,
  dob: string
): Promise<string> => {
  const { redactedText } = await parseLabPdf(file, firstName, lastName, dob);
  return redactedText;
};

/* ------------------------- Collection date detection ------------------------ */

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};

// Labels that precede the sample date on most lab reports, in priority order.
const DATE_LABELS = [
  // Italian / European labs first: "Data prelievo" is the sample date
  "data prelievo", "data di prelievo", "prelievo", "data accettazione", "data raccolta",
  "collected", "collection date", "date collected", "specimen collected",
  "drawn", "date drawn", "draw date", "sample date", "sampled", "date of sample",
  "date of service", "service date", "date of test", "test date", "tested",
  "received", "date received", "reported", "report date", "date reported",
  "date of report", "data referto", "data emissione", "printed", "date", "data",
];

/**
 * Day-first vs month-first for numeric dates. Evidence in this order: any date
 * on the page whose first component > 12 (must be DD/MM) or second > 12 (must
 * be MM/DD); otherwise Italian/European wording on the page; otherwise US.
 */
export const inferDayFirst = (text: string): boolean => {
  const all = text.match(/\b(\d{1,2})[-\/.](\d{1,2})[-\/.]\d{4}\b/g) ?? [];
  let dayFirst = 0, monthFirst = 0;
  for (const d of all) {
    const [a, b] = d.split(/[-\/.]/).map(Number);
    if (a > 12) dayFirst++;
    else if (b > 12) monthFirst++;
  }
  if (dayFirst && !monthFirst) return true;
  if (monthFirst && !dayFirst) return false;
  return /\b(prelievo|referto|paziente|nato il|nata il|data di nascita|esame|risultato|valori di riferimento|unit[àa] di misura)\b/i.test(text);
};

const parseDateToken = (token: string, dayFirst = false): Date | null => {
  const t = token.trim();
  let m: RegExpMatchArray | null;
  // 2024-03-18 / 2024/03/18
  if ((m = t.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/))) {
    return makeDate(+m[1], +m[2] - 1, +m[3]);
  }
  // 18/03/2024 or 03/18/2024 — ambiguous; prefer DD/MM when first > 12
  if ((m = t.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/))) {
    const a = +m[1], b = +m[2], y = +m[3];
    if (a > 12) return makeDate(y, b - 1, a);
    if (b > 12) return makeDate(y, a - 1, b);
    return dayFirst ? makeDate(y, b - 1, a) : makeDate(y, a - 1, b);
  }
  // 18 March 2024 / 18 Mar 2024
  if ((m = t.match(/^(\d{1,2})\s+([a-z]+)[\s,]+(\d{4})$/i))) {
    const mo = MONTHS[m[2].toLowerCase().slice(0, 4)] ?? MONTHS[m[2].toLowerCase().slice(0, 3)];
    if (mo === undefined) return null;
    return makeDate(+m[3], mo, +m[1]);
  }
  // March 18, 2024 / Mar 18 2024
  if ((m = t.match(/^([a-z]+)\s+(\d{1,2})[\s,]+(\d{4})$/i))) {
    const mo = MONTHS[m[1].toLowerCase().slice(0, 4)] ?? MONTHS[m[1].toLowerCase().slice(0, 3)];
    if (mo === undefined) return null;
    return makeDate(+m[3], mo, +m[2]);
  }
  return null;
};

const makeDate = (y: number, mo: number, d: number): Date | null => {
  if (y < 1990 || y > 2100 || mo < 0 || mo > 11 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, mo, d));
  if (date.getUTCMonth() !== mo) return null;
  return date;
};

const DATE_TOKEN =
  "(\\d{4}[-\\/.]\\d{1,2}[-\\/.]\\d{1,2}|\\d{1,2}[-\\/.]\\d{1,2}[-\\/.]\\d{4}|\\d{1,2}\\s+[A-Za-z]{3,9}[\\s,]+\\d{4}|[A-Za-z]{3,9}\\s+\\d{1,2}[\\s,]+\\d{4})";

/**
 * Best-effort collection date: the first date following a "Collected"/"Drawn"/
 * "Date of service"-style label; otherwise the most recent plausible date on
 * the page (excluding the patient's DOB and anything in the future).
 */
export const detectCollectionDate = (rawText: string, dob?: string): Date | null => {
  if (!rawText) return null;
  const text = rawText.replace(/\s+/g, " ");
  const dayFirst = inferDayFirst(text);
  const now = new Date();
  const dobTime = dob ? new Date(dob).getTime() : NaN;
  const plausible = (d: Date | null): d is Date =>
    !!d && d.getTime() <= now.getTime() + 86400000 &&
    (isNaN(dobTime) || Math.abs(d.getTime() - dobTime) > 86400000);

  for (const label of DATE_LABELS) {
    const re = new RegExp(label.replace(/\s+/g, "\\s+") + "\\s*(?:date)?\\s*[:\\-]?\\s*" + DATE_TOKEN, "i");
    const m = text.match(re);
    if (m) {
      const d = parseDateToken(m[1], dayFirst);
      if (plausible(d)) return d;
    }
  }

  const all = text.match(new RegExp(DATE_TOKEN, "g")) ?? [];
  const candidates = all.map((t) => parseDateToken(t, dayFirst)).filter(plausible);
  if (candidates.length === 0) return null;
  return candidates.reduce((a, b) => (b.getTime() > a.getTime() ? b : a));
};

/* ------------------------------ PII redaction ------------------------------ */

export const redactPIIText = (
  rawText: string,
  firstName: string,
  lastName: string,
  dob: string
): string => {
  let text = rawText;
  // Redact first and last name
  const firstNameRegex = new RegExp(`\\b${firstName}\\b`, "gi");
  text = text.replace(firstNameRegex, "[REDACTED]");
  const lastNameRegex = new RegExp(`\\b${lastName}\\b`, "gi");
  text = text.replace(lastNameRegex, "[REDACTED]");
  // Redact specific DOB formats
  const [year, month, day] = dob.split(/[-\/]/);
  if (year && month && day) {
    const separators = ["-", "/"];
    const parts = [
      [year, month, day],
      [day, month, year],
      [month, day, year],
    ];

    const dobPatterns: string[] = [];

    for (const [a, b, c] of parts) {
      for (const sep1 of separators) {
        for (const sep2 of separators) {
          dobPatterns.push(`${a}${sep1}${b}${sep2}${c}`);
        }
      }
    }

    const dobRegex = new RegExp(`\\b(${dobPatterns.join("|")})\\b`, "g");
    text = text.replace(dobRegex, "[REDACTED]");
  }

  // Redact any generic date formats (MM/DD/YYYY, DD-MM-YY, etc.)
  const genericDateRegex =
    /\b(?:\d{4}[-\/\.]\d{1,2}[-\/\.]\d{1,2}|\d{1,2}[-\/\.]\d{1,2}[-\/\.]\d{4})\b/g;
  text = text.replace(genericDateRegex, "[REDACTED]");
  // Redact natural language date formats like '28 December 2019'
  const naturalLanguageDateRegex = new RegExp(
    // Optional prefix like "Date :", allowing colons, dashes, and any whitespace
    "(?:date\\s*[:\\-]?\\s*)?" +
      // Day (optional), followed by any whitespace
      "\\d{1,2}\\s+" +
      // Month name
      "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|" +
      "aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)" +
      // Optional comma, optional space, then 4-digit year
      "[\\s,]*\\d{4}",
    "gim"
  );

  text = text.replace(naturalLanguageDateRegex, "[REDACTED]");

  // Redact time formats (e.g., 14:30, 2:45 PM, 23:59:59)
  const timeRegex = /\b\d{1,2}:\d{2}(:\d{2})?\s?(AM|PM|am|pm)?\b/g;
  text = text.replace(timeRegex, "[REDACTED]");
  return text;
};
