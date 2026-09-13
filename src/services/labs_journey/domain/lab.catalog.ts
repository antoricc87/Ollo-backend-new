import { BIOMARKERS, BiomarkerGuide } from "./biomarker.guide";

/**
 * Lab menu for the "order labs myself" path (Sep 12 2026) — modelled on Quest
 * Diagnostics' consumer menu (questhealth.com): three health-profile bundles
 * plus the common single tests and panels, grouped into health areas.
 *
 * NOT LIVE: there is no lab partner yet, so there are no prices, no ordering
 * and no state/age checks — the menu exists to test the flow. Bundle contents
 * list the main markers Quest names; the real profiles report more values.
 *
 * `buildLabMenu` also works out which products relate to the person's
 * screening panel ("related to your profile" — never "recommended").
 */

export type LabArea =
  | "heart"
  | "metabolic"
  | "liver_kidney"
  | "blood"
  | "nutrients"
  | "thyroid"
  | "hormones"
  | "sexual";

export const LAB_AREAS: { key: LabArea; label: string }[] = [
  { key: "heart", label: "Heart & circulation" },
  { key: "metabolic", label: "Blood sugar & metabolism" },
  { key: "liver_kidney", label: "Liver & kidney" },
  { key: "blood", label: "Blood & iron" },
  { key: "nutrients", label: "Vitamins & nutrients" },
  { key: "thyroid", label: "Thyroid" },
  { key: "hormones", label: "Hormones" },
  { key: "sexual", label: "Sexual health" },
];

export type Fasting = "required" | "recommended" | "not_required";

export type LabProduct = {
  key: string;
  name: string;
  kind: "bundle" | "panel" | "test";
  /** null for bundles, which span areas */
  area: LabArea | null;
  summary: string;
  about: string;
  biomarkers: string[];
  /** bundle markers that differ by sex (e.g. TSH for women, testosterone for men) */
  biomarkersBySex?: { female?: string[]; male?: string[] };
  /** product only offered for one sex */
  sex?: "female" | "male";
  fasting: Fasting;
  collection: string;
};

const LIPID = ["tcl", "ldl", "hdl", "triglycerides"];
const CMP = ["glucose", "bun", "creatinine", "egfr", "sodium", "potassium", "calcium", "albumin", "alt", "ast", "alp", "bilirubin"];
const CBC = ["hemoglobin", "hematocrit", "wbc", "platelets"];

