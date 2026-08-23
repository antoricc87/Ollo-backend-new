// Import coefficients from JSON
const coefficients = {
  age: {
    M: { noTreatment: -0.018, treatment: -0.081 },
    F: { noTreatment: -0.01, treatment: 0.0 },
  },
  bmi: {
    "25-30": 0.301,
    "30+": 0.92,
  },
  hdl: {
    M: { low: 0.944 },
    F: { low: 0.944 },
  },
  triglycerides: 0.575,
  fastingGlucose: 1.98,
  parentalDiabetes: 0.565,
  bp: 0.498,
};

// Function to calculate risk score
export function calculateDiabetesRisk({
  age,
  gender,
  systolicBp,
  diastolicBp,
  hypertensionTreatment,
  height,
  weight,
  hdl,
  triglycerides,
  fastingGlucose,
  parentalDiabetes,
}: {
  age: number;
  gender: any;
  systolicBp: number;
  diastolicBp: number;
  hypertensionTreatment: boolean;
  height: number;
  weight: number;
  hdl: number;
  triglycerides: number;
  fastingGlucose: number;
  parentalDiabetes: boolean;
}): string {
  const bmi = (weight / (height * height)) * 703;

  const ageCoeff =
    age >= 50 && age < 65
      ? coefficients.age[gender].noTreatment
      : age >= 65
      ? coefficients.age[gender].treatment
      : 0;
  const bmiCoeff =
    bmi >= 30
      ? coefficients.bmi["30+"]
      : bmi >= 25 && bmi < 30
      ? coefficients.bmi["25-30"]
      : 0;
  const hdlCoeff =
    (gender === "M" && hdl < 40) || (gender === "F" && hdl < 50)
      ? coefficients.hdl[gender].low
      : 0;
  const triglycerideCoeff =
    triglycerides >= 150 ? coefficients.triglycerides : 0;
  const fastingGlucoseCoeff =
    fastingGlucose >= 100 ? coefficients.fastingGlucose : 0;
  const parentalDiabetesCoeff = parentalDiabetes
    ? coefficients.parentalDiabetes
    : 0;
  const bpCoeff =
    systolicBp > 130 || diastolicBp > 85 || hypertensionTreatment
      ? coefficients.bp
      : 0;

  const intercept = -5.517;

  const betaSum =
    intercept +
    ageCoeff +
    bmiCoeff +
    hdlCoeff +
    triglycerideCoeff +
    fastingGlucoseCoeff +
    parentalDiabetesCoeff +
    bpCoeff;

  const points =
    (fastingGlucose >= 100 ? 10 : 0) +
    (bmi >= 30 ? 5 : bmi >= 25 ? 2 : 0) +
    ((hdl < 40 && gender === "M") || (hdl < 50 && gender === "F") ? 5 : 0) +
    (parentalDiabetes ? 3 : 0) +
    (triglycerides >= 150 ? 3 : 0) +
    (systolicBp > 130 || diastolicBp > 85 || hypertensionTreatment ? 2 : 0);

  const riskTable = {
    10: "<3%",
    11: "4%",
    12: "4%",
    13: "5%",
    14: "6%",
    15: "7%",
    16: "9%",
    17: "11%",
    18: "13%",
    19: "15%",
    20: "18%",
    21: "21%",
    22: "25%",
    23: "29%",
    24: "33%",
  };

  return points >= 25 ? ">35%" : riskTable[points] || "<3%";
}
