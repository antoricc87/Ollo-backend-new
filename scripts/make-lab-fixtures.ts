/**
 * Generates synthetic lab-report PDFs with realistic tabular layouts (US
 * Quest-style with current/previous columns, EU-style with comma decimals and
 * an Italian header) plus .expected.json files for scripts/eval-labs.ts.
 * Run: npx ts-node --transpile-only scripts/make-lab-fixtures.ts
 */
import fs from "fs";
import path from "path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const OUT = path.join(__dirname, "..", "tests", "fixtures", "labs");

type Cell = string;
type Fixture = {
  name: string;
  header: string[];
  columns: { x: number; title: string }[];
  rows: Cell[][]; // one per column
  expected: { testType: string; result: string; isOutOfRange: boolean }[];
  collectedAt: string;
};

const quest: Fixture = {
  name: "quest_current_previous",
  header: [
    "QUEST DIAGNOSTICS   PATIENT REPORT",
    "Patient: JANE DOE     DOB: 05/14/1979     Sex: F",
    "Collected: 03/18/2026 08:40    Received: 03/18/2026    Reported: 03/20/2026 14:02",
    "Ordering physician: R. SMITH MD",
  ],
  columns: [
    { x: 40, title: "Test Name" },
    { x: 230, title: "Current Result" },
    { x: 320, title: "Flag" },
    { x: 360, title: "Previous Result" },
    { x: 450, title: "Reference Range" },
    { x: 530, title: "Units" },
  ],
  rows: [
    ["LIPID PANEL", "", "", "", "", ""],
    ["CHOLESTEROL, TOTAL", "236", "H", "212  09/04/2024", "<200", "mg/dL"],
    ["HDL CHOLESTEROL", "49", "", "61  09/04/2024", ">40", "mg/dL"],
    ["TRIGLYCERIDES", "496", "H", "109  09/04/2024", "<150", "mg/dL"],
    ["LDL-CHOLESTEROL", "128", "H", "119  09/04/2024", "<100", "mg/dL (calc)"],
    ["COMPREHENSIVE METABOLIC PANEL", "", "", "", "", ""],
    ["GLUCOSE", "92", "", "101  09/04/2024", "65-99", "mg/dL"],
    ["CREATININE", "0.98", "", "1.02  09/04/2024", "0.50-1.10", "mg/dL"],
    ["ALBUMIN", "4.3", "", "", "3.6-5.1", "g/dL"],
    ["ALKALINE PHOSPHATASE", "112", "", "", "35-104", "U/L"],
    ["HEMOGLOBIN A1c", "5.8", "H", "5.6  09/04/2024", "<5.7", "% of total Hgb"],
    ["CBC", "", "", "", "", ""],
    ["WBC", "6.2", "", "", "3.8-10.8", "Thousand/uL"],
    ["RDW", "13.1", "", "", "11.0-15.0", "%"],
    ["MCV", "89.5", "", "", "80.0-100.0", "fL"],
    ["LYMPHOCYTES, ABSOLUTE", "1.9", "", "", "0.7-3.1", "Thousand/uL"],
    ["C-REACTIVE PROTEIN", "0.8", "", "", "<3.0", "mg/L"],
    ["VITAMIN D, 25-OH, TOTAL", "19", "L", "", "30-100", "ng/mL"],
    ["Comment: Fasting specimen. Values flagged H/L are outside the reference range.", "", "", "", "", ""],
  ],
  expected: [
    { testType: "TCL", result: "236", isOutOfRange: true },
    { testType: "HDL", result: "49", isOutOfRange: false },
    { testType: "Triglycerides", result: "496", isOutOfRange: true },
    { testType: "LDL", result: "128", isOutOfRange: true },
    { testType: "Glucose", result: "92", isOutOfRange: false },
    { testType: "Creatinine", result: "0.98", isOutOfRange: false },
    { testType: "Albumin", result: "4.3", isOutOfRange: false },
    { testType: "Alkaline Phosphatase", result: "112", isOutOfRange: true },
    { testType: "HbA1c", result: "5.8", isOutOfRange: true },
    { testType: "WBC", result: "6.2", isOutOfRange: false },
    { testType: "RDW", result: "13.1", isOutOfRange: false },
    { testType: "MCV", result: "89.5", isOutOfRange: false },
    { testType: "Lymphocytes", result: "1.9", isOutOfRange: false },
    { testType: "CRP", result: "0.8", isOutOfRange: false },
    { testType: "Vitamin D", result: "19", isOutOfRange: true },
  ],
  collectedAt: "2026-03-18",
};

