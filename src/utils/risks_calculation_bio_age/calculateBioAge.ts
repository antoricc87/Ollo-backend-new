export function calculatePhenotypicAge({
  age,
  albumin,
  creatinine,
  glucose,
  crp, // In mg/dL
  rdw,
  wbc,
  mcv,
  alkalinePhosphatase,
  lympocyte,
}: {
  age: number;
  albumin: number;
  creatinine: number;
  glucose: number;
  crp: number;
  rdw: number;
  wbc: number;
  mcv: number;
  lympocyte: number;
  alkalinePhosphatase: number;
}): number {
  try {
    // Coefficients for the Gompertz regression model
    const coefficients = {
      intercept: -19.907,
      albumin: -0.0336,
      creatinine: 0.0095,
      glucose: 0.1953,
      crp: 0.0954,
      rdw: 0.3306,
      wbc: 0.0554,
      mcv: 0.0268,
      alkalinePhosphatase: 0.0019,
      lympocyte: -0.012,
      age: 0.0804,
    };

    const gamma = 0.0076927; // Gompertz parameter for scaling
    const t = 120; // Time in months

    // Step 1: Compute Linear Predictor
    const logCRP = Math.log(crp * 0.1); // Log-transform CRP
    console.log("Log-transformed CRP:", logCRP);

    const xb =
      coefficients.intercept +
      coefficients.albumin * (albumin * 10) +
      coefficients.creatinine * (creatinine * 88.401) +
      coefficients.glucose * (glucose * 0.0555) +
      coefficients.crp * logCRP +
      coefficients.rdw * rdw +
      coefficients.wbc * wbc +
      coefficients.mcv * mcv +
      coefficients.alkalinePhosphatase * alkalinePhosphatase +
      coefficients.lympocyte * lympocyte +
      coefficients.age * age;

    // Step 2: Compute Mortality Score
    const mortalityScore =
      1 - Math.exp(-(Math.exp(xb) * (Math.exp(gamma * t) - 1)) / gamma);

    if (mortalityScore <= 0 || mortalityScore >= 1) {
      throw new Error(`Invalid mortality score value: ${mortalityScore}`);
    }

    // Step 3: Solve for Phenotypic Age
    const phenotypicAge =
      141.50225 + Math.log(-0.00553 * Math.log(1 - mortalityScore)) / 0.090165;

    console.log(phenotypicAge);

    // Check if phenotypic age is a valid number (not NaN, Infinity, negative, or null)
    if (isNaN(phenotypicAge) || !isFinite(phenotypicAge) || phenotypicAge < 0) {
      console.warn(
        `Invalid phenotypic age calculated: ${phenotypicAge}, returning age - 1.5`
      );
      return age - 1.5;
    }

    return phenotypicAge;
  } catch (error) {
    console.error("Error in calculatePhenotypicAge:", error);
    // Return phenotypic age 1.5 years younger than chronological age in case of error
    return age - 1.5;
  }
}
