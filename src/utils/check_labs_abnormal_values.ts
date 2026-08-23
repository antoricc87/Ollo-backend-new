const normalRanges: {
  [key: string]: {
    min?: number;
    max?: number;
    maleMin?: number;
    maleMax?: number;
    femaleMin?: number;
    femaleMax?: number;
  };
} = {
  "MCHC [Mass/volume] by Automated count": { min: 32, max: 36 }, // g/dL
  "Hematocrit [Volume Fraction] of Blood by Automated count": {
    maleMin: 40.7,
    maleMax: 50.3,
    femaleMin: 36.1,
    femaleMax: 44.3,
  }, // %
  "Hemoglobin [Mass/volume] in Blood": {
    maleMin: 13.8,
    maleMax: 17.2,
    femaleMin: 12.1,
    femaleMax: 15.1,
  }, // g/dL
  "Hemoglobin A1c/Hemoglobin.total in Blood": {
    min: 4.0,
    max: 5.7,
  },
  "Erythrocytes [#/volume] in Blood by Automated count": { min: 4.7, max: 6.1 }, // 10*6/uL
  "Leukocytes [#/volume] in Blood by Automated count": { min: 4.5, max: 11 }, // 10*3/uL
  "Platelet distribution width [Entitic volume] in Blood by Automated count": {
    min: 10,
    max: 20,
  }, // fL
  "Carbon Dioxide": { min: 23, max: 29 }, // mmol/L
  Chloride: { min: 98, max: 107 }, // mmol/L
  "Total Cholesterol": { min: 125, max: 200 }, // mg/dL
  "Aspartate aminotransferase [Enzymatic activity/volume] in Serum or Plasma": {
    min: 10,
    max: 40,
  }, // U/L
  "Platelets [#/volume] in Blood by Automated count": { min: 150, max: 450 }, // 10*3/uL
  "High Density Lipoprotein Cholesterol": { min: 40, max: 60 }, // mg/dL
  "Low Density Lipoprotein Cholesterol": { min: 0, max: 100 }, // mg/dL
  Triglycerides: { min: 0, max: 150 }, // mg/dL
  "NT-proBNP": { min: 0, max: 125 }, // pg/mL (varies with age)
  Sodium: { min: 135, max: 145 }, // mmol/L
  "MCV [Entitic volume] by Automated count": { min: 80, max: 100 }, // fL
  "MCH [Entitic mass] by Automated count": { min: 27, max: 33 }, // pg
  Calcium: { min: 8.5, max: 10.2 }, // mg/dL
  "WBC Auto (Bld) [#/Vol]": { min: 4.5, max: 11 }, // 10*3/uL
  Creatinine: {
    maleMin: 0.74,
    maleMax: 1.35,
    femaleMin: 0.59,
    femaleMax: 1.04,
  }, // mg/dL
  "Platelet mean volume [Entitic volume] in Blood by Automated count": {
    min: 7.5,
    max: 11.5,
  }, // fL
  "Alkaline phosphatase [Enzymatic activity/volume] in Serum or Plasma": {
    min: 44,
    max: 147,
  }, // U/L
  Glucose: { min: 70, max: 99 }, // mg/dL
  "Urea Nitrogen": { min: 6, max: 20 }, // mg/dL
  "Protein [Mass/volume] in Serum or Plasma": { min: 6, max: 8.3 }, // g/dL
  Potassium: { min: 3.5, max: 5.1 }, // mmol/L
  "RBC Auto (Bld) [#/Vol]": { min: 4.7, max: 6.1 }, // 10*6/uL
};

export const checkAbnormalValues = (
  observationType: string,
  observationValue: string,
  gender?: string
) => {
  const normalRange = normalRanges[observationType];

  if (!normalRange) {
    return {
      normal: null,
      message: `Error: observation not found`,
    };
  }

  const value = parseFloat(observationValue);

  if (isNaN(value)) {
    return {
      normal: null,
      message: `Error: values are not numbers`,
    };
  }

  let min: number | undefined;
  let max: number | undefined;

  if (
    gender === "male" &&
    normalRange.maleMin !== undefined &&
    normalRange.maleMax !== undefined
  ) {
    min = normalRange.maleMin;
    max = normalRange.maleMax;
  } else if (
    gender === "female" &&
    normalRange.femaleMin !== undefined &&
    normalRange.femaleMax !== undefined
  ) {
    min = normalRange.femaleMin;
    max = normalRange.femaleMax;
  } else {
    min = normalRange.min;
    max = normalRange.max;
  }

  if (min === undefined || max === undefined) {
    return {
      normal: null,
      message: `Undefined: range values are not defined`,
    };
  }

  if (value < min) {
    return {
      normal: false,
      message: `Low: Value is below the normal range of ${min} - ${max}`,
    };
  } else if (value > max) {
    return {
      normal: false,
      message: `High: Value is above the normal range of ${min} - ${max}`,
    };
  } else {
    return {
      normal: true,
      message: `Normal: Value is in the normal range of ${min} - ${max}`,
    };
  }
};