const italian: Fixture = {
  name: "italian_comma_decimals",
  header: [
    "LABORATORIO ANALISI CLINICHE - REFERTO",
    "Paziente: ROSSI MARIO   Nato il: 12/03/1985   Sesso: M",
    "Data prelievo: 05/02/2026   Data referto: 07/02/2026",
  ],
  columns: [
    { x: 40, title: "Esame" },
    { x: 260, title: "Risultato" },
    { x: 330, title: "U.M." },
    { x: 400, title: "Valori di riferimento" },
    { x: 530, title: "" },
  ],
  rows: [
    ["EMOCROMO", "", "", "", ""],
    ["Emoglobina", "15,1", "g/dL", "13,0 - 17,0", ""],
    ["Leucociti (WBC)", "6,20", "10^9/L", "4,00 - 10,00", ""],
    ["Piastrine", "242", "10^9/L", "150 - 400", ""],
    ["MCV", "88,0", "fL", "80,0 - 99,0", ""],
    ["CHIMICA CLINICA", "", "", "", ""],
    ["Glucosio", "104", "mg/dL", "70 - 99", "*"],
    ["Creatinina", "0,95", "mg/dL", "0,70 - 1,20", ""],
    ["Colesterolo totale", "198", "mg/dL", "< 200", ""],
    ["Colesterolo HDL", "58", "mg/dL", "> 40", ""],
    ["Trigliceridi", "96", "mg/dL", "< 150", ""],
    ["Ferritina", "42", "ng/mL", "30 - 400", ""],
    ["TSH", "2,10", "mIU/L", "0,40 - 4,00", ""],
    ["Vitamina D (25-OH)", "19", "ng/mL", "30 - 100", "*"],
    ["Proteina C reattiva (PCR)", "< 0,5", "mg/dL", "< 0,5", ""],
    ["* = valore fuori dall'intervallo di riferimento", "", "", "", ""],
  ],
  expected: [
    { testType: "Hemoglobin", result: "15,1", isOutOfRange: false },
    { testType: "WBC", result: "6,20", isOutOfRange: false },
    { testType: "Platelets", result: "242", isOutOfRange: false },
    { testType: "MCV", result: "88,0", isOutOfRange: false },
    { testType: "Glucose", result: "104", isOutOfRange: true },
    { testType: "Creatinine", result: "0,95", isOutOfRange: false },
    { testType: "TCL", result: "198", isOutOfRange: false },
    { testType: "HDL", result: "58", isOutOfRange: false },
    { testType: "Triglycerides", result: "96", isOutOfRange: false },
    { testType: "Ferritin", result: "42", isOutOfRange: false },
    { testType: "TSH", result: "2,10", isOutOfRange: false },
    { testType: "Vitamin D", result: "19", isOutOfRange: true },
    { testType: "CRP", result: "< 0,5", isOutOfRange: false },
  ],
  collectedAt: "2026-02-05",
};

async function build(f: Fixture) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([595, 842]);
  let y = 800;
  for (const h of f.header) { page.drawText(h, { x: 40, y, size: 10, font: bold }); y -= 14; }
  y -= 10;
  for (const c of f.columns) page.drawText(c.title, { x: c.x, y, size: 8, font: bold });
  y -= 6; page.drawLine({ start: { x: 40, y }, end: { x: 560, y }, thickness: 0.5, color: rgb(0.3,0.3,0.3) }); y -= 12;
  for (const r of f.rows) {
    const isSection = r.slice(1).every((c) => c === "");
    r.forEach((cell, i) => { if (cell) page.drawText(cell, { x: f.columns[i].x, y, size: 8, font: isSection ? bold : font }); });
    y -= 13;
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `${f.name}.pdf`), await doc.save());
  fs.writeFileSync(path.join(OUT, `${f.name}.expected.json`), JSON.stringify({ collectedAt: f.collectedAt, results: f.expected }, null, 2));
  console.log("wrote", f.name);
}

(async () => { await build(quest); await build(italian); })();