export const LAB_PRODUCTS: LabProduct[] = [
  /* --------------------------------- Bundles -------------------------------- */
  {
    key: "basic_profile",
    name: "Basic health profile",
    kind: "bundle",
    area: null,
    summary: "Blood count, metabolic panel, cholesterol and urinalysis",
    about:
      "An entry-level check-up panel. It covers the labs most often drawn at an annual physical, plus TSH for women or testosterone for men. The main markers are listed; the full profile reports 59+ values.",
    biomarkers: [...CBC, ...CMP, ...LIPID, "urinalysis"],
    biomarkersBySex: { female: ["tsh"], male: ["testosterone_total"] },
    fasting: "recommended",
    collection: "Blood draw and urine sample",
  },
  {
    key: "comprehensive_profile",
    name: "Comprehensive health profile",
    kind: "bundle",
    area: null,
    summary: "The basic profile plus HbA1c, vitamin D and hs-CRP",
    about:
      "Adds long-term blood sugar, vitamin D and an inflammation marker to the basic profile. The main markers are listed; the full profile reports 75+ values.",
    biomarkers: [...CBC, ...CMP, ...LIPID, "urinalysis", "hba1c", "vitamin_d", "hs_crp"],
    biomarkersBySex: { female: ["tsh"], male: ["testosterone_total"] },
    fasting: "recommended",
    collection: "Blood draw and urine sample",
  },
  {
    key: "elite_profile",
    name: "Elite health profile",
    kind: "bundle",
    area: null,
    summary: "Adds ApoB, insulin, a full thyroid panel, iron and B vitamins",
    about:
      "The broadest profile: heart markers beyond cholesterol, insulin, thyroid hormones, testosterone, and the iron and B-vitamin markers behind tiredness and anemia. The main markers are listed; the full profile reports 85+ values.",
    biomarkers: [
      ...CBC,
      ...CMP,
      ...LIPID,
      "apob",
      "urinalysis",
      "hba1c",
      "insulin",
      "hs_crp",
      "tsh",
      "free_t4",
      "free_t3",
      "testosterone_total",
      "vitamin_d",
      "ferritin",
      "vitamin_b12",
      "folate",
    ],
    fasting: "recommended",
    collection: "Blood draw and urine sample",
  },

  /* ---------------------------------- Heart --------------------------------- */
  {
    key: "lipid_panel",
    name: "Cholesterol panel",
    kind: "panel",
    area: "heart",
    summary: "Total, LDL and HDL cholesterol, and triglycerides",
    about: "The standard cholesterol test, and the lab behind most heart-risk estimates.",
    biomarkers: LIPID,
    fasting: "recommended",
    collection: "Blood draw",
  },
  {
    key: "lpa",
    name: "Lipoprotein(a)",
    kind: "test",
    area: "heart",
    summary: "An inherited heart-risk marker, usually measured once",
    about: "Lp(a) is set mostly by genes and isn't part of a standard cholesterol panel.",
    biomarkers: ["lipoprotein_a"],
    fasting: "not_required",
    collection: "Blood draw",
  },
  {
    key: "apob",
    name: "Apolipoprotein B (ApoB)",
    kind: "test",
    area: "heart",
    summary: "A count of the particles that carry cholesterol",
    about: "ApoB counts the particles that can lodge in artery walls. Some clinicians use it alongside LDL.",
    biomarkers: ["apob"],
    fasting: "not_required",
    collection: "Blood draw",
  },
  {
    key: "hs_crp",
    name: "hs-CRP",
    kind: "test",
    area: "heart",
    summary: "A sensitive marker of inflammation",
    about: "High-sensitivity C-reactive protein reflects low-grade inflammation and is sometimes used to refine heart-risk estimates.",
    biomarkers: ["hs_crp"],
    fasting: "not_required",
    collection: "Blood draw",
  },
  {
    key: "homocysteine",
    name: "Homocysteine",
    kind: "test",
    area: "heart",
    summary: "An amino acid tied to B vitamins and blood vessels",
    about: "Levels rise when folate, B12 or B6 run low, and high levels are associated with heart and blood-vessel disease.",
    biomarkers: ["homocysteine"],
    fasting: "recommended",
    collection: "Blood draw",
  },

  /* ------------------------------- Metabolic -------------------------------- */
  {
    key: "hba1c",
    name: "Hemoglobin A1c",
    kind: "test",
    area: "metabolic",
    summary: "Average blood sugar over about three months",
    about: "The main test for prediabetes and diabetes, and for tracking blood sugar over time.",
    biomarkers: ["hba1c"],
    fasting: "not_required",
    collection: "Blood draw",
  },
  {
    key: "diabetes_monitoring",
    name: "HbA1c and fasting glucose",
    kind: "panel",
    area: "metabolic",
    summary: "The long-term average and a fasting reading together",
    about: "Pairs the three-month average with a single fasting value, the combination most often used for diabetes screening.",
    biomarkers: ["hba1c", "glucose"],
    fasting: "required",
    collection: "Blood draw",
  },
  {
    key: "insulin_resistance",
    name: "Insulin resistance panel",
    kind: "panel",
    area: "metabolic",
    summary: "Fasting glucose and fasting insulin",
    about: "Shows how much insulin the body needs to keep fasting blood sugar in range, which can rise years before blood sugar does.",
    biomarkers: ["glucose", "insulin"],
    fasting: "required",
    collection: "Blood draw",
  },

  /* ------------------------------ Liver & kidney ----------------------------- */
  {
    key: "cmp",
    name: "Comprehensive metabolic panel (CMP)",
    kind: "panel",
    area: "liver_kidney",
    summary: "Kidney and liver function, blood sugar, salts and proteins",
    about: "Fourteen routine chemistry values in one draw — a staple of the annual physical.",
    biomarkers: CMP,
    fasting: "recommended",
    collection: "Blood draw",
  },
  {
    key: "urinalysis",
    name: "Urinalysis",
    kind: "test",
    area: "liver_kidney",
    summary: "A routine check of the urine",
    about: "Looks for protein, sugar, blood and signs of infection — clues about the kidneys and urinary tract.",
    biomarkers: ["urinalysis"],
    fasting: "not_required",
    collection: "Urine sample",
  },

  /* ------------------------------- Blood & iron ------------------------------ */
  {
    key: "cbc",
    name: "Complete blood count (CBC)",
    kind: "panel",
    area: "blood",
    summary: "Red cells, white cells and platelets",
    about: "Counts the cells in the blood — the usual first look for anemia, infection and clotting problems.",
    biomarkers: CBC,
    fasting: "not_required",
    collection: "Blood draw",
  },
  {
    key: "iron_panel",
    name: "Iron, TIBC and ferritin",
    kind: "panel",
    area: "blood",
    summary: "Iron in the blood and the body's iron stores",
    about: "Separates low iron stores from other causes of anemia or tiredness.",
    biomarkers: ["iron", "tibc", "ferritin"],
    fasting: "recommended",
    collection: "Blood draw, often in the morning",
  },

  /* --------------------------- Vitamins & nutrients -------------------------- */
  {
    key: "vitamin_d",
    name: "Vitamin D (25-hydroxy)",
    kind: "test",
    area: "nutrients",
    summary: "Vitamin D status",
    about: "The standard measure of how much vitamin D the body has.",
    biomarkers: ["vitamin_d"],
    fasting: "not_required",
    collection: "Blood draw",
  },
  {
    key: "b12_folate",
    name: "Vitamin B12 and folate",
    kind: "panel",
    area: "nutrients",
    summary: "Two vitamins needed to make red blood cells",
    about: "Low levels of either can cause anemia and tiredness; B12 also matters for nerves.",
    biomarkers: ["vitamin_b12", "folate"],
    fasting: "not_required",
    collection: "Blood draw",
  },
  {
    key: "magnesium",
    name: "Magnesium",
    kind: "test",
    area: "nutrients",
    summary: "A mineral for muscles, nerves and heart rhythm",
    about: "A blood magnesium level; most of the body's magnesium sits in bone and cells, so it's one piece of the picture.",
    biomarkers: ["magnesium"],
    fasting: "not_required",
    collection: "Blood draw",
  },
  {
    key: "omega3",
    name: "Omega-3 and omega-6",
    kind: "panel",
    area: "nutrients",
    summary: "Fatty acids from fish, nuts and seeds",
    about: "Measures the omega-3 content of red blood cells, a reflection of intake over recent months.",
    biomarkers: ["omega3_index"],
    fasting: "not_required",
    collection: "Blood draw",
  },

  /* --------------------------------- Thyroid -------------------------------- */
  {
    key: "tsh",
    name: "TSH",
    kind: "test",
    area: "thyroid",
    summary: "The first check of thyroid function",
    about: "Thyroid-stimulating hormone is the usual starting test for an underactive or overactive thyroid.",
    biomarkers: ["tsh"],
    fasting: "not_required",
    collection: "Blood draw",
  },
  {
    key: "thyroid_panel",
    name: "Comprehensive thyroid panel",
    kind: "panel",
    area: "thyroid",
    summary: "TSH, thyroid hormones and thyroid antibodies",
    about: "Adds the thyroid hormones themselves and an antibody linked to autoimmune thyroid disease.",
    biomarkers: ["tsh", "free_t4", "free_t3", "tpo_antibodies"],
    fasting: "not_required",
    collection: "Blood draw",
  },

  /* -------------------------------- Hormones -------------------------------- */
  {
    key: "mens_hormones",
    name: "Men's hormone panel",
    kind: "panel",
    area: "hormones",
    summary: "Total and free testosterone, and SHBG",
    about: "Testosterone with the binding protein that decides how much of it is available to the body.",
    biomarkers: ["testosterone_total", "testosterone_free", "shbg"],
    sex: "male",
    fasting: "not_required",
    collection: "Blood draw, usually in the morning",
  },
  {
    key: "womens_hormones",
    name: "Women's hormone panel",
    kind: "panel",
    area: "hormones",
    summary: "Estradiol, progesterone, FSH and LH",
    about: "The main reproductive hormones; results are read against the point in the cycle or menopause status.",
    biomarkers: ["estradiol", "progesterone", "fsh", "lh"],
    sex: "female",
    fasting: "not_required",
    collection: "Blood draw; timing in the cycle matters",
  },
  {
    key: "cortisol",
    name: "Cortisol",
    kind: "test",
    area: "hormones",
    summary: "The main stress hormone",
    about: "Cortisol follows a daily rhythm, so a single morning value is the usual measure.",
    biomarkers: ["cortisol"],
    fasting: "not_required",
    collection: "Blood draw, usually in the morning",
  },
  {
    key: "psa",
    name: "PSA",
    kind: "test",
    area: "hormones",
    summary: "A prostate blood test",
    about: "Prostate-specific antigen. Screening with it is an individual decision because a raised level has many causes.",
    biomarkers: ["psa"],
    sex: "male",
    fasting: "not_required",
    collection: "Blood draw",
  },

  /* ------------------------------ Sexual health ------------------------------ */
  {
    key: "chlamydia_gonorrhea",
    name: "Chlamydia and gonorrhea",
    kind: "panel",
    area: "sexual",
    summary: "Two common infections that often cause no symptoms",
    about: "A single urine sample tests for both.",
    biomarkers: ["chlamydia", "gonorrhea"],
    fasting: "not_required",
    collection: "Urine sample",
  },
  {
    key: "std_basic",
    name: "STD panel, basic",
    kind: "panel",
    area: "sexual",
    summary: "Chlamydia, gonorrhea, syphilis and HIV",
    about: "Four common infections in one order.",
    biomarkers: ["chlamydia", "gonorrhea", "syphilis", "hiv"],
    fasting: "not_required",
    collection: "Blood draw and urine sample",
  },
  {
    key: "std_expanded",
    name: "STD panel, expanded",
    kind: "panel",
    area: "sexual",
    summary: "The basic panel plus hepatitis B and C and trichomoniasis",
    about: "Seven infections, including the two hepatitis viruses that can affect the liver silently for years.",
    biomarkers: ["chlamydia", "gonorrhea", "syphilis", "hiv", "hepatitis_b", "hepatitis_c", "trichomonas"],
    fasting: "not_required",
    collection: "Blood draw and urine sample",
  },
];

