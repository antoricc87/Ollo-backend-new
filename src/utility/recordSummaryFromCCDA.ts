import fs from "fs";
import xml2js from "xml2js";
import { checkAbnormalValues } from "../utils/check_labs_abnormal_values";

interface Summary {
  Name: string;
  Gender: string;
  BirthDate: string;
  Allergies: { Substance: string; Reactions: string[] }[];
  Conditions: {
    Condition: string;
    ClinicalStatus: string;
    VerificationStatus: string;
    Onset: string;
  }[];
  Medications: { Medication: string; Dosage: string; Status: string }[];
  Procedures: { Procedure: string; Period: string }[];
  Immunizations: string[];
  LabResults: {
    [category: string]: {
      TestType: string;
      Results: { Result: string; normal: any; message: string }[];
    }[];
  };
  VitalSigns: { [key: string]: { Value: string; issued: string }[] };
}

const summaryToPlainText = (summary: Summary): string => {
  let text = `Name: ${summary.Name}\n`;
  text += `Gender: ${summary.Gender}\n`;
  text += `BirthDate: ${summary.BirthDate}\n\n`;

  text += `Allergies:\n`;
  summary.Allergies.forEach((allergy) => {
    text += `  Substance: ${allergy.Substance}\n`;
    text += `  Reactions: ${allergy.Reactions.join(", ")}\n`;
  });

  text += `\nConditions:\n`;
  summary.Conditions.forEach((condition) => {
    text += `  Condition: ${condition.Condition}\n`;
    text += `  ClinicalStatus: ${condition.ClinicalStatus}\n`;
    text += `  VerificationStatus: ${condition.VerificationStatus}\n`;
    text += `  Onset: ${condition.Onset}\n`;
  });

  text += `\nMedications:\n`;
  summary.Medications.forEach((medication) => {
    text += `  Medication: ${medication.Medication}\n`;
    text += `  Dosage: ${medication.Dosage}\n`;
    text += `  Status: ${medication.Status}\n`;
  });

  text += `\nProcedures:\n`;
  summary.Procedures.forEach((procedure) => {
    text += `  Procedure: ${procedure.Procedure}\n`;
    text += `  Period: ${procedure.Period}\n`;
  });

  text += `\nImmunizations:\n`;
  summary.Immunizations.forEach((immunization) => {
    text += `  ${immunization}\n`;
  });

  text += `\nLabResults:\n`;
  Object.keys(summary.LabResults).forEach((category) => {
    text += `${category}:\n`;
    summary.LabResults[category].forEach((labResult) => {
      text += `  Test: ${labResult.TestType}\n`;
      labResult.Results.forEach((result) => {
        text += `    Result: ${result.Result}\n`;
        text += `    Normal: ${result.normal}\n`;
        text += `    Message: ${result.message}\n`;
      });
    });
  });

  text += `\nVitalSigns:\n`;
  Object.keys(summary.VitalSigns).forEach((type) => {
    text += `  ${type}:\n`;
    summary.VitalSigns[type].forEach((vital) => {
      text += `    Value: ${vital.Value}\n`;
      text += `    Issued: ${vital.issued}\n`;
    });
  });

  return text;
};

const parseXmlFile = async (filePath: string): Promise<any> => {
  const xmlData = fs.readFileSync(filePath, "utf8");
  const parser = new xml2js.Parser();
  const result = await parser.parseStringPromise(xmlData);
  return result;
};

