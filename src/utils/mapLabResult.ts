import { LabResultSummary } from "../types";

export function mapLabResults(labResults: LabResultSummary): {
  biomarkers: Record<string, number>;
  diabetesRiskLabs: Record<string, number>;
  cvRiskLabs: Record<string, number>;
} {
  const biomarkers: Record<string, number> = {};
  const diabetesRiskLabs: Record<string, number> = {};
  const cvRiskLabs: Record<string, number> = {};

  for (const lab of labResults.labResults) {
    // const lab = labSummary.labResults; // Access the LabResult object
    if (!lab) {
      console.warn("LabResult is missing for LabResultSummary:");
      continue;
    }

    // Extract numeric value from the result field
    const numericResult = parseFloat(lab.result.replace(/[^\d.-]/g, "")); // Removes all non-numeric characters

    if (isNaN(numericResult)) {
      console.warn(
        `Invalid numeric value for testType: ${lab.testType}, result: ${lab.result}`
      );
      continue;
    }
    const lowerCaseTestType = lab.testType.toLowerCase();
    switch (lowerCaseTestType) {
      // Biomarkers for Phenotypic Age
      case "albumin":
        biomarkers.albumin = numericResult;
        break;
      case "creatinine":
        biomarkers.creatinine = numericResult;
        break;
      case "glucose":
        biomarkers.glucose = numericResult;
        diabetesRiskLabs.fastingGlucose = numericResult;
        break;
      case "crp":
        biomarkers.crp = numericResult;
        break;
      case "rdw":
        biomarkers.rdw = numericResult;
        break;
      case "wbc":
        biomarkers.wbc = numericResult;
        break;
      case "mcv":
        biomarkers.mcv = numericResult;
        break;
      case "alkaline phosphatase":
        biomarkers.alkalinePhosphatase = numericResult;
        break;
      case "lymphs":
      case "lymphocyte count":
      case "lymphocyte absolute":
      case "lymphocyte (absolute)":
      case "lymphs (absolute)":
      case "lymphocyte":
        biomarkers.lympocyte = numericResult;
        break;
      // Labs for Diabetes Risk
      case "hdl cholesterol":
      case "hdl":
        diabetesRiskLabs.hdl = numericResult;
        cvRiskLabs.hdl = numericResult; // HDL is used in both Diabetes Risk and CV Risk
        break;
      case "triglycerides":
        diabetesRiskLabs.triglycerides = numericResult;
        break;
      case "glucose":
        diabetesRiskLabs.glucose = numericResult;
        break;

      // Labs for CV Risk
      case "cholesterol, total":
      case "total cholesterol":
      case "tcl":
        cvRiskLabs.tcl = numericResult;
        break;
      case "lcl":
      case "low-density lipoprotein":
      case "ldl":
        cvRiskLabs.lcl = numericResult;
        break;

      default:
      // console.warn(`Unhandled lab result type: ${lab.testType}`);
    }
  }

  return { biomarkers, diabetesRiskLabs, cvRiskLabs };
}
