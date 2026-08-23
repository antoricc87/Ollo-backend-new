import { Patient } from "../../types";
interface Biomarkers {
  Cardiovascular: string[];
  Liver: string[];
  Kidney: string[];
  Electrolytes: string[];
  Metabolism: string[];
  Hematologic: string[];
  Endocrine_Thyroid: string[];
  Vitamin: string[];
  Iron: string[];
  Infectious_Disease: string[];
}
interface ScreeningsByCategory {
  cancer: string[];
  chronic_conditions: string[];
  immunizations: string[];
  health_promotion: string[];
  reproductive_health: string[];
  pregnancy_related: string[];
  biomarkers: Biomarkers;
}

// Helper checks
const hasCondition = (conditions: string[], keyword: string) =>
  conditions.some((c) => c.toLowerCase().includes(keyword.toLowerCase()));

const inRange = (age: number, min: number, max: number) =>
  age >= min && age <= max;

export function getRecommendedScreenings(
  patient: Patient
): ScreeningsByCategory {
  console.log(patient);
  const { age, gender, conditions, familyHistory } = patient;

  const isFemale = gender === "female";
  const isMale = gender === "male";

  const screenings: ScreeningsByCategory = {
    cancer: [],
    chronic_conditions: [],
    immunizations: [],
    health_promotion: [],
    reproductive_health: [],
    pregnancy_related: [],
    biomarkers: {
      Cardiovascular: [
        "Total Cholesterol",
        "LDL (Low-Density Lipoprotein)",
        "HDL (High-Density Lipoprotein)",
        "Triglycerides",
        "VLDL",
        "Cholesterol/HDL Ratio",
      ],
      Liver: [
        "ALT  (Alanine Aminotransferase)",
        "AST (Aspartate Aminotransferase)",
        "ALP (Alkaline Phosphatase)",
        "Total Bilirubin",
        "Albumin",
        "Globulin",
        "A/G Ratio",
      ],
      Kidney: [
        "BUN (Blood Urea Nitrogen)",
        "Creatine",
        "BUN/Creatine Ratio",
        "eGFR",
      ],
      Electrolytes: ["Sodium", "Potassium", "Chloride", "Bicarbonate (COa..)"],
      Metabolism: ["Calcium", "Glucose"],
      Hematologic: [
        "WBC (White Blood Cell count)",
        "RBC (Red Blood Cell count)",
        "Hemoglobin",
        "Hematocrit",
        "MVC",
        "MCH",
        "MCHC",
        "RDW",
        "Platelets",
        "MPV",
      ],
      Endocrine_Thyroid: [],
      Vitamin: [],
      Iron: [],
      Infectious_Disease: [],
    },
  };

  // --- Cancer ---
  if (isFemale) {
    if (age >= 40) screenings.cancer.push("Breast cancer - Mammography");
    if (familyHistory.includes("breast cancer"))
      screenings.cancer.push("Genetic (BRCA) screening and counseling");
    if (age < 60)
      screenings.cancer.push(
        "Breast cancer - Preventive medication (high risk)"
      );
    if (age >= 21) screenings.cancer.push("Cervical cancer - Pap testing");
    if (inRange(age, 30, 65))
      screenings.cancer.push("Cervical cancer - HPV DNA testing");
  }

  if (inRange(age, 50, 75))
    screenings.cancer.push(
      "Colorectal cancer - Fecal test, sigmoidoscopy, colonoscopy"
    );
  if (inRange(age, 55, 80))
    screenings.cancer.push("Lung cancer - Annual low-dose CT (if smoker)");
  if (inRange(age, 18, 24)) screenings.cancer.push("Skin cancer - Counseling");

  // --- Chronic Conditions ---
  if (isMale && age >= 65 && familyHistory.includes("smoker")) {
    screenings.chronic_conditions.push("Abdominal aortic aneurysm screening");
  }

  screenings.chronic_conditions.push("Blood pressure screening");
  if (age >= 20) screenings.chronic_conditions.push("Lipid disorder screening");
  if (isMale && inRange(age, 45, 79))
    screenings.chronic_conditions.push("Aspirin use (CVD risk)");
  if (
    hasCondition(conditions, "obese") ||
    hasCondition(conditions, "overweight")
  ) {
    screenings.chronic_conditions.push("Behavioral counseling for CVD risk");
    screenings.chronic_conditions.push("Obesity screening and management");
  }
  if (hasCondition(conditions, "elevated blood pressure")) {
    screenings.chronic_conditions.push("Diabetes (Type 2) screening");
  }

  screenings.chronic_conditions.push("Depression screening");
  if (hasCondition(conditions, "hepatitis b"))
    screenings.chronic_conditions.push("Hepatitis B screening");
  if (inRange(age, 18, 79))
    screenings.chronic_conditions.push(
      "Hepatitis C screening (if born 1945–1965)"
    );
  if (isFemale && (age >= 65 || hasCondition(conditions, "fracture risk"))) {
    screenings.chronic_conditions.push("Osteoporosis screening");
  }

  // --- Immunizations ---
  screenings.immunizations.push("Influenza vaccine (yearly)");
  if (hasCondition(conditions, "hep a risk"))
    screenings.immunizations.push("Hepatitis A vaccine");
  if (hasCondition(conditions, "hep b risk"))
    screenings.immunizations.push("Hepatitis B vaccine");
  if ((isFemale && age <= 26) || (!isFemale && age <= 21))
    screenings.immunizations.push("HPV vaccine");
  if (hasCondition(conditions, "meningitis risk"))
    screenings.immunizations.push("Meningococcal vaccine");
  if (inRange(age, 19, 64)) screenings.immunizations.push("MMR vaccine");
  if (age >= 65 || hasCondition(conditions, "lung disease"))
    screenings.immunizations.push("Pneumococcal vaccine");
  screenings.immunizations.push("Tdap booster");
  if (age >= 60) screenings.immunizations.push("Zoster (shingles) vaccine");

  // --- Health Promotion ---
  if (hasCondition(conditions, "alcohol"))
    screenings.health_promotion.push("Alcohol misuse screening and counseling");
  if (age >= 65) screenings.health_promotion.push("Fall prevention counseling");
  if (isFemale)
    screenings.health_promotion.push("Intimate partner violence screening");
  if (hasCondition(conditions, "tobacco"))
    screenings.health_promotion.push("Tobacco cessation counseling");
  if (isFemale && inRange(age, 18, 64))
    screenings.health_promotion.push("Well-woman visits");

  // --- Reproductive Health ---
  if (isFemale) {
    screenings.reproductive_health.push(
      "Contraception counseling and methods",
      "Sterilization procedures",
      "Patient education on contraceptives"
    );

    if (age <= 24) {
      screenings.reproductive_health.push(
        "Chlamydia screening",
        "Gonorrhea screening"
      );
    }
  }

  screenings.reproductive_health.push("Syphilis screening");
  if (inRange(age, 15, 65))
    screenings.reproductive_health.push("HIV screening");
  if (hasCondition(conditions, "sti risk"))
    screenings.reproductive_health.push("STI and HIV counseling");

  // --- Pregnancy Related ---
  if (hasCondition(conditions, "pregnant")) {
    screenings.pregnancy_related.push(
      "Alcohol misuse counseling",
      "Breastfeeding supports (counseling, trained provider, equipment)",
      "Folic acid supplements",
      "Gestational diabetes screening (after 24 weeks)",
      "Iron deficiency anemia screening",
      "Preeclampsia prevention (low-dose aspirin after 12 weeks)",
      "Hepatitis B, Chlamydia, Gonorrhea, Syphilis, Bacteriuria screening",
      "Tobacco cessation counseling"
    );
  }

  // --- Biomarkers ---

  // Cardiovascular / Metabolic
  if (hasCondition(conditions, "overweight") && inRange(age, 35, 70)) {
    screenings.biomarkers.Cardiovascular.push("Hemoglobin A1c");
  }
  if (
    hasCondition(conditions, "inflammation") ||
    hasCondition(conditions, "cardiovascular") ||
    hasCondition(conditions, "cvd risk")
  ) {
    screenings.biomarkers.Cardiovascular.push("CRP (C-Reactive Protein)");
  }
  if (hasCondition(conditions, "heart failure")) {
    screenings.biomarkers.Cardiovascular.push(
      "BNP (B-type Natriuretic Peptide)"
    );
  }

  // Endocrine/Thyroid
  screenings.biomarkers.Endocrine_Thyroid.push("TSH");
  if (hasCondition(conditions, "thyroid")) {
    screenings.biomarkers.Endocrine_Thyroid.push("Free T4", "Free T3");
  }
  // Vitamin
  if (
    hasCondition(conditions, "vitamin d deficiency") ||
    hasCondition(conditions, "osteoporosis")
  ) {
    screenings.biomarkers.Vitamin.push("25-hydroxy Vitamin D");
  }
  if (
    hasCondition(conditions, "anemia") ||
    hasCondition(conditions, "neuropathy")
  ) {
    screenings.biomarkers.Vitamin.push("Vitamin B12");
  }
  if (hasCondition(conditions, "macrocytic anemia")) {
    screenings.biomarkers.Vitamin.push("Folate");
  }
  // Iron
  if (hasCondition(conditions, "anemia")) {
    screenings.biomarkers.Iron.push("Serum Iron");
  }
  if (hasCondition(conditions, "iron deficiency")) {
    screenings.biomarkers.Iron.push(
      "Ferritin",
      "TIBC",
      "Transferrin Saturation"
    );
  }
  // Infectious Disease
  if (inRange(age, 15, 65)) {
    screenings.biomarkers.Infectious_Disease.push("HIV 1/2 Ag/Ab");
  }
  if (hasCondition(conditions, "hep b risk")) {
    screenings.biomarkers.Infectious_Disease.push(
      "Hepatitis B Surface Antigen"
    );
  }
  if (inRange(age, 45, 65) || hasCondition(conditions, "hep c risk")) {
    screenings.biomarkers.Infectious_Disease.push("Hepatitis C Antibody");
  }
  if (
    hasCondition(conditions, "sti risk") ||
    hasCondition(conditions, "pregnant")
  ) {
    screenings.biomarkers.Infectious_Disease.push("RPR (Syphilis)");
  }

  return screenings;
}
