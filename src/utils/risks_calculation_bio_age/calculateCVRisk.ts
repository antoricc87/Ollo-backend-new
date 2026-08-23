// Import coefficients from JSON (assuming the same structure as before)
import { CVRiskData } from "../../types";
import coefficients from "../../utils/coefficients.json";

// Constants for baseline survival rates and constants
const baselineSurvivalRates = {
  male: 0.88936,
  female: 0.95012,
};

// Main function to calculate the risk score given specific values
const calculateRiskScore = (
  gender: any,
  age: number,
  sbp: number,
  tcl: number,
  hdl: number,
  smoker: boolean,
  diabetic: boolean,
  treatmentStatus: "noTreatment" | "treatment"
): number => {
  // Validate inputs
  if (
    !age ||
    age <= 0 ||
    !sbp ||
    sbp <= 0 ||
    !tcl ||
    tcl <= 0 ||
    !hdl ||
    hdl <= 0
  ) {
    throw new Error(
      "Invalid input values: age, sbp, tcl, and hdl must be positive numbers."
    );
  }

  // Fetch coefficients with fallbacks for treatment null values
  const ageCoeff =
    coefficients.age[gender]?.[treatmentStatus] ??
    coefficients.age[gender]?.noTreatment ??
    0;
  const sbpCoeff =
    coefficients.sbp[gender]?.[treatmentStatus] ??
    coefficients.sbp[gender]?.noTreatment ??
    0;
  const tclCoeff =
    coefficients.tcl[gender]?.[treatmentStatus] ??
    coefficients.tcl[gender]?.noTreatment ??
    0;
  const hdlCoeff =
    coefficients.hdl[gender]?.[treatmentStatus] ??
    coefficients.hdl[gender]?.noTreatment ??
    0;
  const smokeCoeff =
    coefficients.smoke[gender]?.[treatmentStatus] ??
    coefficients.smoke[gender]?.noTreatment ??
    0;
  const diabCoeff =
    coefficients.diab[gender]?.[treatmentStatus] ??
    coefficients.diab[gender]?.noTreatment ??
    0;

  // Calculate each term in Σβx
  const ageTerm = Math.log(age) * ageCoeff;
  const sbpTerm = Math.log(sbp) * sbpCoeff;
  const tclTerm = Math.log(tcl) * tclCoeff;
  const hdlTerm = Math.log(hdl) * hdlCoeff;
  const smokeTerm = smoker ? smokeCoeff : 0;
  const diabTerm = diabetic ? diabCoeff : 0;

  const betaSum = ageTerm + sbpTerm + tclTerm + hdlTerm + smokeTerm + diabTerm;

  // Get baseline survival rate and constant based on gender
  const baselineSurvival =
    baselineSurvivalRates[gender === "M" ? "male" : "female"];
  const constant = coefficients.const[gender]?.noTreatment;

  if (!baselineSurvival || !constant) {
    throw new Error(
      `Invalid gender or missing constants for gender: ${gender}`
    );
  }

  // Calculate the risk score
  return 1 - Math.pow(baselineSurvival, Math.exp(betaSum - constant));
};

// Function to calculate the User's Custom Risk Score
export function calculateUserRiskScore(userInput: {
  gender: any;
  age: number;
  sbp: number;
  tcl: number;
  hdl: number;
  smoker: boolean;
  diabetic: boolean;
  treatmentStatus: "noTreatment" | "treatment";
}): number {
  const { gender, age, sbp, tcl, hdl, smoker, diabetic, treatmentStatus } =
    userInput;
  return calculateRiskScore(
    gender,
    age,
    sbp,
    tcl,
    hdl,
    smoker,
    diabetic,
    treatmentStatus
  );
}

// Function to calculate the Optimal Risk Score
export function calculateOptimalRiskScore(
  gender: "M" | "F",
  age: number
): number {
  const optimalSBP = 110;
  const optimalTCL = 160;
  const optimalHDL = 60;
  const smoker = false;
  const diabetic = false;
  const treatmentStatus: "noTreatment" = "noTreatment";

  return calculateRiskScore(
    gender,
    age,
    optimalSBP,
    optimalTCL,
    optimalHDL,
    smoker,
    diabetic,
    treatmentStatus
  );
}

// Function to calculate the Normal Risk Score
export function calculateNormalRiskScore(
  gender: "M" | "F",
  age: number
): number {
  const normalSBP = 125;
  const normalTCL = 180;
  const normalHDL = 45;
  const smoker = false;
  const diabetic = false;
  const treatmentStatus: "noTreatment" = "noTreatment";

  return calculateRiskScore(
    gender,
    age,
    normalSBP,
    normalTCL,
    normalHDL,
    smoker,
    diabetic,
    treatmentStatus
  );
}

export const calculateCVRisk = (userData: CVRiskData) => {
  const { gender, age } = userData;
  const userRiskScore = calculateUserRiskScore(userData);
  const optimalRiskScore = calculateOptimalRiskScore(gender, age);
  const normalRiskScore = calculateNormalRiskScore(gender, age);
  return {
    optimalCVRisk: optimalRiskScore,
    patientRiskScore: userRiskScore,
    normalCVRiskScore: normalRiskScore,
  };
};
