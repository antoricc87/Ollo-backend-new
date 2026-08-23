import { PatientRecord, Summary } from "../types";
import { checkAbnormalValues } from "../utils/check_labs_abnormal_values";
import { getCategory } from "../utils/get_lab_category";
import { relevantProcedureCodes } from "./procedures_codes";

export const getYear = (date_string: string) => {
  const date_object = new Date(date_string);
  const year = date_object.getUTCFullYear().toString();
  return year;
};

export const summaryToPlainText = (summary: Summary): string => {
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
      text += `  Description: ${labResult.Description}\n`; // Add description
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

export const summarizePatientRecord = (
  data: any,
  format: string
): string | Summary => {
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
    [key: string]: {
      effectiveDateTime: string;
      value: string;
      description: string;
    }[];
  } = {};

  const patientData = data.patient_data;
  const allergiesData = data.patient_allergies;
  const proceduresData = data.patient_procedures;
  const conditionsData = data.patient_conditions;
  const medicationsData = data.patient_medications;
  const labsData = data.patient_labs;
  const vitalsData = data.patient_vitals;

  // Process patient data
  if (patientData.name && patientData.name.length > 0) {
    summary.Name = `${patientData.name[0].given.join(" ")} ${
      patientData.name[0].family
    }`;
  }
  summary.Gender = patientData.gender || "";
  summary.BirthDate = patientData.birthDate || "";

  // Process allergies
  allergiesData.entry &&
    allergiesData.entry.forEach((entry: { resource: PatientRecord }) => {
      const resource = entry.resource;
      summary.Allergies.push({
        Substance: resource.code?.text || "",
        Reactions:
          resource.reaction?.map((reaction) =>
            reaction.manifestation.map((man) => man.text).join(", ")
          ) || [],
      });
    });

  // Process procedures

  proceduresData.entry &&
    proceduresData.entry.forEach((entry: { resource: PatientRecord }) => {
      const resource = entry.resource;

      if (
        resource.code &&
        relevantProcedureCodes.includes(resource.code.coding[0].code)
      ) {
        summary.Procedures.push({
          Procedure: resource.code.text || "",
          Period: `${getYear(resource.performedPeriod?.start || "")}`,
        });
      }
    });

  // Process conditions
  conditionsData.entry.forEach((entry: { resource: PatientRecord }) => {
    const resource = entry.resource;
    summary.Conditions.push({
      Condition: resource.code?.text || "",
      ClinicalStatus: resource.clinicalStatus?.coding[0]?.code || "",
      VerificationStatus: resource.verificationStatus?.coding[0]?.code || "",
      Onset: getYear(resource.onsetDateTime || ""),
    });
  });

  // Process medications
  medicationsData.entry.forEach((entry: { resource: PatientRecord }) => {
    const resource = entry.resource;
    summary.Medications.push({
      Medication: resource.medicationCodeableConcept?.text || "",
      Dosage: Array.isArray(resource.dosage)
        ? resource.dosage[0]?.text || ""
        : "",
      Status: resource.status || "",
    });
  });

  // Process labs
  labsData.entry.forEach((entry: { resource: PatientRecord }) => {
    const resource = entry.resource;
    const observationType = resource.code?.text || "";
    const observationValue = resource.valueQuantity
      ? `${resource.valueQuantity.value} ${resource.valueQuantity.unit}`
      : "";

    if (observationValue) {
      const valueState = checkAbnormalValues(
        observationType,
        observationValue,
        summary.Gender
      );
      const { organ, description } = getCategory(observationType);
      if (!summary.LabResults[organ]) {
        summary.LabResults[organ] = [];
      }

      const testIndex = summary.LabResults[organ].findIndex(
        (test) => test.TestType === observationType
      );
      if (testIndex !== -1) {
        summary.LabResults[organ][testIndex].Results.push({
          Result: observationValue,
          normal: valueState.normal,
          message: valueState.message,
        });
      } else {
        summary.LabResults[organ].push({
          TestType: observationType,
          Description: description,
          Results: [
            {
              Result: observationValue,
              normal: valueState.normal,
              message: valueState.message,
            },
          ],
        });
      }
    }
  });

  // Process vitals
  vitalsData.entry.forEach((entry: { resource: PatientRecord }) => {
    const resource = entry.resource;
    const observationType = resource.code?.text || "";
    const observationTime = getYear(resource.effectiveDateTime || "");
    const { description } = getCategory(observationType);
    if (observationType === "Blood Pressure" && resource.component) {
      resource.component.forEach((component: any) => {
        const componentType = component.code?.text || "";
        const componentValue = component.valueQuantity
          ? `${component.valueQuantity.value} ${component.valueQuantity.unit}`
          : "";

        if (!vitalSignsMap[componentType]) {
          vitalSignsMap[componentType] = [];
        }

        if (componentValue && observationTime) {
          vitalSignsMap[componentType].push({
            effectiveDateTime: observationTime,
            description: description,
            value: componentValue,
          });
        }
      });
    } else {
      const observationValue = resource.valueQuantity
        ? `${resource.valueQuantity.value} ${resource.valueQuantity.unit}`
        : "";

      if (!vitalSignsMap[observationType]) {
        vitalSignsMap[observationType] = [];
      }

      if (observationValue && observationTime) {
        vitalSignsMap[observationType].push({
          effectiveDateTime: observationTime,
          description: description,
          value: observationValue,
        });
      }
    }
  });

  // Sort and filter vitals
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 360);

  Object.keys(vitalSignsMap).forEach((type) => {
    const filteredVitals = vitalSignsMap[type].filter((vital) => {
      const vitalDate = new Date(vital.effectiveDateTime);
      return vitalDate >= sixMonthsAgo;
    });

    const sortedVitals = filteredVitals.sort((a, b) =>
      b.effectiveDateTime.localeCompare(a.effectiveDateTime)
    );

    summary.VitalSigns[type] = sortedVitals.map((vital) => ({
      Value: vital.value,
      issued: getYear(vital.effectiveDateTime),
      Description: vital.description,
    }));
  });

  if (format === "text") {
    return summaryToPlainText(summary);
  } else {
    return summary;
  }
};
