/**
 * Guideline-based lab & screening panel — deterministic, no LLM.
 *
 * Every rule carries its source so the app can show "why" and a clinician can
 * review the basis (the FDA CDS "independent review" criterion). Grades are
 * USPSTF letter grades where the source is USPSTF; other bodies are named.
 * This is a suggestion list to bring to a clinician — nothing here orders a
 * test. Citations verified 2026-08-28 against the USPSTF A&B list and each
 * society's guideline page (see the git log); re-verify when USPSTF
 * publishes the prostate update currently in draft.
 */

export type Sex = "female" | "male" | "other";
export type SmokingStatus = "current" | "former" | "never";

export type ScreeningProfile = {
  age: number | null;
  sex: Sex | null;
  bmi: number | null;
  smoking: SmokingStatus | null;
  /** lower-cased condition names from the record */
  conditions: string[];
  /** lower-cased medication names from the record */
  medications: string[];
  /** lower-cased dietary preferences (e.g. "vegan") */
  diet: string[];
  family: {
    breastOrOvarianCancer: boolean;
    colorectalCancer: boolean;
    prostateCancer: boolean;
    diabetes: boolean;
    earlyHeartDisease: boolean;
    highCholesterol: boolean;
    osteoporosis: boolean;
  };
  pregnant: boolean;
};

export type PanelKind = "LAB" | "SCREENING" | "VISIT";
export type PanelPriority = "DUE" | "CONSIDER" | "DISCUSS";

export type PanelSource = {
  org: string;
  year: number;
  grade?: string;
  url?: string;
};

export type PanelItem = {
  key: string;
  kind: PanelKind;
  title: string;
  /** personalised, one sentence, second person */
  reason: string;
  cadence: string;
  source: PanelSource;
  priority: PanelPriority;
  /** canonical biomarker keys (see utils/labBiomarkers) that satisfy a LAB item */
  biomarkers?: string[];
};

const USPSTF = (year: number, grade: string, slug: string): PanelSource => ({
  org: "USPSTF",
  year,
  grade,
  url: `https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/${slug}`,
});

const has = (list: string[], ...keywords: string[]) =>
  list.some((x) => keywords.some((k) => x.includes(k)));

const between = (age: number | null, min: number, max: number) =>
  age !== null && age >= min && age <= max;

/**
 * Build the panel for a profile. Order = the order the app shows within a
 * priority bucket. Coverage against existing labs is applied afterwards by
 * `applyCoverage` (profile.ts), not here.
 */
