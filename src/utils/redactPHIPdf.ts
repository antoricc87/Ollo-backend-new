import { PDFDocument, rgb } from "pdf-lib";
import fs from "fs";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.js";

interface UploadedFile {
  data: Buffer;
  name: string;
}

export const PDFRedactWithMask = async (
  file: UploadedFile,
  firstName: string,
  lastName: string,
  dob: string
): Promise<Uint8Array> => {
  // Load original PDF into pdf-lib
  const pdfDoc = await PDFDocument.load(file.data);

  // Load PDF into pdfjs-dist for coordinate-based text extraction
  const loadingTask = pdfjsLib.getDocument({ data: file.data });
  const pdf = await loadingTask.promise;

  // Prepare regex patterns (same as your original function)
  const patterns: RegExp[] = [];
  patterns.push(new RegExp(`\\b${firstName}\\b`, "gi"));
  patterns.push(new RegExp(`\\b${lastName}\\b`, "gi"));

  // DOB patterns
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
    patterns.push(new RegExp(`\\b(${dobPatterns.join("|")})\\b`, "g"));
  }

  // Generic date formats
  patterns.push(
    /\b(?:\d{4}[-\/\.]\d{1,2}[-\/\.]\d{1,2}|\d{1,2}[-\/\.]\d{1,2}[-\/\.]\d{4})\b/g
  );

  // Natural language date formats
  patterns.push(
    new RegExp(
      "(?:date\\s*[:\\-]?\\s*)?" +
        "\\d{1,2}\\s+" +
        "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|" +
        "aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)" +
        "[\\s,]*\\d{4}",
      "gim"
    )
  );

  // Time formats
  patterns.push(/\b\d{1,2}:\d{2}(:\d{2})?\s?(AM|PM|am|pm)?\b/g);

  // Iterate through PDF pages
  for (let pageIndex = 0; pageIndex < pdf.numPages; pageIndex++) {
    const page = await pdf.getPage(pageIndex + 1);
    const textContent = await page.getTextContent();

    const libPage = pdfDoc.getPages()[pageIndex];
    const { height } = libPage.getSize();

    textContent.items.forEach((item: any) => {
      const str = item.str;
      for (const regex of patterns) {
        if (regex.test(str)) {
          // item.transform = [scaleX, skewX, skewY, scaleY, translateX, translateY]
          const [, , , fontHeight, x, y] = item.transform;

          // Draw black rectangle over the matched text
          libPage.drawRectangle({
            x,
            y: height - y, // convert PDF.js coords to pdf-lib coords
            width: item.width || str.length * 6, // rough width estimate
            height: fontHeight,
            color: rgb(0, 0, 0),
          });
        }
      }
    });
  }

  // Return the new PDF as a buffer (Uint8Array)
  return await pdfDoc.save();
};
