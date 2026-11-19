import { buildPanel, PanelItem as RuleItem, ScreeningProfile } from "../../labs_journey/domain/screening.rules";
import { withCatalog } from "../../labs_journey/domain/screening.catalog";
import { coverageOf } from "./coverage";
import { cadenceFor, LastDone, nextDue } from "./cadence";
import { optionalFor } from "./optional";
import { PlanItem, PreventivePlan, ServiceType, Tag, TYPE_LABEL, TYPE_ORDER } from "./types";
import { buildVaccines } from "./vaccines";

/**
 * BUILD THE PLAN (P0, pure). The existing guideline rules
 * (labs_journey/domain/screening.rules.ts — unchanged, the Health page still
 * reads them until P2) plus the vaccine rules, each item given its TYPE, a
 * plan name, CHECKS, coverage and the tags that say why it applies; "coming"
 * items for what starts within six years; then every other preventive test
 * as optional. Up-to-date items (a recent result covers them) are passed in.
 */

/** The type of every guideline rule item (also read by booking: which kind of place offers it). */
export const RULE_TYPE: Record<string, ServiceType> = {
  lipid_panel: "lab",
  hba1c_glucose: "lab",
  metabolic_panel: "lab",
  cbc: "lab",
  tsh: "lab",
  vitamin_d: "lab",
  ferritin_b12: "lab",
  lipoprotein_a: "lab",
  hiv: "lab",
  hepatitis_c: "lab",
  psa: "lab",
  chlamydia_gonorrhea: "lab",
  mammography: "diagnostic",
  cervical: "diagnostic",
  lung_ldct: "diagnostic",
  aaa_ultrasound: "diagnostic",
  dxa: "diagnostic",
  colorectal: "procedure",
  brca_assessment: "check",
  blood_pressure: "check",
  depression_screen: "check",
  prenatal: "check",
};

/** Plan names: the rule titles carry their cadence ("— once"); the plan says it in a tag instead. */
const NAME: Record<string, string> = {
  lipid_panel: "Cholesterol panel",
  hba1c_glucose: "Blood sugar (HbA1c)",
  metabolic_panel: "Metabolic panel",
  cbc: "Complete blood count",
  tsh: "Thyroid (TSH)",
  vitamin_d: "Vitamin D",
  ferritin_b12: "Iron stores and B12",
  lipoprotein_a: "Lp(a)",
  hiv: "HIV test",
  hepatitis_c: "Hepatitis C test",
  psa: "PSA (prostate)",
  chlamydia_gonorrhea: "Chlamydia and gonorrhea",
  mammography: "Mammogram",
  cervical: "Pap and HPV test",
  lung_ldct: "Low-dose lung CT",
  aaa_ultrasound: "Aortic aneurysm ultrasound",
  dxa: "Bone density (DEXA)",
  colorectal: "Colon cancer screening",
  brca_assessment: "Hereditary cancer risk assessment",
  blood_pressure: "Blood pressure",
  depression_screen: "Mood check",
  prenatal: "Prenatal care",
};

/** CHECKS — what the test looks at, one line (the catalog's "about" is the longer version, in the detail). */
const CHECKS: Record<string, string> = {
  lipid_panel: "LDL, HDL and triglycerides — the fats that build up in arteries",
  hba1c_glucose: "Average blood sugar over the last 3 months",
  metabolic_panel: "Kidneys, liver, salts and glucose in one test",
  cbc: "Red cells, white cells and platelets",
  tsh: "How hard your thyroid is being pushed to work",
  vitamin_d: "Your vitamin D level",
  ferritin_b12: "Iron stores and vitamin B12",
  lipoprotein_a: "An inherited cholesterol particle that diet and exercise don't change",
  hiv: "HIV infection, which often has no symptoms for years",
  hepatitis_c: "Hepatitis C, a liver infection that can be cured",
  psa: "A prostate protein that rises with cancer, enlargement or inflammation",
  chlamydia_gonorrhea: "Two common infections that often have no symptoms",
  mammography: "Early breast cancer, on a low-dose X-ray",
  cervical: "Changes in the cervix that can turn into cancer, and the virus that causes them",
  lung_ldct: "Early lung cancer, on a low-dose CT scan",
  aaa_ultrasound: "A bulge in the main artery of the abdomen",
  dxa: "Bone strength in the hip and spine",
  colorectal: "Polyps and early colon cancer — by colonoscopy, or a stool test at home",
  brca_assessment: "Whether your family history points to an inherited cancer risk",
  blood_pressure: "The pressure in your arteries",
  depression_screen: "Signs of depression, with two short questions",
  prenatal: "The checks your obstetric provider follows in pregnancy",
};