export const createSummaryFromXML = async (
  filePath: string,
  format: string
): Promise<string | Summary> => {
  const data = await parseXmlFile(filePath);

  const summary: Summary = {
    Name: "",
    Gender: "",
    BirthDate: "",
    Allergies: [],
    Conditions: [],
    Medications: [],
    Procedures: [],
    Immunizations: [],
    LabResults: {},
    VitalSigns: {},
  };

  const vitalSignsMap: {
    [key: string]: { effectiveDateTime: string; value: string }[];
  } = {};

  const patientData =
    data.ClinicalDocument.recordTarget[0].patientRole[0].patient[0];
  if (patientData.name) {
    summary.Name = `${patientData.name[0].given[0]} ${patientData.name[0].family[0]}`;
  }
  summary.Gender =
    patientData.administrativeGenderCode[0].$.code === "M" ? "Male" : "Female";
  summary.BirthDate = patientData.birthTime[0].$.value;

  const allergiesData =
    data.ClinicalDocument.component[0].structuredBody[0].component.find(
      (comp: any) => comp.section[0].code[0].$.code === "48765-2"
    );
  if (allergiesData) {
    summary.Allergies.push({
      Substance: "None",
      Reactions: [],
    });
  }

  const medicationsData =
    data.ClinicalDocument.component[0].structuredBody[0].component.find(
      (comp: any) => comp.section[0].code[0].$.code === "10160-0"
    );
  if (medicationsData) {
    medicationsData.section[0].entry.forEach((entry: any) => {
      const med = entry.substanceAdministration[0];
      summary.Medications.push({
        Medication:
          med.consumable[0].manufacturedProduct[0].manufacturedMaterial[0]
            .name[0],
        Dosage: med.doseQuantity[0].$.value,
        Status: med.statusCode[0].$.code,
      });
    });
  }

  const conditionsData =
    data.ClinicalDocument.component[0].structuredBody[0].component.find(
      (comp: any) => comp.section[0].code[0].$.code === "11450-4"
    );
  if (conditionsData) {
    conditionsData.section[0].entry.forEach((entry: any) => {
      const cond = entry.act[0].entryRelationship[0].observation[0];
      summary.Conditions.push({
        Condition: cond.value[0].$.displayName,
        ClinicalStatus: cond.statusCode[0].$.code,
        VerificationStatus: "",
        Onset: cond.effectiveTime[0].low[0].$.value,
      });
    });
  }

  const labsData =
    data.ClinicalDocument.component[0].structuredBody[0].component.find(
      (comp: any) => comp.section[0].code[0].$.code === "30954-2"
    );
  if (labsData) {
    labsData.section[0].entry.forEach((entry: any) => {
      const lab = entry.organizer[0];
      const observationType = lab.code[0].$.displayName;
      const observationValue = lab.component[0].observation[0].value[0].$.value;
      const observationUnit = lab.component[0].observation[0].value[0].$.unit;
      const valueState = checkAbnormalValues(
        observationType,
        observationValue,
        summary.Gender
      );
      const category = getCategory(observationType);
      if (!summary.LabResults[category]) {
        summary.LabResults[category] = [];
      }

      const testIndex = summary.LabResults[category].findIndex(
        (test) => test.TestType === observationType
      );
      if (testIndex !== -1) {
        summary.LabResults[category][testIndex].Results.push({
          Result: `${observationValue} ${observationUnit}`,
          normal: valueState.normal,
          message: valueState.message,
        });
      } else {
        summary.LabResults[category].push({
          TestType: observationType,
          Results: [
            {
              Result: `${observationValue} ${observationUnit}`,
              normal: valueState.normal,
              message: valueState.message,
            },
          ],
        });
      }
    });
  }

  console.log(summary);
  if (format === "text") {
    return summaryToPlainText(summary);
  } else {
    return summary;
  }
};

const getCategory = (observationType: string): string => {
  const categoryMap: { [key: string]: string } = {
    "Leukocytes [#/volume] in Blood by Automated count": "Blood",
    "Platelets [#/volume] in Blood by Automated count": "Blood",
    "Hemoglobin A1c/Hemoglobin.total in Blood": "Blood",
    "Hematocrit [Volume Fraction] of Blood by Automated count": "Blood",
    "MCV [Entitic volume] by Automated count": "Blood",
    "Erythrocytes [#/volume] in Blood by Automated count": "Blood",
    "Albumin [Mass/volume] in Serum or Plasma": "Chemistry",
    Potassium: "Chemistry",
    "Carbon Dioxide": "Chemistry",
    Chloride: "Chemistry",
    Glucose: "Chemistry",
    Calcium: "Chemistry",
    Sodium: "Chemistry",
    "Urea Nitrogen": "Kidney",
    Creatinine: "Kidney",
    "Alanine aminotransferase [Enzymatic activity/volume] in Serum or Plasma":
      "Other",
    "Globulin [Mass/volume] in Serum by calculation": "Other",
    "Platelet distribution width [Entitic volume] in Blood by Automated count":
      "Other",
    "Low Density Lipoprotein Cholesterol": "Lipid",
    "High Density Lipoprotein Cholesterol": "Lipid",
    "Total Cholesterol": "Lipid",
    Triglycerides: "Lipid",
    "Alkaline phosphatase [Enzymatic activity/volume] in Serum or Plasma":
      "Liver",
    // Add more mappings as needed
  };

  return categoryMap[observationType] || "Other";
};