export const buildPanel = (p: ScreeningProfile): PanelItem[] => {
  const items: PanelItem[] = [];
  const age = p.age;
  const female = p.sex === "female";
  const male = p.sex === "male";
  const c = p.conditions;
  const m = p.medications;

  const diabetes = has(c, "diabetes", "diabetic");
  const prediabetes = has(c, "prediabet", "insulin resistance");
  const hypertension = has(c, "hypertension", "high blood pressure");
  const highCholesterol = has(c, "cholesterol", "hyperlipid", "dyslipid");
  const heartDisease = has(c, "coronary", "heart disease", "heart attack", "myocardial", "atherosclero", "stroke");
  const thyroid = has(c, "thyroid", "hashimoto", "graves", "hypothyroid", "hyperthyroid");
  const anemia = has(c, "anemia", "anaemia", "iron deficiency");
  const osteoporosis = has(c, "osteoporosis", "osteopenia");
  const ckd = has(c, "kidney disease", "ckd", "renal");
  const liver = has(c, "fatty liver", "nafld", "masld", "hepatitis", "liver");
  const overweight = (p.bmi !== null && p.bmi >= 25) || has(c, "overweight", "obes");
  const onStatin = has(m, "statin", "atorvastatin", "rosuvastatin", "simvastatin", "pravastatin");
  const onMetformin = has(m, "metformin");
  const onLevothyroxine = has(m, "levothyroxine", "eutirox", "synthroid");
  const plantBased = has(p.diet, "vegan", "vegetarian");
  const everSmoked = p.smoking === "current" || p.smoking === "former";

  /* ------------------------------- Blood labs ------------------------------ */

  if (age === null || age >= 20) {
    const risk = highCholesterol || diabetes || heartDisease || p.family.earlyHeartDisease || p.family.highCholesterol || onStatin;
    items.push({
      key: "lipid_panel",
      kind: "LAB",
      title: "Lipid panel",
      reason: onStatin
        ? "A statin is on your record; guidelines check cholesterol yearly while on treatment."
        : risk
        ? "Cholesterol, heart disease or diabetes is in your history; guidelines move this to yearly."
        : between(age, 40, 75)
        ? `You're ${age}; from 40 to 75 guidelines use cholesterol to estimate 10-year heart risk, which informs statin decisions.`
        : "Guidelines list a baseline lipid profile for adults from 20, repeated every 4–6 years.",
      cadence: risk ? "Yearly" : "Every 4–6 years",
      source: between(age, 40, 75) && !risk
        ? USPSTF(2022, "B", "statin-use-in-adults-preventive-medication")
        : { org: "ACC/AHA", year: 2018, url: "https://www.ahajournals.org/doi/10.1161/CIR.0000000000000625" },
      priority: "DUE",
      biomarkers: ["tcl", "ldl", "hdl", "triglycerides"],
    });
  }

  {
    const uspstf = between(age, 35, 70) && overweight;
    const managing = diabetes || prediabetes;
    const adaRisk = p.family.diabetes || hypertension || highCholesterol || (age !== null && age >= 35);
    if (managing || uspstf || adaRisk) {
      items.push({
        key: "hba1c_glucose",
        kind: "LAB",
        title: "HbA1c and fasting glucose",
        reason: managing
          ? "Diabetes or prediabetes is on your record; guidelines track HbA1c every 3–6 months."
          : uspstf
          ? `You're ${age} with a BMI over 25; the USPSTF recommends prediabetes and type 2 diabetes screening for that group.`
          : p.family.diabetes
          ? "Diabetes in a parent or sibling is a listed risk factor for screening."
          : "The ADA recommends prediabetes screening for adults from 35.",
        cadence: managing ? "Every 3–6 months" : "Every 3 years if normal",
        source: uspstf
          ? USPSTF(2021, "B", "screening-for-prediabetes-and-type-2-diabetes")
          : { org: "ADA Standards of Care", year: 2025, url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC11635041/" },
        priority: managing || uspstf ? "DUE" : "CONSIDER",
        biomarkers: ["hba1c", "glucose"],
      });
    }
  }

  items.push({
    key: "metabolic_panel",
    kind: "LAB",
    title: "Kidney, liver and electrolytes (CMP)",
    reason: diabetes || hypertension || ckd
      ? "Diabetes, high blood pressure or kidney disease is on your record; guidelines check kidney function (eGFR) and urine albumin yearly."
      : onStatin || onMetformin || liver
      ? "Your medication or liver history is on record; liver and kidney function are commonly checked yearly."
      : "Often part of a routine annual panel; there is no screening guideline for people without risk factors.",
    cadence: "Yearly",
    source: diabetes || hypertension || ckd
      ? { org: "KDIGO / ADA", year: 2024, url: "https://kdigo.org/wp-content/uploads/2024/03/KDIGO-2024-CKD-Guideline.pdf" }
      : { org: "Common annual-physical panel", year: 2026 },
    priority: diabetes || hypertension || ckd || onStatin || onMetformin || liver ? "DUE" : "CONSIDER",
    biomarkers: ["creatinine", "egfr", "alt"],
  });

  items.push({
    key: "cbc",
    kind: "LAB",
    title: "Complete blood count (CBC)",
    reason: anemia
      ? "Anemia is on your record; hemoglobin and red-cell indices track it."
      : "Often part of a routine annual panel; there is no screening guideline for people without symptoms.",
    cadence: "Yearly",
    source: { org: "Common annual-physical panel", year: 2026 },
    priority: anemia ? "DUE" : "CONSIDER",
    biomarkers: ["hemoglobin"],
  });

  items.push({
    key: "tsh",
    kind: "LAB",
    title: "Thyroid (TSH)",
    reason: thyroid || onLevothyroxine
      ? "A thyroid condition or thyroid medication is on your record; guidelines check TSH at least yearly."
      : "The USPSTF finds insufficient evidence for routine thyroid screening; it is often part of an annual panel anyway.",
    cadence: thyroid || onLevothyroxine ? "Every 6–12 months" : "Optional",
    source: thyroid || onLevothyroxine
      ? { org: "American Thyroid Association", year: 2014, url: "https://journals.sagepub.com/doi/10.1089/thy.2014.0028" }
      : USPSTF(2015, "I", "thyroid-dysfunction-screening"),
    priority: thyroid || onLevothyroxine ? "DUE" : "CONSIDER",
    biomarkers: ["tsh"],
  });

  if (osteoporosis || ckd || has(c, "vitamin d", "malabsorption", "celiac", "crohn") || p.family.osteoporosis) {
    items.push({
      key: "vitamin_d",
      kind: "LAB",
      title: "Vitamin D (25-OH)",
      reason: osteoporosis
        ? "Osteoporosis or low bone density is on your record."
        : "Something in your history raises the chance of low vitamin D; the USPSTF finds insufficient evidence for screening otherwise.",
      cadence: "Yearly",
      source: USPSTF(2021, "I", "vitamin-d-deficiency-screening"),
      priority: "DUE",
      biomarkers: ["vitamin d"],
    });
  }

  if (anemia || plantBased || onMetformin) {
    items.push({
      key: "ferritin_b12",
      kind: "LAB",
      title: "Ferritin and vitamin B12",
      reason: onMetformin
        ? "Metformin is on your record; it lowers B12 over time, and the ADA recommends periodic checks."
        : plantBased
        ? "A plant-based diet is on your record; B12 and iron stores are commonly checked."
        : "Anemia is on your record; iron stores and B12 explain most cases.",
      cadence: "Yearly",
      source: onMetformin
        ? { org: "ADA Standards of Care", year: 2025, url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC11635041/" }
        : { org: "Common clinical practice", year: 2026 },
      priority: "DUE",
      biomarkers: ["ferritin", "vitamin b12"],
    });
  }

  if (age === null || age >= 20) {
    const lpaRisk = p.family.earlyHeartDisease || p.family.highCholesterol || highCholesterol || heartDisease;
    items.push({
      key: "lipoprotein_a",
      kind: "LAB",
      title: "Lipoprotein(a) — once",
      reason: lpaRisk
        ? "Lp(a) is inherited and not in a standard lipid panel; with the heart or cholesterol history on your record, the NLA recommends measuring it once."
        : "Lp(a) is inherited and stable for life; the 2024 NLA statement recommends measuring it once in every adult.",
      cadence: "Once",
      source: { org: "National Lipid Association", year: 2024, url: "https://www.sciencedirect.com/science/article/pii/S1933287424000333" },
      priority: lpaRisk ? "DUE" : "CONSIDER",
      biomarkers: ["lipoprotein a"],
    });
  }

  if (between(age, 15, 65)) {
    items.push({
      key: "hiv",
      kind: "LAB",
      title: "HIV test — once",
      reason: "The USPSTF recommends one-time screening for everyone aged 15–65.",
      cadence: "Once (more often with risk)",
      source: USPSTF(2019, "A", "human-immunodeficiency-virus-hiv-infection-screening"),
      priority: "CONSIDER",
    });
  }

  if (between(age, 18, 79)) {
    items.push({
      key: "hepatitis_c",
      kind: "LAB",
      title: "Hepatitis C antibody — once",
      reason: "The USPSTF recommends one-time screening for all adults 18–79.",
      cadence: "Once",
      source: USPSTF(2020, "B", "hepatitis-c-screening"),
      priority: "CONSIDER",
    });
  }

  /* --------------------------- Non-blood screenings -------------------------- */

  if (between(age, 45, 75) || (p.family.colorectalCancer && between(age, 40, 75))) {
    items.push({
      key: "colorectal",
      kind: "SCREENING",
      title: "Colorectal cancer screening",
      reason: p.family.colorectalCancer
        ? "With a parent, brother or sister who had colorectal cancer, guidelines start at 40, or 10 years before their diagnosis if earlier — colonoscopy every 5 years if they were under 60."
        : between(age, 45, 49)
        ? "The USPSTF starts screening at 45 — a yearly stool test or a colonoscopy every 10 years are among the options."
        : "The USPSTF recommends screening for everyone 50–75 — a yearly stool test or a colonoscopy every 10 years are among the options.",
      cadence: "Stool test yearly · colonoscopy every 10 years",
      source: p.family.colorectalCancer
        ? { org: "US Multi-Society Task Force", year: 2017, url: "https://journals.lww.com/ajg/fulltext/2017/07000/colorectal_cancer_screening__recommendations_for.13.aspx" }
        : USPSTF(2021, between(age, 45, 49) ? "B" : "A", "colorectal-cancer-screening"),
      priority: p.family.colorectalCancer ? "DISCUSS" : "DUE",
    });
  }

  if (female && between(age, 40, 74)) {
    items.push({
      key: "mammography",
      kind: "SCREENING",
      title: "Mammogram",
      reason: p.family.breastOrOvarianCancer
        ? "The USPSTF recommends a mammogram every two years from 40; with breast or ovarian cancer in the family, ask whether to start earlier or add MRI."
        : "The USPSTF recommends a mammogram every two years from 40 to 74.",
      cadence: "Every 2 years",
      source: USPSTF(2024, "B", "breast-cancer-screening"),
      priority: "DUE",
    });
  }

  if (female && p.family.breastOrOvarianCancer) {
    items.push({
      key: "brca_assessment",
      kind: "SCREENING",
      title: "BRCA risk assessment",
      reason: "Breast or ovarian cancer is in your family; the USPSTF recommends a short risk assessment to see whether genetic counselling applies.",
      cadence: "Once",
      source: USPSTF(2019, "B", "brca-related-cancer-risk-assessment-genetic-counseling-and-genetic-testing"),
      priority: "DISCUSS",
    });
  }

  if (female && between(age, 21, 65)) {
    items.push({
      key: "cervical",
      kind: "SCREENING",
      title: "Cervical screening (Pap / HPV)",
      reason: between(age, 21, 29)
        ? "The USPSTF recommends a Pap test every 3 years from 21 to 29."
        : "The USPSTF recommends a Pap test every 3 years, or an HPV test every 5 years, from 30 to 65.",
      cadence: between(age, 21, 29) ? "Every 3 years" : "Every 3–5 years",
      source: USPSTF(2018, "A", "cervical-cancer-screening"),
      priority: "DUE",
    });
  }

  if (everSmoked && between(age, 50, 80)) {
    items.push({
      key: "lung_ldct",
      kind: "SCREENING",
      title: "Low-dose CT for lung cancer",
      reason: "The USPSTF recommends yearly screening for people 50–80 with a 20 pack-year history who smoke or quit in the last 15 years — ask whether that fits you.",
      cadence: "Yearly",
      source: USPSTF(2021, "B", "lung-cancer-screening"),
      priority: "DISCUSS",
    });
  }

  if (male && everSmoked && between(age, 65, 75)) {
    items.push({
      key: "aaa_ultrasound",
      kind: "SCREENING",
      title: "Abdominal aortic aneurysm ultrasound — once",
      reason: "The USPSTF recommends a one-time ultrasound for men 65–75 who have ever smoked.",
      cadence: "Once",
      source: USPSTF(2019, "B", "abdominal-aortic-aneurysm-screening"),
      priority: "DUE",
    });
  }

  if (female && (age !== null && age >= 65)) {
    items.push({
      key: "dxa",
      kind: "SCREENING",
      title: "Bone density (DXA)",
      reason: "The USPSTF recommends bone density screening for all women from 65.",
      cadence: "Every 2+ years",
      source: USPSTF(2025, "B", "osteoporosis-screening"),
      priority: "DUE",
    });
  } else if (female && between(age, 50, 64) && (osteoporosis || p.family.osteoporosis || p.smoking === "current")) {
    items.push({
      key: "dxa",
      kind: "SCREENING",
      title: "Bone density (DXA)",
      reason: "For postmenopausal women under 65 with a risk factor, the USPSTF recommends a fracture-risk estimate first, then possibly a scan.",
      cadence: "Discuss",
      source: USPSTF(2025, "B", "osteoporosis-screening"),
      priority: "DISCUSS",
    });
  }

  if (male && between(age, 55, 69)) {
    items.push({
      key: "psa",
      kind: "SCREENING",
      title: "PSA (prostate)",
      reason: p.family.prostateCancer
        ? "The USPSTF calls this an individual decision for men 55–69; family history is one reason men choose to test."
        : "The USPSTF calls this an individual decision for men 55–69 — benefits and harms are close (an update is in draft).",
      cadence: "Discuss",
      source: USPSTF(2018, "C", "prostate-cancer-screening"),
      priority: "DISCUSS",
    });
  }

  if (female && between(age, 15, 24)) {
    items.push({
      key: "chlamydia_gonorrhea",
      kind: "SCREENING",
      title: "Chlamydia and gonorrhea",
      reason: "The USPSTF recommends yearly screening for sexually active women 24 and under.",
      cadence: "Yearly",
      source: USPSTF(2021, "B", "chlamydia-and-gonorrhea-screening"),
      priority: "CONSIDER",
    });
  }

  /* -------------------------------- At the visit ------------------------------ */

  items.push({
    key: "blood_pressure",
    kind: "VISIT",
    title: "Blood pressure",
    reason: hypertension
      ? "High blood pressure is on your record; it is measured at every visit."
      : "The USPSTF recommends blood pressure screening for all adults; it is measured at visits.",
    cadence: "Every visit",
    source: USPSTF(2021, "A", "hypertension-in-adults-screening"),
    priority: "DUE",
  });

  items.push({
    key: "depression_screen",
    kind: "VISIT",
    title: "Mood check (PHQ-2)",
    reason: "The USPSTF recommends depression screening for all adults — two questions at the visit.",
    cadence: "Every visit",
    source: USPSTF(2023, "B", "screening-depression-suicide-risk-adults"),
    priority: "CONSIDER",
  });

  if (p.pregnant) {
    items.push({
      key: "prenatal",
      kind: "VISIT",
      title: "Prenatal panel",
      reason: "Pregnancy is on your record; prenatal labs follow their own schedule with your obstetric provider.",
      cadence: "Per trimester",
      source: { org: "ACOG", year: 2024, url: "https://www.acog.org/" },
      priority: "DISCUSS",
    });
  }

  return items;
};
