/**
 * Plain-language biomarker guide for the lab menu and results. One entry per
 * biomarker key used by lab.catalog.ts. Wording rule: describe, never advise
 * the individual. Claude-drafted from patient-education sources (MedlinePlus,
 * testing.com, NIH ODS, CDC); needs clinical review before production.
 */

export type BiomarkerGuide = {
  key: string;
  name: string;            // display name, e.g. "LDL cholesterol"
  short: string;           // one line, <= 60 chars, e.g. "The cholesterol that builds up in artery walls"
  result: "range" | "detected"; // "detected" for infections / yes-no tests
  whatItIs: string;        // 1–2 sentences
  whyChecked: string;      // 1–2 sentences: why people and clinicians look at it
  high: string | null;     // range: what a high value can mean (common causes, what it's associated with). detected: what a positive result means.
  low: string | null;      // range: what a low value can mean, or null when low isn't clinically meaningful. detected: null.
  whatCanBeDone: string;   // 2–3 sentences: common next steps clinicians discuss (repeat test, related tests, lifestyle factors known to move it, treatment options exist when relevant, when follow-up is usually prompt). Descriptive, never directive.
  affectedBy?: string;     // optional one sentence: things that can skew a result (fasting, biotin, recent exercise, time of day, pregnancy...)
};

