/**
 * Plain-language catalog for the screening panel: which body system each item
 * belongs to, a one-line summary for the list row, and the "what it is / how
 * it's done" copy for the detail sheet. Keyed by PanelItem.key.
 *
 * Wording rule (user, Sep 12 2026): describe the test, never advise the
 * person — no "you need", "you should", "recommended for you". Drafted by
 * Claude from standard patient-education sources; needs clinical review
 * before production.
 */

export type ScreeningSystem =
  | "heart"
  | "metabolic"
  | "kidney_liver"
  | "blood"
  | "thyroid"
  | "cancer"
  | "bones"
  | "infections"
  | "mind"
  | "pregnancy"
  | "other";

const SYSTEMS: Record<ScreeningSystem, { label: string; order: number }> = {
  heart: { label: "Heart & circulation", order: 1 },
  metabolic: { label: "Blood sugar & metabolism", order: 2 },
  kidney_liver: { label: "Kidney & liver", order: 3 },
  blood: { label: "Blood, iron & vitamins", order: 4 },
  thyroid: { label: "Thyroid", order: 5 },
  cancer: { label: "Cancer screening", order: 6 },
  bones: { label: "Bones", order: 7 },
  infections: { label: "Infections", order: 8 },
  mind: { label: "Mood", order: 9 },
  pregnancy: { label: "Pregnancy", order: 10 },
  other: { label: "Other", order: 99 },
};

type Entry = { system: ScreeningSystem; summary: string; about: string; howDone: string };

