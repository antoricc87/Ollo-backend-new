import { LabCategory } from "../types";

const categoryMap: { [key: string]: LabCategory } = {
  "Leukocytes [#/volume] in Blood by Automated count": {
    organ: "Immune System",
    description:
      "Leukocytes are white blood cells involved in protecting the body against infections.",
  },
  "Platelets [#/volume] in Blood by Automated count": {
    organ: "Immune System",
    description:
      "Platelets are cell fragments that play a key role in blood clotting.",
  },
  "Hemoglobin A1c/Hemoglobin.total in Blood": {
    organ: "Blood",
    description:
      "Hemoglobin A1c is a measure of average blood glucose levels over the past 3 months.",
  },
  "Hematocrit [Volume Fraction] of Blood by Automated count": {
    organ: "Blood",
    description:
      "Hematocrit is the proportion of red blood cells in the blood.",
  },
  "MCV [Entitic volume] by Automated count": {
    organ: "Blood",
    description:
      "Mean corpuscular volume (MCV) is a measure of the average size of red blood cells.",
  },
  "Erythrocytes [#/volume] in Blood by Automated count": {
    organ: "Blood",
    description:
      "Erythrocytes are red blood cells that carry oxygen from the lungs to the body.",
  },
  "Albumin [Mass/volume] in Serum or Plasma": {
    organ: "Liver",
    description:
      "Albumin is a protein made by the liver, essential for maintaining blood volume and pressure.",
  },
  Potassium: {
    organ: "Kidney",
    description:
      "Potassium is an essential electrolyte important for muscle and nerve function.",
  },
  "Carbon Dioxide": {
    organ: "Respiratory System",
    description:
      "Carbon dioxide is a waste product of respiration, expelled by the lungs.",
  },
  Chloride: {
    organ: "Kidney",
    description:
      "Chloride is an electrolyte that helps maintain fluid balance and pH levels in the body.",
  },
  Glucose: {
    organ: "Pancreas",
    description:
      "Glucose is a simple sugar that is the primary source of energy for the body's cells.",
  },
  Calcium: {
    organ: "Bones",
    description:
      "Calcium is a mineral essential for bone health and various cellular functions.",
  },
  Sodium: {
    organ: "Kidney",
    description:
      "Sodium is an essential electrolyte involved in fluid balance and nerve function.",
  },
  "Urea Nitrogen": {
    organ: "Kidney",
    description:
      "Urea nitrogen is a waste product formed in the liver and excreted by the kidneys.",
  },
  Creatinine: {
    organ: "Kidney",
    description:
      "Creatinine is a waste product of muscle metabolism, filtered out by the kidneys.",
  },
  "Alanine aminotransferase [Enzymatic activity/volume] in Serum or Plasma": {
    organ: "Liver",
    description:
      "ALT is an enzyme found in the liver, useful in diagnosing liver damage.",
  },
  "Globulin [Mass/volume] in Serum by calculation": {
    organ: "Liver",
    description:
      "Globulins are a group of proteins involved in liver function, blood clotting, and immunity.",
  },
  "Platelet distribution width [Entitic volume] in Blood by Automated count": {
    organ: "Immune System",
    description:
      "PDW indicates the variability in platelet size and can signal various health conditions.",
  },
  "Low Density Lipoprotein Cholesterol": {
    organ: "Heart",
    description:
      "LDL cholesterol, often called 'bad' cholesterol, can lead to plaque buildup in arteries.",
  },
  "High Density Lipoprotein Cholesterol": {
    organ: "Heart",
    description:
      "HDL cholesterol, known as 'good' cholesterol, helps remove other forms of cholesterol from the bloodstream.",
  },
  "Total Cholesterol": {
    organ: "Heart",
    description:
      "Total cholesterol is the sum of all cholesterol types in the blood.",
  },
  Triglycerides: {
    organ: "Heart",
    description:
      "Triglycerides are a type of fat found in the blood, and high levels can increase the risk of heart disease.",
  },
  "Alkaline phosphatase [Enzymatic activity/volume] in Serum or Plasma": {
    organ: "Liver",
    description:
      "ALP is an enzyme related to the bile ducts; often elevated when they are blocked.",
  },
  "Body Height": {
    organ: "General",
    description: "Body height is a measure of how tall an individual is.",
  },
  "Pain severity - 0-10 verbal numeric rating [Score] - Reported": {
    organ: "General",
    description: "A numeric rating of pain severity on a scale of 0 to 10.",
  },
  "Body Weight": {
    organ: "General",
    description: "Body weight is the measure of an individual's mass.",
  },
  "Body Mass Index": {
    organ: "General",
    description:
      "Body Mass Index (BMI) is a measure of body fat based on height and weight.",
  },
  "Blood Pressure": {
    organ: "Cardiovascular",
    description:
      "Blood pressure is the force of blood against the walls of arteries.",
  },
  "Tobacco smoking status NHIS": {
    organ: "Respiratory System",
    description:
      "The current smoking status of an individual as per the National Health Interview Survey.",
  },
  "Hemoglobin [Mass/volume] in Blood": {
    organ: "Blood",
    description:
      "Hemoglobin is the protein in red blood cells that carries oxygen.",
  },
  "Bilirubin.total [Mass/volume] in Serum or Plasma": {
    organ: "Liver",
    description:
      "Total bilirubin is a measure of all the bilirubin in the blood and can indicate liver function.",
  },
  "Aspartate aminotransferase [Enzymatic activity/volume] in Serum or Plasma": {
    organ: "Liver",
    description:
      "AST is an enzyme found in the liver and heart, useful in diagnosing liver and heart diseases.",
  },
  "RDW - Erythrocyte distribution width Auto (RBC) [Entitic vol]": {
    organ: "Blood",
    description: "RDW measures the variation in the size of red blood cells.",
  },
  "Protein [Mass/volume] in Serum or Plasma": {
    organ: "Liver",
    description:
      "Total protein in serum or plasma is a measure of all the proteins in the blood and can indicate nutritional status and liver function.",
  },
};

export const getCategory = (observationType: string): LabCategory => {
  return (
    categoryMap[observationType] || {
      organ: "Other",
      description: "No description available.",
    }
  );
};