export const BIOMARKERS: Record<string, BiomarkerGuide> = {
  // ─── Heart and blood vessels ──────────────────────────────────────────────

  tcl: {
    key: "tcl",
    name: "Total cholesterol",
    short: "All the cholesterol carried in the blood",
    result: "range",
    whatItIs:
      "Cholesterol is a waxy fat the body uses to build cells and make hormones. Total cholesterol adds up the cholesterol carried in LDL, HDL and other particles.",
    whyChecked:
      "It is part of the standard lipid panel used to estimate heart and blood vessel risk. It is most useful next to LDL and HDL, because it mixes the harmful and protective kinds together.",
    high:
      "A value of 200 mg/dL or above is often called borderline high, and 240 mg/dL or above high, though cutoffs vary by lab. High total cholesterol is linked to a higher risk of heart disease and stroke, mainly when LDL is the part driving it. Common causes include family history, diets high in saturated fat, low activity, excess weight, an underactive thyroid, kidney disease and some medicines. A high HDL can also push the total up.",
    low:
      "Very low total cholesterol is uncommon. It can occur with cholesterol-lowering medicine, an overactive thyroid, liver disease, malnutrition or rare inherited conditions.",
    whatCanBeDone:
      "Clinicians commonly look at LDL, HDL and triglycerides to see what is behind the number, and use it with blood pressure, age and other factors to estimate 10-year heart risk. Eating patterns, physical activity, weight and smoking are known to move cholesterol levels. When overall risk is high, cholesterol-lowering medicines are an option clinicians discuss.",
    affectedBy:
      "Recent illness, pregnancy and some medicines can shift the result; fasting matters less for total cholesterol than for triglycerides.",
  },

  ldl: {
    key: "ldl",
    name: "LDL cholesterol",
    short: "The cholesterol that builds up in artery walls",
    result: "range",
    whatItIs:
      "LDL (low-density lipoprotein) carries cholesterol through the blood to the body's tissues. When there is too much, it can settle into artery walls and form plaque.",
    whyChecked:
      "LDL is the main cholesterol number used to judge heart attack and stroke risk. It is also the usual target when cholesterol treatment is considered.",
    high:
      "Commonly used categories are below 100 mg/dL optimal, 100–129 near optimal, 130–159 borderline high, 160–189 high and 190 or above very high; lab reports may differ. Higher LDL is linked to plaque buildup and a higher risk of heart attack and stroke. Common causes include family history, diets high in saturated and trans fats, excess weight, low activity, an underactive thyroid, kidney disease and some medicines. A level of 190 mg/dL or above can point to an inherited condition called familial hypercholesterolemia.",
    low:
      "Low LDL is generally not a concern and is often the goal of treatment. Unusually low levels without treatment can occur with an overactive thyroid, malnutrition, liver disease or rare inherited conditions.",
    whatCanBeDone:
      "Clinicians commonly read LDL together with apoB, Lp(a), blood pressure, diabetes status and family history to estimate overall risk. Less saturated fat, more fiber, regular activity and weight loss are known to lower LDL. Several classes of cholesterol-lowering medicines exist, and very high levels often lead to testing of close relatives.",
    affectedBy:
      "LDL is often calculated from the other lipid values, so very high triglycerides can make it less accurate; recent illness and pregnancy can also shift it.",
  },

  hdl: {
    key: "hdl",
    name: "HDL cholesterol",
    short: "The cholesterol that helps clear excess from arteries",
    result: "range",
    whatItIs:
      "HDL (high-density lipoprotein) picks up extra cholesterol and carries it back to the liver to be removed. It is often called the \"good\" cholesterol.",
    whyChecked:
      "Low HDL is one of the factors used to estimate heart disease risk. It is also part of the definition of metabolic syndrome.",
    high:
      "Higher HDL is usually seen as favorable, and 60 mg/dL or above is often described as protective. Very high levels, which can come from genetics, alcohol use or some medicines, do not appear to add extra protection in large studies.",
    low:
      "HDL below 40 mg/dL in men or below 50 mg/dL in women is commonly considered low, though ranges vary by lab. Low HDL is linked to higher heart disease risk and often travels with high triglycerides, insulin resistance and excess belly fat. Smoking, inactivity, type 2 diabetes and some medicines can lower it.",
    whatCanBeDone:
      "Clinicians usually treat low HDL as a signal to look at overall risk, especially LDL, triglycerides and blood sugar. Regular aerobic activity, stopping smoking and weight loss can raise HDL modestly. Medicines that raise HDL on their own have not been shown to prevent heart attacks, so treatment usually focuses on other risk factors.",
    affectedBy:
      "Recent illness, some medicines (including anabolic steroids and some blood pressure drugs) and alcohol intake can shift HDL.",
  },

  triglycerides: {
    key: "triglycerides",
    name: "Triglycerides",
    short: "The main type of fat stored and carried in the blood",
    result: "range",
    whatItIs:
      "Triglycerides are fats that store extra energy from food. The body releases them between meals for fuel.",
    whyChecked:
      "High triglycerides are linked to heart disease and are a common sign of insulin resistance. Very high levels can inflame the pancreas.",
    high:
      "Fasting values are commonly grouped as below 150 mg/dL normal, 150–199 borderline high, 200–499 high and 500 or above very high; labs may differ. Common causes include excess weight, diets high in sugar and refined starches, alcohol, low activity, uncontrolled diabetes, an underactive thyroid, kidney disease, genetics and some medicines. Levels of 500 mg/dL or more raise the risk of pancreatitis.",
    low:
      "Low triglycerides are usually not a concern. Unusually low levels can occur with a very low-fat diet, an overactive thyroid, malnutrition or conditions that block fat absorption.",
    whatCanBeDone:
      "Clinicians commonly repeat a high result after fasting and check blood sugar, A1C, thyroid and kidney function. Cutting back on alcohol and added sugars, regular activity and weight loss are known to lower triglycerides, often substantially. Medicines exist, and very high levels are usually treated promptly to protect the pancreas.",
    affectedBy:
      "Eating within 8–12 hours of the test and drinking alcohol in the days before can raise the result.",
  },

  apob: {
    key: "apob",
    name: "Apolipoprotein B (apoB)",
    short: "A count of particles that carry cholesterol into arteries",
    result: "range",
    whatItIs:
      "ApoB is a protein found on every LDL particle and on other particles that can enter artery walls, including Lp(a). Because each particle carries one apoB, the test works like a particle count.",
    whyChecked:
      "ApoB can show risk that LDL misses, especially when triglycerides are high or in people with diabetes or excess weight. Many clinicians use it to refine risk or to judge how well treatment is working.",
    high:
      "The 2018 US cholesterol guideline treats 130 mg/dL or above as a risk-enhancing factor, and many clinicians use lower targets for people at higher risk; lab ranges vary. High apoB means more particles that can deposit cholesterol in arteries, which is linked to higher heart attack and stroke risk. Common causes overlap with high LDL and triglycerides, including genetics, diet, excess weight, insulin resistance and an underactive thyroid.",
    low:
      "Low apoB is generally favorable and often reflects cholesterol-lowering treatment. Very low levels without treatment are rare and can reflect inherited conditions or malnutrition.",
    whatCanBeDone:
      "Clinicians commonly look at apoB next to LDL, non-HDL cholesterol and Lp(a) when deciding how intensive prevention needs to be. The same habits that lower LDL and triglycerides tend to lower apoB. Cholesterol-lowering medicines lower apoB, and it is sometimes used to track treatment.",
    affectedBy:
      "Fasting has little effect on apoB; pregnancy, an underactive thyroid and some medicines can raise it.",
  },

  lipoprotein_a: {
    key: "lipoprotein_a",
    name: "Lipoprotein(a)",
    short: "An inherited cholesterol particle linked to heart risk",
    result: "range",
    whatItIs:
      "Lipoprotein(a), or Lp(a), is an LDL-like particle with an extra protein attached. Its level is set mostly by genes and stays fairly stable through adult life.",
    whyChecked:
      "High Lp(a) raises the risk of heart attack, stroke and narrowing of the aortic valve, even when LDL looks normal. Because it changes little over time, it is often measured once, and it helps explain early heart disease in a family.",
    high:
      "Levels of 50 mg/dL or above (or 125 nmol/L or above) are commonly treated as risk-enhancing; the two units are not directly convertible, and cutoffs vary. Roughly one in five people has an elevated level. A high value is linked to earlier and more frequent heart disease and to aortic valve stenosis, and it often runs in families.",
    low: null,
    whatCanBeDone:
      "Diet and exercise have little effect on Lp(a), so clinicians commonly focus on lowering the risks that can be changed, such as LDL, blood pressure, blood sugar and smoking. Testing of parents, siblings and children is often discussed because the trait is inherited. Treatments aimed specifically at lowering Lp(a) are being studied.",
    affectedBy:
      "Pregnancy, menopause, kidney disease and inflammation can raise levels somewhat.",
  },

  hs_crp: {
    key: "hs_crp",
    name: "High-sensitivity CRP",
    short: "A marker of low-grade inflammation in the body",
    result: "range",
    whatItIs:
      "C-reactive protein (CRP) is made by the liver when there is inflammation. The high-sensitivity version measures very small amounts.",
    whyChecked:
      "Ongoing low-grade inflammation plays a role in plaque buildup, so hs-CRP is sometimes used to refine heart disease risk. It is not specific to the heart and rises with many other conditions.",
    high:
      "For heart risk, results are commonly grouped as below 1 mg/L lower risk, 1–3 mg/L average and above 3 mg/L higher risk. Persistently raised levels can come from excess weight, smoking, insulin resistance, gum disease, arthritis and other chronic inflammatory conditions. A level above 10 mg/L usually points to a current infection, injury or flare rather than heart risk.",
    low: null,
    whatCanBeDone:
      "Because a cold or minor injury can raise it, clinicians commonly repeat hs-CRP about two weeks later and use the average. Weight loss, regular activity, stopping smoking and treating underlying inflammatory conditions are known to lower it. A level above 10 mg/L usually leads to a search for an infection or other cause of inflammation.",
    affectedBy:
      "Recent infection, injury, hard exercise, hormone therapy, birth control pills and pregnancy can raise the result.",
  },

  homocysteine: {
    key: "homocysteine",
    name: "Homocysteine",
    short: "An amino acid tied to B vitamins and blood vessels",
    result: "range",
    whatItIs:
      "Homocysteine is an amino acid made when the body breaks down protein. Vitamins B12, B6 and folate help convert it into other substances.",
    whyChecked:
      "A raised level can signal a shortage of B12 or folate. High levels are also linked to heart disease, stroke and blood clots.",
    high:
      "Many labs list about 5–15 µmol/L as typical, though ranges vary. Common causes include low B12, folate or B6, kidney disease, an underactive thyroid, heavy alcohol use, smoking, some medicines and inherited differences in how the body processes it. Very high levels can point to a rare inherited condition called homocystinuria.",
    low: null,
    whatCanBeDone:
      "Clinicians commonly check B12, folate and kidney function to find the cause. Correcting a vitamin shortage usually lowers homocysteine. Large studies found that lowering it with B vitamins did not clearly reduce heart attacks, so it is mainly used to guide the search for a cause.",
    affectedBy:
      "A recent protein-rich meal can raise it, so fasting samples are often preferred; pregnancy tends to lower it.",
  },

  // ─── Blood sugar ──────────────────────────────────────────────────────────

  hba1c: {
    key: "hba1c",
    name: "Hemoglobin A1C",
    short: "Average blood sugar over the past two to three months",
    result: "range",
    whatItIs:
      "A1C measures the percentage of hemoglobin in red blood cells that has sugar attached. Because red cells live about three months, it reflects average blood sugar over that time.",
    whyChecked:
      "It is one of the main tests used to screen for and diagnose prediabetes and diabetes. It is also used to track how well diabetes is controlled.",
    high:
      "Below 5.7% is considered normal, 5.7% to 6.4% indicates prediabetes, and 6.5% or above on two tests indicates diabetes. Higher values mean blood sugar has been running high, which over time can damage blood vessels, nerves, eyes and kidneys. Common contributors include insulin resistance, excess weight, low activity, family history and some medicines such as steroids.",
    low:
      "A low A1C is usually not a concern. It can be falsely low when red blood cells are replaced faster than usual, such as after blood loss or transfusion or with some types of anemia, and it can reflect frequent low blood sugar in people taking diabetes medicines.",
    whatCanBeDone:
      "Clinicians commonly confirm a high result with a repeat A1C or a fasting glucose test. Weight loss, regular activity and changes in eating patterns are known to lower A1C, and structured lifestyle programs cut progression from prediabetes to diabetes. Several medicine options exist when diabetes is diagnosed.",
    affectedBy:
      "Anemia, recent blood loss or transfusion, pregnancy, kidney disease and some inherited hemoglobin variants, such as sickle cell trait, can skew the result.",
  },

  glucose: {
    key: "glucose",
    name: "Fasting glucose",
    short: "Blood sugar after not eating overnight",
    result: "range",
    whatItIs:
      "Glucose is the sugar the body uses for energy. A fasting test measures it after at least 8 hours without food or drinks other than water.",
    whyChecked:
      "It is a standard screen for prediabetes and diabetes. It also helps detect blood sugar that runs too low.",
    high:
      "Commonly used cutoffs are 70–99 mg/dL normal, 100–125 prediabetes, and 126 or above on two separate tests diabetes. High fasting glucose is often linked to insulin resistance, excess weight and family history. It can also rise temporarily with illness, stress, steroid medicines or a test that was not truly fasting.",
    low:
      "Below 70 mg/dL is considered low blood sugar. It is most often seen in people taking insulin or some diabetes pills, and it can also occur with heavy alcohol use, long fasting, liver or kidney disease, hormone problems or, rarely, an insulin-making tumor.",
    whatCanBeDone:
      "Clinicians commonly confirm an abnormal result with a repeat test or an A1C, and sometimes use a glucose tolerance test. Weight loss, regular activity and eating patterns lower in refined carbohydrates are known to improve fasting glucose. Very high values or low values with symptoms such as confusion or shakiness are usually followed up promptly.",
    affectedBy:
      "Eating before the test, illness, stress, steroid medicines and a sample left unprocessed too long can skew the result.",
  },

  insulin: {
    key: "insulin",
    name: "Fasting insulin",
    short: "The hormone that moves sugar from blood into cells",
    result: "range",
    whatItIs:
      "Insulin is a hormone made by the pancreas that lets cells take in glucose. A fasting level shows how much insulin the body needs to keep blood sugar steady overnight.",
    whyChecked:
      "A high fasting insulin can signal insulin resistance years before blood sugar rises. It is also used when looking into low blood sugar.",
    high:
      "There is no single agreed normal range, and results differ between labs and methods. A high level usually means the body is working harder to control blood sugar, which is common with excess weight, prediabetes, type 2 diabetes, polycystic ovary syndrome (PCOS) and fatty liver. Rarely, high insulin with low blood sugar points to an insulin-making tumor.",
    low:
      "Low fasting insulin is often normal in lean, active people. When blood sugar is also high, it can mean the pancreas is making too little insulin, as in type 1 diabetes or longstanding type 2 diabetes.",
    whatCanBeDone:
      "Clinicians commonly read insulin together with fasting glucose, sometimes combined into a score called HOMA-IR, and with A1C. Regular activity, weight loss, better sleep and less refined carbohydrate are known to improve insulin sensitivity. Fasting insulin is not used on its own to diagnose diabetes.",
    affectedBy:
      "Eating before the test, insulin injections, some diabetes medicines, steroids and high-dose biotin (in some assays) can skew the result.",
  },

  // ─── Kidneys, liver and metabolism ────────────────────────────────────────

  creatinine: {
    key: "creatinine",
    name: "Creatinine",
    short: "A muscle waste product cleared by the kidneys",
    result: "range",
    whatItIs:
      "Creatinine is made at a steady rate as muscles work. Healthy kidneys filter it out of the blood into urine.",
    whyChecked:
      "Because it builds up when kidneys filter less well, creatinine is a basic check of kidney function. It is also used to calculate eGFR.",
    high:
      "Typical adult ranges are often about 0.7–1.3 mg/dL for men and 0.6–1.1 mg/dL for women, but they vary by lab. A high value can mean reduced kidney function, dehydration or a blocked urinary tract. It can also be higher in people with a lot of muscle, after a large meat meal, with creatine supplements or with some medicines.",
    low:
      "Low creatinine usually reflects low muscle mass, as with older age, frailty or malnutrition. It is also common in pregnancy and is rarely a concern on its own.",
    whatCanBeDone:
      "Clinicians commonly look at eGFR, repeat the test and check urine for protein (albumin). A cystatin C test is sometimes added when muscle mass may be skewing results. Staying hydrated, controlling blood pressure and blood sugar, and reviewing medicines such as regular anti-inflammatory painkillers are common parts of kidney care.",
    affectedBy:
      "Dehydration, intense exercise, a large meat meal, creatine supplements and some medicines can raise the result.",
  },

  egfr: {
    key: "egfr",
    name: "eGFR",
    short: "An estimate of how well the kidneys filter blood",
    result: "range",
    whatItIs:
      "Estimated glomerular filtration rate (eGFR) is calculated from blood creatinine, age and sex. It estimates how many milliliters of blood the kidneys filter each minute.",
    whyChecked:
      "It is the main number used to detect and stage chronic kidney disease. It also guides the dosing of many medicines.",
    high:
      "An eGFR of 90 or above is generally normal. Higher values are usually not a concern, though the estimate can overstate true function in people with low muscle mass, and it can be raised in pregnancy or early diabetes.",
    low:
      "An eGFR below 60 mL/min/1.73m² that lasts three months or more is consistent with chronic kidney disease, and below 15 indicates kidney failure. Values of 60–89 can be normal, especially in older adults, unless there are other signs of kidney damage. Common causes of lower eGFR include diabetes, high blood pressure, aging, dehydration and some medicines.",
    whatCanBeDone:
      "Clinicians commonly repeat a low eGFR within three months and add a urine albumin test, sometimes with a cystatin C test. Blood pressure and blood sugar control and a review of medicines are central to protecting the kidneys, and medicines that slow kidney disease exist. A very low or quickly falling eGFR usually leads to prompt follow-up, often with a kidney specialist.",
    affectedBy:
      "Anything that shifts creatinine, including dehydration, muscle mass, a large meat meal, creatine supplements and some medicines, shifts eGFR.",
  },

  bun: {
    key: "bun",
    name: "Blood urea nitrogen (BUN)",
    short: "A protein waste product filtered by the kidneys",
    result: "range",
    whatItIs:
      "Urea forms in the liver when the body breaks down protein. The kidneys remove it from the blood.",
    whyChecked:
      "BUN is a basic check of kidney function and hydration. It is often read alongside creatinine as a ratio.",
    high:
      "Many labs list about 6–20 mg/dL as typical, though ranges vary. A high BUN can mean reduced kidney function, dehydration, heart failure, bleeding in the stomach or intestines, or a very high-protein diet. Steroid medicines can also raise it.",
    low:
      "A low BUN is usually not a concern. It can occur with a low-protein diet, malnutrition, severe liver disease, drinking a lot of fluid or pregnancy.",
    whatCanBeDone:
      "Clinicians commonly read BUN with creatinine and eGFR, and a high BUN-to-creatinine ratio often points toward dehydration or bleeding rather than kidney damage. Fluids and addressing the underlying cause are common next steps. A high BUN with other signs of kidney or bleeding problems usually leads to prompt follow-up.",
    affectedBy:
      "Hydration, protein intake, steroid medicines and pregnancy can shift the result.",
  },

  sodium: {
    key: "sodium",
    name: "Sodium",
    short: "An electrolyte that controls fluid balance",
    result: "range",
    whatItIs:
      "Sodium is a mineral that helps control the balance of water in and around cells. It is also needed for nerves and muscles to work.",
    whyChecked:
      "Sodium is part of routine metabolic panels. Abnormal levels usually reflect a problem with water balance rather than salt intake.",
    high:
      "The typical range is about 135–145 mEq/L. A high level usually means the body has too little water, as with not drinking enough, heavy sweating, vomiting or diarrhea. Less common causes include diabetes insipidus and some medicines.",
    low:
      "A level below about 135 mEq/L is called hyponatremia. Common causes include some water pills (diuretics), some antidepressants, drinking very large amounts of water, vomiting or diarrhea, heart, liver or kidney failure, and hormone conditions. Severe or sudden drops can cause confusion, falls and seizures.",
    whatCanBeDone:
      "Clinicians commonly repeat the test and review medicines, fluid intake and other lab values such as glucose, kidney function and sometimes urine sodium. Treatment depends on the cause and can include changing fluids or medicines. Markedly abnormal levels, or any change with confusion, are usually handled promptly.",
    affectedBy:
      "Very high blood sugar or very high blood fats can make the reported sodium lower, and diuretics and some other medicines shift it.",
  },

  potassium: {
    key: "potassium",
    name: "Potassium",
    short: "An electrolyte that keeps heart rhythm steady",
    result: "range",
    whatItIs:
      "Potassium is a mineral that nerves and muscles, including the heart, rely on to work. The kidneys keep blood levels in a narrow range.",
    whyChecked:
      "Both high and low potassium can disturb heart rhythm. It is often checked in people taking blood pressure medicines or diuretics, or with kidney disease.",
    high:
      "Many labs list about 3.5–5.0 mEq/L as typical, though ranges vary slightly. High potassium can come from kidney disease, some blood pressure medicines, potassium-sparing diuretics, potassium supplements or salt substitutes, uncontrolled diabetes or adrenal problems. A falsely high result is common when red blood cells break open in the sample.",
    low:
      "Low potassium is often caused by diuretics, vomiting, diarrhea, laxative use or low magnesium. Less often it reflects hormone conditions such as excess aldosterone. It can cause weakness, cramps and irregular heartbeats.",
    whatCanBeDone:
      "Clinicians commonly repeat an unexpected result to rule out a sample problem and check kidney function, magnesium and medicines. Treatment depends on the cause and may involve adjusting medicines or diet or replacing potassium. Markedly high or low levels are usually treated as urgent because of the effect on heart rhythm.",
    affectedBy:
      "Broken red cells in the sample, clenching a fist during the draw, delays in processing and very high white cell or platelet counts can falsely raise potassium.",
  },

  calcium: {
    key: "calcium",
    name: "Calcium",
    short: "A mineral for bones, nerves, muscles and heart",
    result: "range",
    whatItIs:
      "Calcium builds bones and teeth and helps nerves, muscles and the heart work. Parathyroid hormone and vitamin D keep blood levels steady.",
    whyChecked:
      "Calcium is part of routine metabolic panels. Abnormal levels can point to parathyroid, kidney, bone or vitamin D problems.",
    high:
      "A typical range is about 8.5–10.2 mg/dL, though labs vary. The most common causes of high calcium are an overactive parathyroid gland and, less often, cancer. Other causes include high-dose vitamin D or calcium intake, some diuretics, lithium, dehydration and long periods of immobility.",
    low:
      "Low total calcium is often explained by low albumin, the protein that carries it. True low calcium can come from vitamin D deficiency, low magnesium, kidney disease, an underactive parathyroid (sometimes after neck surgery) or pancreatitis, and it can cause tingling and muscle cramps.",
    whatCanBeDone:
      "Clinicians commonly correct the result for albumin or measure ionized (free) calcium, then check parathyroid hormone, vitamin D, phosphate and kidney function. Treatment depends on the cause, and surgery is a common option for an overactive parathyroid. Very high or very low levels with symptoms are usually handled promptly.",
    affectedBy:
      "Albumin level, dehydration, a tourniquet left on too long and calcium supplements or antacids can shift the result.",
  },

  albumin: {
    key: "albumin",
    name: "Albumin",
    short: "The main protein made by the liver",
    result: "range",
    whatItIs:
      "Albumin is a protein made by the liver that keeps fluid inside blood vessels. It also carries hormones, medicines and minerals such as calcium.",
    whyChecked:
      "Albumin reflects liver function, kidney protein loss, nutrition and inflammation. It is part of routine metabolic panels.",
    high:
      "A typical range is about 3.4–5.4 g/dL, though labs vary. A high level almost always reflects dehydration rather than a disease.",
    low:
      "Low albumin can come from liver disease, kidneys leaking protein into urine, ongoing inflammation or infection, malnutrition, conditions that block absorption, burns or heart failure. It can lead to swelling in the legs or belly. It also dips normally in pregnancy.",
    whatCanBeDone:
      "Clinicians commonly look at liver tests, kidney function and a urine protein test to find the cause. Treatment focuses on the underlying condition rather than the albumin number itself. A low level with swelling or foamy urine usually leads to further kidney or liver testing.",
    affectedBy:
      "Hydration status, pregnancy, recent illness and a tourniquet left on too long can shift the result.",
  },

  alt: {
    key: "alt",
    name: "ALT",
    short: "A liver enzyme that rises when liver cells are injured",
    result: "range",
    whatItIs:
      "Alanine aminotransferase (ALT) is an enzyme found mostly in the liver. It leaks into the blood when liver cells are damaged.",
    whyChecked:
      "ALT is one of the most specific blood markers of liver cell injury. It is part of a liver panel and a comprehensive metabolic panel.",
    high:
      "Upper limits differ between labs, and some liver specialists use lower limits than many labs report. Mildly raised ALT is most often linked to fatty liver disease, alcohol, medicines or supplements. Other causes include viral hepatitis, celiac disease, iron overload, autoimmune liver disease and muscle injury, and very high levels suggest sudden liver injury.",
    low: null,
    whatCanBeDone:
      "Clinicians commonly repeat the test and review alcohol, medicines and supplements. Related tests include AST, alkaline phosphatase, bilirubin, hepatitis B and C tests, iron studies and a liver ultrasound. Weight loss and less alcohol are known to lower ALT from fatty liver, and very high values are usually followed up promptly.",
    affectedBy:
      "Hard exercise, alcohol, some medicines (including acetaminophen and some cholesterol medicines) and herbal supplements can raise the result.",
  },

  ast: {
    key: "ast",
    name: "AST",
    short: "An enzyme from the liver, muscles and heart",
    result: "range",
    whatItIs:
      "Aspartate aminotransferase (AST) is an enzyme found in the liver, muscles, heart and red blood cells. It rises in the blood when these cells are damaged.",
    whyChecked:
      "AST is part of liver and metabolic panels. Comparing it with ALT helps suggest the cause of liver injury.",
    high:
      "Ranges vary by lab. A high AST can come from fatty liver, alcohol, medicines, viral hepatitis or other liver disease, and also from muscle injury, hard exercise or broken red cells in the sample. An AST more than twice the ALT is a pattern often seen with alcohol-related liver disease.",
    low: null,
    whatCanBeDone:
      "Clinicians commonly read AST alongside ALT, alkaline phosphatase and bilirubin, and may check creatine kinase (CK) when muscle is a suspected source. Repeat testing after avoiding hard exercise and alcohol is common. Less alcohol and weight loss are known to lower liver-related rises.",
    affectedBy:
      "Strenuous exercise, muscle injury, alcohol, some medicines and broken red cells in the sample can raise the result.",
  },

  alp: {
    key: "alp",
    name: "Alkaline phosphatase",
    short: "An enzyme from the liver, bile ducts and bones",
    result: "range",
    whatItIs:
      "Alkaline phosphatase (ALP) is an enzyme found mainly in the liver, bile ducts and bones. Smaller amounts come from the intestines and, in pregnancy, the placenta.",
    whyChecked:
      "ALP helps detect blockage of the bile ducts and conditions that affect bone. It is part of liver and metabolic panels.",
    high:
      "A commonly cited adult range is about 44–147 IU/L, but ranges vary by lab and are much higher in growing children and teens. High ALP can come from blocked bile ducts (such as gallstones), liver disease, healing fractures, Paget disease of bone, vitamin D deficiency, an overactive parathyroid or cancer that has spread to bone or liver. It rises normally in pregnancy.",
    low:
      "Low ALP is uncommon. It can occur with malnutrition, low zinc or magnesium, an underactive thyroid, estrogen therapy or a rare inherited bone condition called hypophosphatasia.",
    whatCanBeDone:
      "Clinicians commonly check GGT or ALP subtypes to tell whether a high value comes from liver or bone. Other liver tests, vitamin D, calcium and a liver ultrasound are frequent next steps. Treatment depends on the cause.",
    affectedBy:
      "Age, pregnancy, recent bone fractures and, in some people, a recent fatty meal can raise the result.",
  },

  bilirubin: {
    key: "bilirubin",
    name: "Bilirubin",
    short: "A yellow pigment from the breakdown of old red cells",
    result: "range",
    whatItIs:
      "Bilirubin forms when old red blood cells are broken down. The liver processes it and releases it into bile.",
    whyChecked:
      "Bilirubin helps detect liver problems, bile duct blockage and faster-than-usual breakdown of red cells. High levels cause yellowing of the skin and eyes (jaundice).",
    high:
      "Total bilirubin is often about 0.1–1.2 mg/dL, though labs vary. A common and harmless cause of mild high bilirubin is Gilbert syndrome, an inherited trait that becomes more noticeable with fasting or illness. Other causes include liver disease, blocked bile ducts, gallstones, some medicines and conditions that destroy red cells.",
    low: null,
    whatCanBeDone:
      "Clinicians commonly split total bilirubin into direct and indirect forms, which point toward different causes. Other liver tests, a blood count and a liver ultrasound are frequent next steps. Jaundice, dark urine or pale stools usually lead to prompt follow-up.",
    affectedBy:
      "Fasting, illness and hard exercise can raise the result, and a sample exposed to light can read lower.",
  },

  urinalysis: {
    key: "urinalysis",
    name: "Urinalysis",
    short: "A check of urine for signs of kidney, sugar or infection",
    result: "range",
    whatItIs:
      "A urinalysis looks at the color and clarity of urine, tests it with a chemical strip and often examines it under a microscope. It checks for substances that normally are absent or only present in tiny amounts.",
    whyChecked:
      "It is a quick screen for kidney disease, diabetes, urinary tract infections and some liver problems. Many of these cause no symptoms early on.",
    high:
      "Protein can signal kidney damage from diabetes or high blood pressure, but it can also appear briefly after exercise or fever. Glucose usually reflects high blood sugar. Blood can come from infection, kidney stones, hard exercise or menstrual contamination, and less often from kidney disease or bladder or kidney cancer. White blood cells, leukocyte esterase or nitrites often point to a urinary tract infection, and ketones can appear with fasting, low-carbohydrate diets or uncontrolled diabetes.",
    low: null,
    whatCanBeDone:
      "Clinicians commonly repeat an abnormal urinalysis on a clean-catch sample. Related tests include a urine culture for infection, a urine albumin-to-creatinine ratio, blood kidney tests and blood sugar tests. Blood in the urine that has no clear explanation is usually followed up, sometimes with imaging or a bladder exam.",
    affectedBy:
      "Sample contamination, menstruation, dehydration, recent hard exercise, high-dose vitamin C and some foods and medicines can skew the results.",
  },

  // ─── Blood count and iron ─────────────────────────────────────────────────

  hemoglobin: {
    key: "hemoglobin",
    name: "Hemoglobin",
    short: "The protein in red blood cells that carries oxygen",
    result: "range",
    whatItIs:
      "Hemoglobin is an iron-rich protein inside red blood cells. It picks up oxygen in the lungs and delivers it to the body.",
    whyChecked:
      "Hemoglobin is the main number used to detect anemia. It is part of a complete blood count (CBC).",
    high:
      "Ranges vary by lab, sex, age and altitude. A high level can come from smoking, living at high altitude, dehydration, lung disease, sleep apnea or testosterone therapy. Less often it reflects a bone marrow condition called polycythemia vera.",
    low:
      "Anemia is commonly defined as hemoglobin below about 13 g/dL in men and 12 g/dL in women who are not pregnant. Common causes include iron deficiency, blood loss (such as heavy periods or bleeding in the gut), low B12 or folate, chronic kidney disease, long-term inflammation and inherited conditions such as thalassemia. Symptoms can include tiredness, shortness of breath and pale skin.",
    whatCanBeDone:
      "Clinicians commonly look at red cell size (MCV), iron studies, B12, folate and a reticulocyte count to find the cause. Treatment depends on the cause, such as replacing iron or vitamins or addressing a source of bleeding. A very low or quickly falling hemoglobin is usually followed up promptly.",
    affectedBy:
      "Dehydration, altitude, smoking, pregnancy and recent blood donation or blood loss can shift the result.",
  },

  hematocrit: {
    key: "hematocrit",
    name: "Hematocrit",
    short: "The share of blood volume made up of red cells",
    result: "range",
    whatItIs:
      "Hematocrit is the percentage of blood volume taken up by red blood cells. It usually moves in step with hemoglobin.",
    whyChecked:
      "It is part of a complete blood count (CBC) and helps detect anemia or too many red cells.",
    high:
      "Typical ranges are roughly 41–50% for men and 36–44% for women, though labs vary. A high hematocrit can come from dehydration, smoking, high altitude, lung disease, sleep apnea or testosterone therapy, and less often from a bone marrow condition. Very high values can thicken the blood and raise clot risk.",
    low:
      "A low hematocrit usually means anemia. Common causes include iron deficiency, blood loss, low B12 or folate, kidney disease, chronic inflammation and inherited blood conditions. It is also lower during pregnancy.",
    whatCanBeDone:
      "Clinicians commonly read hematocrit with hemoglobin and red cell indexes, then check iron, B12 and folate when it is low. A high value often leads to a review of hydration, smoking, sleep apnea and testosterone use. Treatment depends on the cause.",
    affectedBy:
      "Dehydration, altitude, smoking, pregnancy and recent blood donation can shift the result.",
  },

  wbc: {
    key: "wbc",
    name: "White blood cell count",
    short: "The cells that fight infection",
    result: "range",
    whatItIs:
      "White blood cells are part of the immune system. The count adds up several types, including neutrophils and lymphocytes.",
    whyChecked:
      "The WBC count helps detect infection, inflammation and bone marrow or immune problems. It is part of a complete blood count (CBC).",
    high:
      "A common adult range is about 4,500–11,000 cells per microliter, though labs vary. A high count is most often due to infection, inflammation, stress, smoking, pregnancy or steroid medicines. Less often it reflects allergy, a bone marrow disorder or leukemia.",
    low:
      "A low count can follow viral infections and can be caused by some medicines, autoimmune diseases, low B12 or folate, severe infection or bone marrow problems. Some healthy people, particularly of African or Middle Eastern ancestry, naturally have lower neutrophil counts. A low count can make infections more likely.",
    whatCanBeDone:
      "Clinicians commonly look at the differential, which breaks the count into cell types, and repeat the test. A blood smear and review of medicines and recent illness are frequent next steps. Very high or very low counts, or abnormal counts along with abnormal red cells or platelets, usually lead to prompt follow-up.",
    affectedBy:
      "Recent infection, hard exercise, stress, smoking, pregnancy and steroid medicines can raise the count.",
  },

  platelets: {
    key: "platelets",
    name: "Platelet count",
    short: "The cell fragments that help blood clot",
    result: "range",
    whatItIs:
      "Platelets are small cell fragments made in the bone marrow. They clump together to plug injured blood vessels.",
    whyChecked:
      "The platelet count helps assess bleeding and clotting risk. It is part of a complete blood count (CBC).",
    high:
      "A common range is about 150,000–400,000 per microliter, though labs vary. A high count is most often a reaction to iron deficiency, infection, inflammation, surgery or removal of the spleen. Less often it comes from a bone marrow disorder such as essential thrombocythemia.",
    low:
      "A low count can come from viral infections, some medicines, heavy alcohol use, liver disease with an enlarged spleen, immune thrombocytopenia, pregnancy, low B12 or folate, or bone marrow problems. Very low counts raise the risk of bleeding and bruising. Clumping of platelets in the tube can make the count read falsely low.",
    whatCanBeDone:
      "Clinicians commonly repeat an unexpected result, sometimes in a different tube, and review a blood smear. Iron studies, liver tests and a medicine review are frequent next steps. Very low counts or bleeding symptoms are usually followed up promptly.",
    affectedBy:
      "Clumping in the sample tube, recent infection, pregnancy, alcohol and some medicines can shift the result.",
  },

  iron: {
    key: "iron",
    name: "Serum iron",
    short: "The iron circulating in the blood right now",
    result: "range",
    whatItIs:
      "Serum iron measures iron bound to transferrin, the protein that carries it in the blood. Iron is needed to make hemoglobin.",
    whyChecked:
      "It helps detect iron deficiency and iron overload. It is read together with TIBC and ferritin because it swings a lot on its own.",
    high:
      "A commonly cited range is about 60–170 mcg/dL, though labs vary. High iron can come from iron supplements, a recent iron-rich meal, repeated blood transfusions, liver damage or an inherited iron overload condition called hemochromatosis.",
    low:
      "Low iron usually means iron deficiency from blood loss, low intake, pregnancy or poor absorption (such as with celiac disease). It is also common with ongoing inflammation, where iron is held in storage rather than circulating.",
    whatCanBeDone:
      "Clinicians commonly calculate transferrin saturation (iron divided by TIBC) and check ferritin and a blood count. Low iron with low ferritin usually leads to a search for the cause, such as blood loss, and iron can be replaced by mouth or by vein. High saturation with high ferritin often leads to genetic testing for hemochromatosis.",
    affectedBy:
      "Time of day (higher in the morning), recent meals, iron supplements, birth control pills and recent illness can shift the result.",
  },

  tibc: {
    key: "tibc",
    name: "Total iron-binding capacity (TIBC)",
    short: "How much iron the blood's carrier protein can hold",
    result: "range",
    whatItIs:
      "TIBC measures how much iron transferrin, the blood's iron carrier, could bind if fully loaded. The body makes more transferrin when iron is scarce.",
    whyChecked:
      "TIBC helps tell iron deficiency apart from anemia of inflammation and iron overload. It is used to calculate transferrin saturation.",
    high:
      "A commonly cited range is about 240–450 mcg/dL, though labs vary. A high TIBC usually means the body is short on iron. It also rises in pregnancy and with estrogen or birth control pills.",
    low:
      "A low TIBC can occur with ongoing inflammation or infection, liver disease, malnutrition, kidney conditions that leak protein and iron overload.",
    whatCanBeDone:
      "Clinicians commonly read TIBC with serum iron and ferritin. A transferrin saturation above about 45% often leads to testing for iron overload, while a low saturation suggests iron deficiency. Treatment follows the cause.",
    affectedBy:
      "Pregnancy, birth control pills, estrogen therapy and recent illness can shift the result.",
  },

  ferritin: {
    key: "ferritin",
    name: "Ferritin",
    short: "The body's stored iron",
    result: "range",
    whatItIs:
      "Ferritin is a protein that stores iron inside cells. The small amount in blood reflects how much iron the body has in reserve.",
    whyChecked:
      "Ferritin is the most useful single test for iron deficiency. It also helps detect iron overload.",
    high:
      "Ranges vary by lab and sex. A high ferritin is most often due to inflammation, infection, fatty liver, alcohol use or metabolic syndrome, because ferritin rises with inflammation. It can also reflect iron overload from hemochromatosis or repeated transfusions, and less often some cancers.",
    low:
      "A low ferritin means iron stores are low; many clinicians read values below about 30 ng/mL as iron deficiency, though lab cutoffs differ. Common causes include heavy periods, bleeding in the gut, pregnancy, low iron intake and poor absorption (such as celiac disease). Low iron stores can cause tiredness and hair shedding even before anemia appears.",
    whatCanBeDone:
      "Clinicians commonly check a blood count, iron and transferrin saturation alongside ferritin. For low ferritin, common next steps include looking for a source of blood loss and replacing iron by mouth or by vein. For high ferritin, liver tests, CRP and transferrin saturation help separate inflammation from true overload, and removing blood is the standard treatment for hemochromatosis.",
    affectedBy:
      "Recent infection, inflammation, liver problems and iron supplements can raise the result.",
  },

  // ─── Nutrients ────────────────────────────────────────────────────────────

  vitamin_d: {
    key: "vitamin_d",
    name: "Vitamin D (25-hydroxy)",
    short: "The body's vitamin D stores",
    result: "range",
    whatItIs:
      "25-hydroxy vitamin D is the main form of vitamin D in the blood. It reflects vitamin D from sunlight, food and supplements.",
    whyChecked:
      "Vitamin D helps the body absorb calcium and keep bones strong. Low levels are common, especially in winter and in people with darker skin.",
    high:
      "The NIH Office of Dietary Supplements notes that levels above about 50 ng/mL (125 nmol/L) may be linked to harm. Very high levels almost always come from high-dose supplements and can raise blood calcium, causing nausea, weakness and kidney problems.",
    low:
      "The NIH describes below 12 ng/mL (30 nmol/L) as deficient and 20 ng/mL (50 nmol/L) or above as adequate for most people; some groups have used 30 ng/mL as a cutoff, and labs differ. Low levels are common with little sun exposure, darker skin, older age, obesity, conditions that block absorption (such as celiac disease or bariatric surgery), kidney or liver disease and some medicines. Long-term deficiency can weaken bones.",
    whatCanBeDone:
      "Clinicians commonly consider sun exposure, food sources such as fatty fish and fortified foods, and supplements when levels are low. Calcium and parathyroid hormone are sometimes checked, and levels are often rechecked after a few months of change. High levels usually lead to stopping or lowering supplements and checking calcium.",
    affectedBy:
      "Season, recent supplement use and, in some assays, high-dose biotin can shift the result.",
  },

  vitamin_b12: {
    key: "vitamin_b12",
    name: "Vitamin B12",
    short: "A vitamin for nerves and red blood cells",
    result: "range",
    whatItIs:
      "Vitamin B12 is needed to make red blood cells, DNA and healthy nerves. It comes mainly from animal foods and fortified products.",
    whyChecked:
      "Low B12 can cause anemia, numbness or tingling, and memory problems. It is often checked in older adults, people on plant-based diets and people taking certain medicines.",
    high:
      "High B12 usually reflects supplements or injections. Without supplements, a high level can occur with liver disease, kidney disease or some blood disorders, and it is sometimes looked into further.",
    low:
      "Values below about 200 pg/mL are commonly read as low and 200–300 pg/mL as borderline, though labs vary. Common causes include pernicious anemia (an autoimmune problem with absorption), vegan or vegetarian diets, older age, metformin, long-term acid-reducing medicines, stomach or bowel surgery and conditions such as celiac or Crohn disease. Nerve damage from long-standing deficiency can become permanent.",
    whatCanBeDone:
      "For borderline results, clinicians commonly check methylmalonic acid (MMA) or homocysteine, which rise when B12 is truly low, and may test for intrinsic factor antibodies. B12 can be replaced by mouth or by injection depending on the cause. Nerve symptoms usually lead to prompt follow-up.",
    affectedBy:
      "Supplements, pregnancy, birth control pills and high folate intake can shift the result or mask signs of deficiency.",
  },

  folate: {
    key: "folate",
    name: "Folate",
    short: "A B vitamin for cell growth and red blood cells",
    result: "range",
    whatItIs:
      "Folate (vitamin B9) helps make DNA and red blood cells. It is found in leafy greens, beans and fortified grains.",
    whyChecked:
      "Low folate can cause anemia and, in pregnancy, raises the risk of neural tube defects. It is often checked with B12 when anemia or high homocysteine is found.",
    high:
      "High folate usually reflects supplements or fortified foods and is generally not harmful by itself. Large amounts of folic acid can hide the anemia of B12 deficiency while nerve damage continues.",
    low:
      "The NIH Office of Dietary Supplements notes that serum folate above about 3 ng/mL generally indicates adequate intake; labs vary. Low folate can come from low intake, heavy alcohol use, absorption problems such as celiac disease, the higher needs of pregnancy and some medicines, including methotrexate and some seizure medicines.",
    whatCanBeDone:
      "Clinicians commonly check B12 at the same time, because treating low folate alone can mask a B12 problem. Diet changes and folic acid are the usual ways low folate is corrected. Folic acid before and during early pregnancy is standard public health guidance for preventing neural tube defects.",
    affectedBy:
      "Recent meals and supplements can raise serum folate, and broken red cells in the sample can falsely raise it.",
  },

  magnesium: {
    key: "magnesium",
    name: "Magnesium",
    short: "A mineral for muscles, nerves and heart rhythm",
    result: "range",
    whatItIs:
      "Magnesium is involved in hundreds of body processes, including muscle and nerve function, blood sugar control and heart rhythm. Most of it is stored in bones and cells, not blood.",
    whyChecked:
      "Magnesium is checked when there are cramps, abnormal heart rhythms or low potassium or calcium. It is also monitored in people taking diuretics or long-term acid-reducing medicines.",
    high:
      "A commonly cited range is about 1.7–2.2 mg/dL, though labs vary. High magnesium is uncommon and usually occurs with kidney failure, especially when combined with magnesium-containing antacids or laxatives.",
    low:
      "Low magnesium can come from diuretics, long-term acid-reducing medicines, alcohol use, diarrhea or absorption problems and uncontrolled diabetes. It often occurs with low potassium and calcium and can cause cramps, tremor and irregular heartbeats. Because blood holds under 1% of the body's magnesium, a normal result does not fully rule out low stores.",
    whatCanBeDone:
      "Clinicians commonly check potassium, calcium and kidney function alongside magnesium and review medicines. Foods such as nuts, seeds, beans and whole grains supply magnesium, and replacement by mouth or by vein is used when levels are low. Very low or very high levels, especially with heart rhythm symptoms, are usually handled promptly.",
    affectedBy:
      "Broken red cells in the sample, supplements, laxatives and antacids can shift the result.",
  },

  omega3_index: {
    key: "omega3_index",
    name: "Omega-3 index",
    short: "The share of omega-3 fats in red blood cell membranes",
    result: "range",
    whatItIs:
      "The omega-3 index measures EPA and DHA, the omega-3 fats found mainly in fish, as a percentage of all fats in red blood cell membranes. It reflects intake over the past few months.",
    whyChecked:
      "Omega-3 fats are linked to heart and brain health, and the index gives a longer-term picture than a single blood fat level. It is mostly used in wellness and research settings rather than for diagnosis.",
    high:
      "The researchers who developed the test proposed 8% or higher as a desirable range; it is not a standardized diagnostic test, and major guidelines do not set targets. A high index usually reflects regular fatty fish or omega-3 supplement intake. Some studies link high-dose omega-3 supplements to a higher risk of atrial fibrillation and, rarely, bleeding.",
    low:
      "An index below about 4% is described as low in the research literature. It usually reflects little fatty fish in the diet and has been linked in observational studies to higher heart disease risk.",
    whatCanBeDone:
      "Common ways people raise the index include eating fatty fish such as salmon, sardines or mackerel, and omega-3 supplements, which are sometimes discussed with a clinician because they can interact with blood thinners. Because red cells take about four months to turn over, retesting usually happens no sooner than three to four months after a change.",
    affectedBy:
      "Recent changes in fish or supplement intake take several months to show fully.",
  },

  // ─── Thyroid ──────────────────────────────────────────────────────────────

  tsh: {
    key: "tsh",
    name: "TSH",
    short: "The brain's signal telling the thyroid how hard to work",
    result: "range",
    whatItIs:
      "Thyroid-stimulating hormone (TSH) is made by the pituitary gland. It rises when thyroid hormone is low and falls when it is high.",
    whyChecked:
      "TSH is the main first test for an underactive or overactive thyroid. It is also used to adjust thyroid medicine.",
    high:
      "A commonly cited adult range is about 0.4–4.0 mIU/L, though labs vary and ranges shift with age and pregnancy. A high TSH usually means an underactive thyroid, most often from Hashimoto thyroiditis. It can also be raised during recovery from illness, with some medicines such as lithium or amiodarone, or when thyroid medicine doses are too low.",
    low:
      "A low TSH usually means an overactive thyroid, as with Graves disease, thyroid nodules or thyroiditis, or too much thyroid medicine. It can also be low in early pregnancy, during serious illness, with steroid medicines and, rarely, with pituitary problems.",
    whatCanBeDone:
      "Clinicians commonly repeat an abnormal TSH along with free T4, adding free T3 when TSH is low and TPO antibodies when it is high. Mild changes are often rechecked in 6–12 weeks because they can settle on their own. Thyroid hormone replacement is used for an underactive thyroid, and medicines, radioactive iodine or surgery are options for an overactive one.",
    affectedBy:
      "High-dose biotin, time of day (higher at night), recent illness, pregnancy, steroid medicines and recent iodine contrast can skew the result.",
  },

  free_t4: {
    key: "free_t4",
    name: "Free T4",
    short: "The main hormone made by the thyroid",
    result: "range",
    whatItIs:
      "Thyroxine (T4) is the main hormone released by the thyroid. Free T4 is the unbound portion that can enter cells.",
    whyChecked:
      "Free T4 is read with TSH to confirm and gauge an underactive or overactive thyroid. It also helps detect pituitary problems.",
    high:
      "Ranges vary by lab. A high free T4 usually means an overactive thyroid or too much thyroid medicine. It can also be high early in thyroiditis and with some medicines such as amiodarone.",
    low:
      "A low free T4 with a high TSH means an underactive thyroid. A low free T4 with a low or normal TSH can point to a pituitary problem, and severe illness can also lower it.",
    whatCanBeDone:
      "Clinicians commonly interpret free T4 alongside TSH and sometimes free T3 and thyroid antibodies. Treatment options depend on the cause and include thyroid hormone replacement or treatments that calm an overactive thyroid. Very abnormal values with symptoms such as a racing heart or severe fatigue are usually followed up promptly.",
    affectedBy:
      "High-dose biotin, heparin, pregnancy, serious illness and some medicines can skew the result.",
  },

  free_t3: {
    key: "free_t3",
    name: "Free T3",
    short: "The active form of thyroid hormone",
    result: "range",
    whatItIs:
      "Triiodothyronine (T3) is the most active thyroid hormone, made mostly by converting T4 in body tissues. Free T3 is the unbound portion.",
    whyChecked:
      "Free T3 is mainly useful when an overactive thyroid is suspected. It is less helpful for diagnosing an underactive thyroid.",
    high:
      "Ranges vary by lab. A high free T3 usually means an overactive thyroid, and sometimes T3 rises before T4 does. It can also reflect taking T3 medicine.",
    low:
      "A low free T3 can occur in an underactive thyroid, usually after T4 has fallen. It is also common during serious illness, fasting, calorie restriction and with some medicines, even when the thyroid is healthy.",
    whatCanBeDone:
      "Clinicians commonly interpret free T3 with TSH and free T4 rather than alone. A low T3 during illness or dieting often returns to normal once the cause resolves. Treatment focuses on the overall thyroid picture.",
    affectedBy:
      "High-dose biotin, serious illness, calorie restriction, pregnancy and medicines such as steroids and amiodarone can skew the result.",
  },

  tpo_antibodies: {
    key: "tpo_antibodies",
    name: "TPO antibodies",
    short: "Antibodies that attack the thyroid",
    result: "range",
    whatItIs:
      "Thyroid peroxidase (TPO) is an enzyme the thyroid uses to make hormones. TPO antibodies are made when the immune system targets the thyroid.",
    whyChecked:
      "They help show whether a thyroid problem is autoimmune. They also help predict who may develop an underactive thyroid over time.",
    high:
      "Cutoffs vary by lab and method. A positive result most often points to Hashimoto thyroiditis and is also common in Graves disease. Some people with normal thyroid function carry these antibodies, more often women and older adults, and they have a higher chance of developing an underactive thyroid later; in pregnancy they are linked to thyroid problems after delivery.",
    low: null,
    whatCanBeDone:
      "Antibodies alone are not usually treated, so clinicians commonly monitor TSH and free T4 over time. People with positive antibodies are often watched more closely during pregnancy and after giving birth. Thyroid hormone replacement is used if the thyroid becomes underactive.",
    affectedBy:
      "High-dose biotin can interfere with some assays, and results from different labs are not always comparable.",
  },

  // ─── Hormones ─────────────────────────────────────────────────────────────

  testosterone_total: {
    key: "testosterone_total",
    name: "Total testosterone",
    short: "The main male sex hormone, also important in women",
    result: "range",
    whatItIs:
      "Testosterone is made mainly by the testes in men and in smaller amounts by the ovaries and adrenal glands in women. Total testosterone counts both the bound and the free hormone.",
    whyChecked:
      "In men it is checked for low libido, erectile problems, fatigue, loss of muscle or bone, or infertility. In women it is checked for irregular periods, acne or excess hair growth, often to look for polycystic ovary syndrome (PCOS).",
    high:
      "Normal ranges depend heavily on sex and age and vary by lab. In men, high levels usually come from testosterone or anabolic steroid use and rarely from tumors. In women, the most common cause is PCOS; others include congenital adrenal hyperplasia, testosterone use and, rarely, ovarian or adrenal tumors.",
    low:
      "In men, many labs use roughly 300–1,000 ng/dL as the adult range, and the American Urological Association uses below 300 ng/dL to help define low testosterone. Common causes include aging, obesity, type 2 diabetes, sleep apnea, opioids, steroid medicines, pituitary problems, testicular injury and serious illness. In women, levels fall with age and after ovary removal, and low values are harder to interpret.",
    whatCanBeDone:
      "Clinicians commonly confirm a low result with a second early-morning test and check LH, FSH, prolactin and SHBG or free testosterone. Weight loss, better sleep and treating sleep apnea are known to raise testosterone in some men, and testosterone therapy exists with known benefits and risks, including effects on fertility. In women, high levels often lead to tests for PCOS and adrenal causes.",
    affectedBy:
      "Time of day (highest in the morning), recent meals, poor sleep, acute illness, opioids, hormonal birth control and high-dose biotin can shift the result.",
  },

  testosterone_free: {
    key: "testosterone_free",
    name: "Free testosterone",
    short: "The testosterone not bound to proteins",
    result: "range",
    whatItIs:
      "Only a small fraction of testosterone, about 1–2%, circulates free rather than bound to SHBG and albumin. Free testosterone is measured directly or calculated from total testosterone, SHBG and albumin.",
    whyChecked:
      "It is most useful when SHBG is unusually high or low, which can make total testosterone misleading. This is common with obesity, aging, thyroid problems and liver disease.",
    high:
      "Normal ranges depend on sex, age and the method used. A high free testosterone in women often points to PCOS, especially when SHBG is low. In men it usually reflects testosterone or anabolic steroid use.",
    low:
      "A low free testosterone in men can mean low testosterone even when the total looks normal, often because SHBG is high with aging, an overactive thyroid or liver disease. In women, low values are common after menopause and are harder to interpret.",
    whatCanBeDone:
      "Clinicians commonly read free testosterone with total testosterone, SHBG, LH and FSH. The calculated or equilibrium dialysis methods are considered more reliable than some direct methods. Next steps follow the same paths as for total testosterone.",
    affectedBy:
      "Time of day, recent meals, illness, hormonal birth control, thyroid problems and the lab method can shift the result.",
  },

  shbg: {
    key: "shbg",
    name: "Sex hormone-binding globulin (SHBG)",
    short: "The protein that carries testosterone and estrogen",
    result: "range",
    whatItIs:
      "SHBG is a protein made by the liver that binds testosterone and estradiol in the blood. Bound hormone is not available to tissues.",
    whyChecked:
      "SHBG helps interpret testosterone results, because it changes how much hormone is actually free. It is also a marker of insulin resistance.",
    high:
      "Ranges depend on sex and age and vary by lab. High SHBG can come from aging in men, an overactive thyroid, liver disease, estrogen (pregnancy, birth control pills or hormone therapy), some seizure medicines and low body weight. It can lower free testosterone even when total testosterone looks normal.",
    low:
      "Low SHBG is common with obesity, insulin resistance, type 2 diabetes, PCOS and an underactive thyroid. It can also come from testosterone, anabolic steroid or steroid medicine use. Low SHBG is linked to a higher risk of developing type 2 diabetes.",
    whatCanBeDone:
      "Clinicians commonly use SHBG to calculate free testosterone and to look at the overall hormone picture. Low SHBG often leads to checks of blood sugar, insulin and thyroid function, and weight loss is known to raise it. High SHBG often leads to thyroid and liver tests.",
    affectedBy:
      "Pregnancy, birth control pills, hormone therapy, thyroid problems and weight changes can shift the result.",
  },

  estradiol: {
    key: "estradiol",
    name: "Estradiol",
    short: "The main form of estrogen",
    result: "range",
    whatItIs:
      "Estradiol is the main estrogen made by the ovaries before menopause. Smaller amounts are made from testosterone in fat tissue and in men.",
    whyChecked:
      "In women it is used to look into irregular periods, fertility, menopause and hormone therapy. In men it is checked for breast enlargement or during testosterone therapy.",
    high:
      "Normal ranges depend on sex, age, cycle phase and menopause status, and vary by lab. In women, high levels occur normally just before ovulation and in pregnancy, and also with estrogen therapy, fertility treatment and, rarely, ovarian tumors. In men, high levels can come from obesity, liver disease, testosterone therapy and, rarely, tumors, and can cause breast tissue growth.",
    low:
      "In women, low estradiol is expected after menopause. Before menopause it can come from low body weight, heavy exercise, eating disorders, primary ovarian insufficiency, pituitary problems or some medicines, and it can lead to missed periods and bone loss. In men, low estradiol can also contribute to bone loss.",
    whatCanBeDone:
      "Clinicians commonly interpret estradiol with the cycle day and with FSH and LH, and sometimes progesterone, prolactin or thyroid tests. Treatment depends on the cause and can include hormone therapy or addressing nutrition and exercise. In men and after menopause, more sensitive lab methods are often used because levels are low.",
    affectedBy:
      "Cycle day, hormonal birth control, hormone therapy, pregnancy and high-dose biotin can shift the result.",
  },

  progesterone: {
    key: "progesterone",
    name: "Progesterone",
    short: "The hormone that rises after ovulation",
    result: "range",
    whatItIs:
      "Progesterone is made mainly by the ovaries after ovulation and by the placenta in pregnancy. It prepares the lining of the uterus for pregnancy.",
    whyChecked:
      "A mid-luteal test, about a week before an expected period, is commonly used to check whether ovulation happened. It is also used in early pregnancy and fertility care.",
    high:
      "Normal ranges depend on sex, cycle phase, pregnancy and menopause status. High levels are expected after ovulation and in pregnancy, and can also come from progesterone medicines. Less common causes include ovarian cysts and congenital adrenal hyperplasia.",
    low:
      "A mid-luteal value above about 3 ng/mL is commonly read as a sign that ovulation occurred, though cutoffs vary. A low value can mean ovulation did not happen, as with PCOS, perimenopause, stress, low body weight or thyroid problems, or that the test was timed early or late. Low levels are normal after menopause and in men.",
    whatCanBeDone:
      "Clinicians commonly repeat the test in another cycle, timed to the actual cycle length, and check FSH, LH, thyroid and prolactin. Treatments to support ovulation exist when fertility is the goal. In early pregnancy, low progesterone with pain or bleeding is usually followed up promptly.",
    affectedBy:
      "Cycle timing, pregnancy, hormonal birth control and progesterone medicines strongly affect the result.",
  },

  fsh: {
    key: "fsh",
    name: "FSH",
    short: "The pituitary signal that drives eggs and sperm",
    result: "range",
    whatItIs:
      "Follicle-stimulating hormone (FSH) is made by the pituitary gland. It helps eggs mature in the ovaries and supports sperm production in the testes.",
    whyChecked:
      "FSH is used to look into fertility, irregular periods, menopause and low testosterone. It helps show whether a problem starts in the ovaries or testes or in the pituitary.",
    high:
      "Normal ranges depend on sex, age, cycle phase and menopause status. In women, high FSH is typical of menopause and perimenopause and can also point to primary ovarian insufficiency. In men, high FSH can mean the testes are not working well, as after chemotherapy, injury or with conditions such as Klinefelter syndrome.",
    low:
      "Low FSH can come from pituitary or hypothalamus problems, low body weight, heavy exercise, high prolactin, pregnancy, hormonal birth control or testosterone or anabolic steroid use.",
    whatCanBeDone:
      "Clinicians commonly read FSH with LH, estradiol or testosterone, and sometimes prolactin and AMH. Because FSH swings during perimenopause, a single value often does not settle menopause status, and repeat tests are common. Fertility, hormone and pituitary evaluations are typical next steps depending on the pattern.",
    affectedBy:
      "Cycle day (often tested on days 2–5), hormonal birth control, hormone therapy, recent pregnancy and high-dose biotin can shift the result.",
  },

  lh: {
    key: "lh",
    name: "LH",
    short: "The pituitary signal that triggers ovulation",
    result: "range",
    whatItIs:
      "Luteinizing hormone (LH) is made by the pituitary gland. A surge of LH triggers ovulation, and in men LH tells the testes to make testosterone.",
    whyChecked:
      "LH is used to look into fertility, irregular periods, PCOS, menopause and low testosterone. It is read together with FSH.",
    high:
      "Normal ranges depend on sex, age, cycle phase and menopause status. A high LH is expected during the mid-cycle surge and after menopause. It can also be high with PCOS, often with a high LH-to-FSH ratio, and when the ovaries or testes are not working well.",
    low:
      "Low LH can come from pituitary or hypothalamus problems, stress, low body weight, heavy exercise, high prolactin, hormonal birth control or, in men, testosterone or anabolic steroid use.",
    whatCanBeDone:
      "Clinicians commonly interpret LH with FSH, estradiol or testosterone, and prolactin. In men with low testosterone, LH helps show whether the cause is in the testes or the pituitary. Home ovulation tests measure the same LH surge in urine.",
    affectedBy:
      "Cycle day, hormonal birth control, hormone or testosterone therapy and high-dose biotin can shift the result.",
  },

  cortisol: {
    key: "cortisol",
    name: "Cortisol",
    short: "The body's main stress hormone",
    result: "range",
    whatItIs:
      "Cortisol is made by the adrenal glands and helps control blood sugar, blood pressure, metabolism and the stress response. It follows a daily rhythm, highest in the early morning and lowest around midnight.",
    whyChecked:
      "Cortisol tests help look for adrenal glands that make too much (Cushing syndrome) or too little (adrenal insufficiency). A single random value says little about everyday stress.",
    high:
      "Normal ranges depend on the time of day the sample is taken and vary by lab. High cortisol is common with physical or emotional stress, illness, poor sleep, heavy alcohol use, pregnancy, birth control pills and some steroid medicines. Less commonly it reflects Cushing syndrome.",
    low:
      "Low cortisol can come from adrenal insufficiency (Addison disease), pituitary problems or the body's own production being suppressed by oral, inhaled or injected steroid medicines, especially after stopping them. It can cause fatigue, weight loss, dizziness and low blood pressure.",
    whatCanBeDone:
      "Clinicians commonly use more specific tests to confirm a problem: late-night saliva cortisol, 24-hour urine cortisol or a dexamethasone suppression test for excess, and an ACTH level or ACTH stimulation test for deficiency. Treatments exist for both, including steroid replacement for adrenal insufficiency. Very low cortisol with vomiting, severe weakness or low blood pressure is usually treated as an emergency.",
    affectedBy:
      "Time of day, stress, poor sleep, illness, pregnancy, birth control pills and steroid medicines can shift the result.",
  },

  psa: {
    key: "psa",
    name: "PSA",
    short: "A prostate protein used in prostate cancer screening",
    result: "range",
    whatItIs:
      "Prostate-specific antigen (PSA) is a protein made by the prostate gland. Small amounts normally enter the blood.",
    whyChecked:
      "PSA is used to screen for prostate cancer and to monitor men who have been treated for it. Screening decisions for men 55 to 69 are commonly described as an individual choice that weighs benefits and harms.",
    high:
      "There is no single normal level; 4.0 ng/mL has long been a common cutoff, and many clinicians use age-based or lower thresholds. A raised PSA can mean prostate cancer, but it is more often caused by an enlarged prostate, inflammation or infection of the prostate, recent ejaculation, cycling or a recent prostate procedure. Most men with a mildly raised PSA do not have prostate cancer.",
    low: null,
    whatCanBeDone:
      "Clinicians commonly repeat a raised PSA after a few weeks and look at the trend over time. Related steps include a free PSA test, other blood or urine markers, a prostate MRI and, when concern remains, a biopsy. Many low-risk cancers are watched with monitoring rather than treated right away.",
    affectedBy:
      "Ejaculation or cycling in the 48 hours before the test, urinary infection, prostate procedures and medicines for an enlarged prostate (which can roughly halve PSA) can skew the result.",
  },

  // ─── Infections ───────────────────────────────────────────────────────────

  chlamydia: {
    key: "chlamydia",
    name: "Chlamydia",
    short: "A common bacterial STI that often has no symptoms",
    result: "detected",
    whatItIs:
      "Chlamydia is a sexually transmitted infection caused by bacteria. The test looks for the bacteria's genetic material in urine or a swab.",
    whyChecked:
      "Most people with chlamydia have no symptoms. Untreated, it can cause pelvic inflammatory disease, infertility and ectopic pregnancy in women, and it is especially common in people under 25.",
    high:
      "A detected result means chlamydia was found and a current infection is very likely. Infection can be present in the genitals, throat or rectum, and a urine or genital test may not detect infection at other sites.",
    low: null,
    whatCanBeDone:
      "Chlamydia is curable with antibiotics. Sexual partners are usually notified so they can be tested and treated, and CDC guidance includes avoiding sex until seven days after treatment and retesting about three months later because reinfection is common. Testing for other STIs, including HIV and syphilis, is often done at the same time.",
    affectedBy:
      "Testing very soon after exposure or after recent antibiotics can give a false negative, and the test can stay positive for a few weeks after successful treatment.",
  },

  gonorrhea: {
    key: "gonorrhea",
    name: "Gonorrhea",
    short: "A bacterial STI that can infect genitals, throat or rectum",
    result: "detected",
    whatItIs:
      "Gonorrhea is a sexually transmitted infection caused by bacteria. The test looks for the bacteria's genetic material in urine or a swab.",
    whyChecked:
      "Gonorrhea often causes no symptoms, especially in women and in the throat or rectum. Untreated, it can cause pelvic inflammatory disease, infertility and, rarely, infection of the blood and joints.",
    high:
      "A detected result means gonorrhea was found and a current infection is very likely. A urine or genital test does not detect infection in the throat or rectum, which needs site-specific swabs.",
    low: null,
    whatCanBeDone:
      "Gonorrhea is treated with antibiotics, usually an injection, and treatment follows current guidance because the bacteria have developed resistance to several drugs. Partners are usually notified so they can be tested and treated, and CDC guidance includes retesting about three months after treatment and a follow-up test for throat infections. Testing for chlamydia, HIV and syphilis is often done at the same time.",
    affectedBy:
      "Testing very soon after exposure or after recent antibiotics can give a false negative, and the test can stay positive for a few weeks after successful treatment.",
  },

  syphilis: {
    key: "syphilis",
    name: "Syphilis",
    short: "A bacterial STI that can affect the whole body over time",
    result: "detected",
    whatItIs:
      "Syphilis is a sexually transmitted infection that progresses in stages over months to years. Blood tests look for antibodies the body makes against the bacteria.",
    whyChecked:
      "Early syphilis can cause a painless sore or rash that is easy to miss. Untreated, it can damage the brain, nerves, eyes and heart, and it can pass to a baby during pregnancy.",
    high:
      "A positive result means antibodies to syphilis were found. Testing usually involves two different kinds of antibody tests, and a positive on one is confirmed with the other. One kind usually stays positive for life even after cure, so a positive result can reflect a past, treated infection, and false positives can occur with pregnancy, autoimmune conditions or other infections.",
    low: null,
    whatCanBeDone:
      "Clinicians commonly confirm the result with a second type of test and review any past treatment. Syphilis is curable with antibiotics, usually penicillin injections, and follow-up blood tests over the next year check that treatment worked. Partners are usually notified so they can be tested and treated, and testing for HIV is commonly done at the same time.",
    affectedBy:
      "Antibodies can take several weeks after infection to appear, so a test done too early can be negative.",
  },

  hiv: {
    key: "hiv",
    name: "HIV",
    short: "A virus that weakens the immune system",
    result: "detected",
    whatItIs:
      "HIV (human immunodeficiency virus) attacks immune cells that fight infection. The standard lab test looks for both HIV antibodies and a viral protein called p24 antigen.",
    whyChecked:
      "Many people with HIV have no symptoms for years. The CDC recommends that everyone ages 13 to 64 be tested at least once, and more often with ongoing risk.",
    high:
      "A reactive result on the screening test is not a diagnosis by itself. It is confirmed with a second test that tells HIV-1 and HIV-2 antibodies apart, and sometimes with a test for the virus's genetic material (HIV RNA). A confirmed positive means HIV infection.",
    low: null,
    whatCanBeDone:
      "A reactive screen is usually followed promptly by confirmatory testing. HIV is treatable, and daily antiretroviral medicine lets people live long, healthy lives; people who keep an undetectable viral load do not transmit HIV through sex. Partners are usually offered testing, and prevention options such as PrEP exist for people without HIV.",
    affectedBy:
      "The lab test can miss infection in roughly the first 18 to 45 days after exposure, so testing too soon can give a false negative.",
  },

  hepatitis_b: {
    key: "hepatitis_b",
    name: "Hepatitis B surface antigen",
    short: "A test for a current hepatitis B infection",
    result: "detected",
    whatItIs:
      "Hepatitis B is a virus that infects the liver. The surface antigen (HBsAg) test looks for a protein on the virus's surface.",
    whyChecked:
      "Many people with hepatitis B have no symptoms, and long-term infection can lead to cirrhosis and liver cancer. The CDC recommends that all adults be tested at least once.",
    high:
      "A positive result means hepatitis B virus is present and the person can pass it to others. It can reflect a new infection or a chronic one; infection that lasts more than six months is considered chronic.",
    low: null,
    whatCanBeDone:
      "Clinicians commonly confirm the result and order other hepatitis B tests, such as core antibody, e antigen and viral load (HBV DNA), along with liver tests and sometimes a liver ultrasound. Antiviral medicines can control chronic hepatitis B and lower the risk of liver damage, and some people are monitored for liver cancer. Household members and sexual partners are usually offered testing and vaccination.",
    affectedBy:
      "A hepatitis B vaccine given in the few weeks before the test can cause a brief positive, and a test very soon after exposure can be negative; a negative result does not show immunity, which needs a surface antibody test.",
  },

  hepatitis_c: {
    key: "hepatitis_c",
    name: "Hepatitis C antibody",
    short: "A screen for past or current hepatitis C infection",
    result: "detected",
    whatItIs:
      "Hepatitis C is a virus that infects the liver and is mainly spread through blood. The antibody test shows whether the body has ever made antibodies to the virus.",
    whyChecked:
      "Hepatitis C often causes no symptoms for years while slowly damaging the liver. The CDC recommends that all adults be tested at least once and that pregnant people be tested during each pregnancy.",
    high:
      "A positive antibody result means the person was infected at some point. It does not show whether the virus is still there, because some people clear it on their own and antibodies usually remain for life. A hepatitis C RNA test is used to confirm a current infection.",
    low: null,
    whatCanBeDone:
      "A positive antibody result is followed by an HCV RNA test, which many labs run automatically on the same sample. Current infection is curable in more than 90% of people with 8 to 12 weeks of oral antiviral pills. Liver tests and an assessment of liver scarring are commonly part of care.",
    affectedBy:
      "Antibodies can take several weeks to a few months after exposure to appear, so testing too soon can give a false negative.",
  },

  trichomonas: {
    key: "trichomonas",
    name: "Trichomoniasis",
    short: "A common parasitic STI",
    result: "detected",
    whatItIs:
      "Trichomoniasis is a sexually transmitted infection caused by a tiny parasite. The test looks for the parasite's genetic material in urine or a swab.",
    whyChecked:
      "Most people with trichomoniasis have no symptoms. It can cause itching, discharge and pain with urination, raises the risk of getting or passing HIV, and in pregnancy is linked to early delivery.",
    high:
      "A detected result means the parasite was found and a current infection is very likely.",
    low: null,
    whatCanBeDone:
      "Trichomoniasis is curable with antibiotic pills. Partners are usually treated at the same time to prevent reinfection, and CDC guidance includes retesting women about three months after treatment. Testing for other STIs is often done at the same time.",
    affectedBy:
      "Testing very soon after exposure can give a false negative, and the test can stay positive for a few weeks after successful treatment.",
  },
};