const CATALOG: Record<string, Entry> = {
  lipid_panel: {
    system: "heart",
    summary: "Cholesterol and blood fats",
    about:
      "Measures total cholesterol, LDL (the kind that builds up in artery walls), HDL and triglycerides. With age and blood pressure, it feeds the 10-year heart-risk estimate clinicians use.",
    howDone: "A blood draw. Many labs no longer require fasting; the lab order says whether it's needed.",
  },
  lipoprotein_a: {
    system: "heart",
    summary: "An inherited heart-risk marker, measured once",
    about:
      "Lp(a) is a cholesterol-carrying particle whose level is set mostly by your genes. A high level adds to heart attack and stroke risk even when LDL is normal, and it barely changes over a lifetime.",
    howDone: "A blood draw, often added to a lipid panel. No fasting needed.",
  },
  blood_pressure: {
    system: "heart",
    summary: "Measured at the visit",
    about:
      "The pressure in your arteries while the heart beats and rests, written as two numbers such as 120/80. Raised blood pressure usually has no symptoms, which is why it's measured routinely.",
    howDone: "A cuff on the upper arm at the visit. Home readings over several days are also used.",
  },
  aaa_ultrasound: {
    system: "heart",
    summary: "A scan of the main artery in the abdomen",
    about:
      "Looks for a bulge (aneurysm) in the abdominal aorta. Aneurysms rarely cause symptoms before they become dangerous, and smoking is the biggest risk factor.",
    howDone: "A short ultrasound of the abdomen, done once.",
  },
  hba1c_glucose: {
    system: "metabolic",
    summary: "Blood sugar over the last few months",
    about:
      "HbA1c reflects average blood sugar over roughly three months; fasting glucose is a single reading. Together they show whether blood sugar is in the normal, prediabetes or diabetes range.",
    howDone: "A blood draw. Fasting glucose needs about 8 hours without food; HbA1c does not.",
  },
  metabolic_panel: {
    system: "kidney_liver",
    summary: "Kidney function, liver enzymes and salts",
    about:
      "A comprehensive metabolic panel (CMP) covers creatinine and eGFR for kidney function, liver enzymes such as ALT, and electrolytes like sodium and potassium.",
    howDone: "A blood draw, usually from the same sample as other labs. Some labs ask for fasting.",
  },
  cbc: {
    system: "blood",
    summary: "Red cells, white cells and platelets",
    about:
      "Counts the cells in your blood. It shows anemia (low hemoglobin), changes in white cells that can come with infection or inflammation, and platelets, which help blood clot.",
    howDone: "A blood draw. No fasting needed.",
  },
  ferritin_b12: {
    system: "blood",
    summary: "Iron stores and vitamin B12",
    about:
      "Ferritin shows how much iron the body has stored; B12 is needed to make red blood cells and keep nerves healthy. Low levels of either are common causes of tiredness and anemia.",
    howDone: "A blood draw. No fasting needed.",
  },
  vitamin_d: {
    system: "blood",
    summary: "Vitamin D level",
    about: "25-hydroxy vitamin D shows your vitamin D status, which matters for calcium balance and bone health.",
    howDone: "A blood draw. No fasting needed.",
  },
  tsh: {
    system: "thyroid",
    summary: "How your thyroid is working",
    about:
      "Thyroid-stimulating hormone (TSH) is the first test for an underactive or overactive thyroid, which affects energy, weight, heart rate and how warm or cold you feel.",
    howDone: "A blood draw. No fasting needed.",
  },
  hiv: {
    system: "infections",
    summary: "A one-time HIV check",
    about:
      "Detects HIV infection, which can go years without symptoms. Guidelines treat it as a routine test for everyone in the age range, not only people with known risk.",
    howDone: "A blood draw, or a finger-prick rapid test.",
  },
  hepatitis_c: {
    system: "infections",
    summary: "A one-time hepatitis C check",
    about:
      "Looks for antibodies to the hepatitis C virus, which can damage the liver silently for decades. A positive result is followed by a second test that confirms whether the infection is active.",
    howDone: "A blood draw, done once for most adults.",
  },
  chlamydia_gonorrhea: {
    system: "infections",
    summary: "Two common infections",
    about: "Chlamydia and gonorrhea often cause no symptoms, and untreated infections can affect fertility.",
    howDone: "A urine sample or a swab.",
  },
  colorectal: {
    system: "cancer",
    summary: "Colon and rectal cancer",
    about:
      "Finds cancer early, and a colonoscopy can remove polyps before they become cancer. There are several options, from stool tests at home to a colonoscopy, each repeated on its own schedule.",
    howDone:
      "A stool test kit at home (yearly, or every 1–3 years depending on the test), or a colonoscopy under sedation (every 10 years when normal).",
  },
  mammography: {
    system: "cancer",
    summary: "Breast cancer",
    about: "An X-ray of the breasts that can find cancer before a lump can be felt.",
    howDone: "A low-dose X-ray at an imaging centre; each breast is pressed briefly between two plates. About 20 minutes.",
  },
  brca_assessment: {
    system: "cancer",
    summary: "Inherited breast and ovarian cancer risk",
    about:
      "A short set of questions about family history estimates whether a BRCA1 or BRCA2 gene change is possible. It decides whether genetic counselling and testing are worth discussing; it is not the gene test itself.",
    howDone: "Questions at the visit, or a validated questionnaire the clinician uses.",
  },
  cervical: {
    system: "cancer",
    summary: "Cervical cancer",
    about:
      "A Pap test looks for abnormal cells on the cervix; an HPV test looks for the virus behind most cervical cancers.",
    howDone: "A quick swab during a pelvic exam. Some HPV tests can be self-collected.",
  },
  lung_ldct: {
    system: "cancer",
    summary: "Lung cancer, for long-term smokers",
    about: "A low-dose CT scan that can find lung cancer early in people with a long smoking history.",
    howDone: "A CT scan lasting a few minutes, with no injection. Repeated yearly while the criteria apply.",
  },
  psa: {
    system: "cancer",
    summary: "A prostate blood test",
    about:
      "PSA is a protein made by the prostate. A raised level can come from cancer, but also from an enlarged prostate or inflammation, so a high result often leads to more tests. That trade-off is why it's a personal decision.",
    howDone: "A blood draw. Ejaculation or vigorous cycling in the day or two before can raise the level.",
  },
  dxa: {
    system: "bones",
    summary: "Bone density scan",
    about: "A DXA scan measures bone density at the hip and spine to find osteoporosis before a fracture happens.",
    howDone: "A low-dose X-ray scan lying on a table, about 10–20 minutes.",
  },
  depression_screen: {
    system: "mind",
    summary: "A short mood check",
    about:
      "Two questions (PHQ-2) about low mood and loss of interest over the past two weeks. A yes to either is followed by a longer questionnaire.",
    howDone: "Questions at the visit, on paper or asked by the clinician.",
  },
  prenatal: {
    system: "pregnancy",
    summary: "Labs during pregnancy",
    about: "Blood type, blood counts, infection screening and glucose testing at set points in pregnancy.",
    howDone: "Blood draws and urine samples scheduled by the obstetric provider.",
  },
};

export type ScreeningInfo = {
  system: ScreeningSystem;
  systemLabel: string;
  systemOrder: number;
  summary: string;
  about: string;
  howDone: string;
};

/** Attach the catalog entry to each panel item (unknown keys land in "Other"). */
export const withCatalog = <T extends { key: string; title: string }>(items: T[]): (T & ScreeningInfo)[] =>
  items.map((item) => {
    const entry = CATALOG[item.key];
    const system = entry?.system ?? "other";
    return {
      ...item,
      system,
      systemLabel: SYSTEMS[system].label,
      systemOrder: SYSTEMS[system].order,
      summary: entry?.summary ?? "",
      about: entry?.about ?? "",
      howDone: entry?.howDone ?? "",
    };
  });