/**
 * Which catalog biomarkers a screening-panel LAB item needs (keys from
 * screening.rules.ts). Items not listed here are not lab orders — screenings
 * and visit checks that need a clinician.
 */
const SCREENING_LABS: Record<string, string[]> = {
  lipid_panel: LIPID,
  lipoprotein_a: ["lipoprotein_a"],
  hba1c_glucose: ["hba1c", "glucose"],
  metabolic_panel: ["creatinine", "egfr", "alt"],
  cbc: ["hemoglobin"],
  tsh: ["tsh"],
  vitamin_d: ["vitamin_d"],
  ferritin_b12: ["ferritin", "vitamin_b12"],
  hiv: ["hiv"],
  hepatitis_c: ["hepatitis_c"],
  chlamydia_gonorrhea: ["chlamydia", "gonorrhea"],
  psa: ["psa"],
};

type PanelItemLike = {
  key: string;
  title: string;
  reason: string;
  priority: string;
  covered: unknown;
  summary?: string;
};

export type LabMenu = {
  areas: typeof LAB_AREAS;
  products: LabProduct[];
  biomarkers: Record<string, BiomarkerGuide>;
  related: {
    /** open LAB items from the screening panel, each with the smallest single product that covers it */
    items: { screeningKey: string; title: string; reason: string; priority: string; productKey: string | null }[];
    bundles: { key: string; covers: string[] }[];
    /** the bundle covering the most related items (ties → the smaller bundle), null when none covers any */
    bestBundleKey: string | null;
    /** open panel items that aren't lab orders (screenings, visit checks) */
    needsClinician: { key: string; title: string; summary: string }[];
  };
};