/** An optional test that is the same thing as a plan item: never offered twice. */
const SAME_AS: Record<string, string[]> = {
  vitamin_d: ["vitamin_d_opt"],
  dxa: ["dexa_bone_opt"],
  lung_ldct: ["lung_ct_opt"],
  psa: ["psa_baseline"],
  ferritin_b12: ["iron_panel", "b12_folate"],
  brca_assessment: ["genetic_panel"],
  colorectal: ["colon_early"],
};

/**
 * Why it applies to THIS person, from the profile (not parsed from the
 * reason's wording): a family history first, then something on their record,
 * then everyone / their age; plus "Once" for one-time tests.
 */
const tagsFor = (r: RuleItem, p: ScreeningProfile): Tag[] => {
  const has = (...k: string[]) => p.conditions.some((c) => k.some((w) => c.includes(w)));
  const fam: Record<string, boolean> = {
    lipid_panel: p.family.highCholesterol || p.family.earlyHeartDisease,
    lipoprotein_a: p.family.highCholesterol || p.family.earlyHeartDisease,
    hba1c_glucose: p.family.diabetes,
    colorectal: p.family.colorectalCancer,
    mammography: p.family.breastOrOvarianCancer,
    brca_assessment: p.family.breastOrOvarianCancer,
    psa: p.family.prostateCancer,
    dxa: p.family.osteoporosis,
    vitamin_d: p.family.osteoporosis,
  };
  const record: Record<string, boolean> = {
    lipid_panel: has("cholesterol", "hyperlipid", "heart", "coronary", "diabetes") || p.medications.some((m) => m.includes("statin")),
    lipoprotein_a: has("cholesterol", "hyperlipid", "heart", "coronary"),
    hba1c_glucose: has("diabetes", "prediabet") || (p.bmi ?? 0) >= 25,
    metabolic_panel: has("diabetes", "hypertension", "high blood pressure", "kidney", "liver") || p.medications.some((m) => /statin|metformin/.test(m)),
    cbc: has("anemia", "anaemia"),
    tsh: has("thyroid") || p.medications.some((m) => /levothyroxine|synthroid/.test(m)),
    vitamin_d: has("osteopor", "osteopenia", "kidney", "celiac", "crohn"),
    ferritin_b12: true,
    blood_pressure: has("hypertension", "high blood pressure"),
    lung_ldct: true,
    aaa_ultrasound: true,
    prenatal: true,
  };
  const everyone = ["hiv", "hepatitis_c", "blood_pressure", "depression_screen"];
  const tags: Tag[] = [];
  if (fam[r.key]) tags.push({ key: "family", text: "Family history" });
  else if (record[r.key]) tags.push({ key: "condition", text: "Your record" });
  else if (everyone.includes(r.key)) tags.push({ key: "everyone", text: "Everyone" });
  else if (p.age !== null && !["metabolic_panel", "cbc", "tsh"].includes(r.key)) tags.push({ key: "age", text: "Your age" });
  if (/^once/i.test(r.cadence)) tags.push({ key: "once", text: "Once" });
  return tags;
};

const fromRule = (r: RuleItem & { about?: string; howDone?: string }, p: ScreeningProfile): PlanItem => {
  const type = RULE_TYPE[r.key] ?? (r.kind === "LAB" ? "lab" : r.kind === "VISIT" ? "check" : "diagnostic");
  return {
    key: r.key,
    type,
    name: NAME[r.key] ?? r.title,
    checks: CHECKS[r.key] ?? r.title,
    why: r.reason,
    how: r.howDone ?? "",
    every: r.cadence,
    source: r.source,
    coverage: coverageOf(type, r.source),
    tags: tagsFor(r, p),
    status: "planned",
    priority: r.priority,
    ...(r.biomarkers ? { biomarkers: r.biomarkers } : {}),
  };
};

