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

export const PDFParseAndRedactPII = async (
  file: UploadedFile,
  firstName: string,
  lastName: string,
  dob: string
): Promise<string> => {
  const parsedData = await pdfParse(file.data);
  let text = parsedData.text;
  console.log(text);
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
  // console.log(text);
  return text;
};