export const buildLabMenu = (panelItems: PanelItemLike[], sex: string | null): LabMenu => {
  const s = sex === "female" || sex === "male" ? sex : null;
  const products = LAB_PRODUCTS.filter((p) => !p.sex || !s || p.sex === s).map((p) => {
    const { biomarkersBySex, ...rest } = p;
    const extra = s ? biomarkersBySex?.[s] ?? [] : [];
    return { ...rest, biomarkers: [...p.biomarkers, ...extra] };
  });
  const byKey = new Map(products.map((p) => [p.key, p]));

  const open = panelItems.filter((i) => !i.covered);
  const labItems = open.filter((i) => SCREENING_LABS[i.key]);
  const coversItem = (productKey: string, screeningKey: string) => {
    const have = byKey.get(productKey)?.biomarkers ?? [];
    return SCREENING_LABS[screeningKey].every((b) => have.includes(b));
  };

  const singles = products
    .filter((p) => p.kind !== "bundle")
    .sort((a, b) => a.biomarkers.length - b.biomarkers.length);
  const items = labItems.map((i) => ({
    screeningKey: i.key,
    title: i.title,
    reason: i.reason,
    priority: i.priority,
    productKey: singles.find((p) => coversItem(p.key, i.key))?.key ?? null,
  }));

  const bundles = products
    .filter((p) => p.kind === "bundle")
    .map((p) => ({ key: p.key, covers: labItems.filter((i) => coversItem(p.key, i.key)).map((i) => i.key) }));
  const best = [...bundles].sort(
    (a, b) => b.covers.length - a.covers.length || byKey.get(a.key)!.biomarkers.length - byKey.get(b.key)!.biomarkers.length
  )[0];

  return {
    areas: LAB_AREAS,
    products,
    biomarkers: BIOMARKERS,
    related: {
      items,
      bundles,
      bestBundleKey: best && best.covers.length > 0 ? best.key : null,
      needsClinician: open
        .filter((i) => !SCREENING_LABS[i.key])
        .map((i) => ({ key: i.key, title: i.title, summary: i.summary ?? "" })),
    },
  };
};