/**
 * What starts within five years, shown as "coming" so the plan already says
 * what is ahead (his mockup: "From 45"). The rule itself takes over at that age.
 */
const coming = (p: ScreeningProfile): PlanItem[] => {
  const age = p.age;
  if (age === null) return [];
  const out: PlanItem[] = [];
  // Six years ahead: a 39-year-old sees colon screening "From 45" (his mockup).
  const soon = (from: number) => age < from && age >= from - 6;
  const item = (key: string, type: ServiceType, why: string, from: number, source: PlanItem["source"]): PlanItem => ({
    key,
    type,
    name: NAME[key],
    checks: CHECKS[key],
    why,
    how: "",
    every: "",
    source,
    coverage: coverageOf(type, source),
    tags: [{ key: "coming", text: `From ${from}` }],
    status: "coming",
    priority: "DUE",
  });
  const USPSTF = (year: number, grade: string) => ({ org: "USPSTF", year, grade });
  if (soon(45) && !p.family.colorectalCancer) out.push(item("colorectal", "procedure", "Recommended for everyone from 45; nothing to do yet.", 45, USPSTF(2021, "B")));
  if (p.sex === "female" && soon(40)) out.push(item("mammography", "diagnostic", "Recommended every 2 years for women from 40; nothing to do yet.", 40, USPSTF(2024, "B")));
  if (p.sex === "female" && soon(65)) out.push(item("dxa", "diagnostic", "Recommended for all women from 65; nothing to do yet.", 65, USPSTF(2025, "B")));
  return out;
};

/**
 * `last`: when each item was last done (domain/history.ts). `cadence`: the
 * person's own intervals by key (months; 0 = once). An item whose next due
 * date is still ahead is UP TO DATE; one never done, done at an unknown date,
 * or whose date has come is in the plan (Nov 19 2026: last done → next due).
 */
/** An item with its last done, interval and next due; status from them (coming stays coming). */
export const withDates = <T extends { key: string; type: ServiceType; every: string; status: string }>(i: T, age: number | null, last: LastDone | null, override: number | null | undefined, today: string): T & { last: LastDone | null; cadence: ReturnType<typeof cadenceFor>; nextDue: string | null } => {
  const cadence = cadenceFor(i.key, i.type, age, last, override, i.every || "");
  const due = nextDue(last, cadence, today);
  const status = i.status === "coming" || i.status === "added" ? i.status : due.dueNow ? "planned" : "up_to_date";
  return { ...i, last, cadence, nextDue: due.on, status };
};

export const buildPlan = (p: ScreeningProfile, opts: { last?: Record<string, LastDone>; cadence?: Record<string, number | null>; today?: string } = {}): PreventivePlan => {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const rules = withCatalog(buildPanel(p)).map((r) => fromRule(r, p));
  const all = [...rules, ...buildVaccines(p)];
  const keys = new Set(all.map((i) => i.key));
  const items = [...all, ...coming(p).filter((c) => !keys.has(c.key))].map((i) => withDates(i, p.age, opts.last?.[i.key] ?? null, opts.cadence?.[i.key], today));

  const planned = items.filter((i) => i.status !== "up_to_date");
  const upToDate = items.filter((i) => i.status === "up_to_date");

  // Planned before coming; within each, the rules' weight (DUE, CONSIDER, DISCUSS).
  const weight = { DUE: 0, CONSIDER: 1, DISCUSS: 2 } as const;
  const order = (a: PlanItem, b: PlanItem) => (a.status === b.status ? 0 : a.status === "coming" ? 1 : -1) || weight[a.priority] - weight[b.priority];
  const groups = TYPE_ORDER.map((type) => ({ type, label: TYPE_LABEL[type], items: planned.filter((i) => i.type === type).sort(order) })).filter((g) => g.items.length);

  const inPlan = new Set<string>([...items.map((i) => i.key), ...items.flatMap((i) => SAME_AS[i.key] ?? [])]);
  const optional = optionalFor(p, inPlan);

  return {
    groups,
    upToDate,
    optional,
    counts: {
      planned: planned.filter((i) => i.status === "planned").length,
      coming: planned.filter((i) => i.status === "coming").length,
      upToDate: upToDate.length,
      optional: optional.length,
    },
  };
};
