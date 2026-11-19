import type { ScreeningProfile } from "../../labs_journey/domain/screening.rules";
import { coverageOf } from "./coverage";
import { PlanItem, Source, Tag } from "./types";

/**
 * VACCINE RULES — the CDC adult immunization schedule (ACIP recommendations
 * adopted by CDC), deterministic like the screening rules. NEEDS CLINICAL
 * REVIEW (new rules, Nov 19 2026), and re-check against the schedule each
 * year: ACIP changes it (pneumococcal moved to 50 in 2024; RSV to 50–74 at
 * risk in 2025; COVID-19 became an individual decision in 2025).
 *
 * We do not know which shots someone already had, so a reason never says
 * "due": it says who it is recommended for and, where it is a booster, to
 * tell the clinician when the last one was. Records of past doses come later
 * (immunizations on the PatientSummary).
 */

const ACIP = (year: number): Source => ({ org: "CDC · ACIP adult schedule", year, url: "https://www.cdc.gov/vaccines/hcp/imz-schedules/adult-age.html" });

const has = (list: string[], ...keywords: string[]) => list.some((x) => keywords.some((k) => x.includes(k)));
const between = (age: number | null, min: number, max: number) => age !== null && age >= min && age <= max;

type V = Omit<PlanItem, "type" | "coverage" | "status" | "priority"> & { priority?: PlanItem["priority"]; status?: PlanItem["status"] };

const vaccine = (v: V): PlanItem => ({
  ...v,
  type: "vaccine",
  priority: v.priority ?? "DUE",
  status: v.status ?? "planned",
  coverage: coverageOf("vaccine", v.source),
});

export const buildVaccines = (p: ScreeningProfile): PlanItem[] => {
  const out: PlanItem[] = [];
  const age = p.age;
  const c = p.conditions;
  const diabetes = has(c, "diabetes", "diabetic");
  const heartLung = has(c, "heart failure", "cardiomyopathy", "coronary", "heart disease", "copd", "emphysema", "asthma", "chronic lung");
  const liver = has(c, "liver", "cirrhosis", "hepatitis");
  const kidney = has(c, "kidney disease", "ckd", "renal");
  const immuno = has(c, "hiv", "immunocompromis", "immunosuppress", "transplant", "chemotherapy", "lupus", "rheumatoid");
  const smoker = p.smoking === "current";
  const pneumoRisk = diabetes || heartLung || liver || kidney || immuno || smoker || has(c, "alcohol");
  const rsvRisk = diabetes || heartLung || kidney || liver || immuno || has(c, "obes");

  out.push(
    vaccine({
      key: "flu",
      name: "Flu vaccine",
      checks: "Protects against the flu strains expected this season",
      why: "Recommended every year for everyone 6 months and older.",
      how: "One shot at a pharmacy or clinic; takes a few minutes.",
      every: "Every fall",
      source: ACIP(2025),
      tags: [{ key: "everyone", text: "Every fall" }],
    })
  );

  out.push(
    vaccine({
      key: "tdap",
      name: "Tetanus booster (Td/Tdap)",
      checks: "Protects against tetanus, diphtheria and whooping cough",
      why: p.pregnant
        ? "Recommended in every pregnancy (weeks 27–36), and a booster every 10 years for all adults."
        : "Recommended every 10 years for all adults; tell your clinician when you last had one.",
      how: "One shot at a pharmacy or clinic.",
      every: "Every 10 years",
      source: ACIP(2025),
      tags: [{ key: "everyone", text: "Every 10 years" }],
    })
  );

  if ((age !== null && age >= 50) || (immuno && age !== null && age >= 19)) {
    out.push(
      vaccine({
        key: "shingles",
        name: "Shingles vaccine (Shingrix)",
        checks: "Protects against shingles and the nerve pain that can follow it",
        why: immuno && (age ?? 0) < 50 ? "Recommended from 19 for people with a weakened immune system." : "Recommended for everyone 50 and older, even after shingles or an older shingles vaccine.",
        how: "Two shots, 2–6 months apart, at a pharmacy or clinic. A sore arm and a tired day afterwards are common.",
        every: "Once (two doses)",
        source: ACIP(2025),
        tags: [immuno && (age ?? 0) < 50 ? { key: "condition", text: "Your record" } : { key: "age", text: "Age 50+" }, { key: "once", text: "Once" }],
      })
    );
  } else if (between(age, 45, 49)) {
    out.push(
      vaccine({
        key: "shingles",
        name: "Shingles vaccine (Shingrix)",
        checks: "Protects against shingles and the nerve pain that can follow it",
        why: "Recommended for everyone from 50; nothing to do yet.",
        how: "Two shots, 2–6 months apart.",
        every: "Once (two doses)",
        source: ACIP(2025),
        tags: [{ key: "coming", text: "From 50" }],
        status: "coming",
      })
    );
  }

  if ((age !== null && age >= 50) || (pneumoRisk && between(age, 19, 49))) {
    out.push(
      vaccine({
        key: "pneumococcal",
        name: "Pneumococcal vaccine",
        checks: "Protects against pneumonia, meningitis and blood infections caused by pneumococcus",
        why: (age ?? 0) >= 50 ? "Recommended once for everyone 50 and older." : smoker && !(diabetes || heartLung || liver || kidney || immuno) ? "Recommended from 19 for people who smoke." : "Recommended from 19 with a condition on your record that raises the risk.",
        how: "One shot (PCV20 or PCV21) at a pharmacy or clinic.",
        every: "Once",
        source: ACIP(2024),
        tags: [(age ?? 0) >= 50 ? { key: "age", text: "Age 50+" } : { key: "condition", text: smoker && !(diabetes || heartLung || liver || kidney || immuno) ? "Smoking" : "Your record" }, { key: "once", text: "Once" }],
      })
    );
  }

  if (age !== null && age <= 26 && age >= 19) {
    out.push(
      vaccine({
        key: "hpv",
        name: "HPV vaccine",
        checks: "Protects against the virus behind most cervical, anal and throat cancers",
        why: "Recommended through age 26 for anyone not fully vaccinated.",
        how: "Two or three shots over 6 months.",
        every: "Once (series)",
        source: ACIP(2025),
        tags: [{ key: "age", text: "Through 26" }, { key: "once", text: "Once" }],
      })
    );
  } else if (between(age, 27, 45)) {
    out.push(
      vaccine({
        key: "hpv",
        name: "HPV vaccine",
        checks: "Protects against the virus behind most cervical, anal and throat cancers",
        why: "From 27 to 45 it is a decision to make with a clinician; most benefit comes before exposure to HPV.",
        how: "Two or three shots over 6 months.",
        every: "Once (series)",
        source: ACIP(2025),
        tags: [{ key: "age", text: "Age 27–45" }],
        priority: "DISCUSS",
      })
    );
  }

  if (between(age, 19, 59) || (age !== null && age >= 60 && (diabetes || liver || immuno || kidney))) {
    out.push(
      vaccine({
        key: "hepatitis_b",
        name: "Hepatitis B vaccine",
        checks: "Protects against hepatitis B, a liver infection that can become lifelong",
        why: between(age, 19, 59) ? "Recommended for all adults 19–59 not already vaccinated; many were as children — check your records." : "Recommended from 60 with a condition on your record that raises the risk.",
        how: "Two or three shots over 1–6 months, depending on the brand.",
        every: "Once (series)",
        source: ACIP(2025),
        tags: [{ key: "once", text: "Once" }],
        priority: "CONSIDER",
      })
    );
  }

  if ((age !== null && age >= 75) || (rsvRisk && between(age, 50, 74))) {
    out.push(
      vaccine({
        key: "rsv",
        name: "RSV vaccine",
        checks: "Protects against respiratory syncytial virus, a serious lung infection in older adults",
        why: (age ?? 0) >= 75 ? "Recommended once for everyone 75 and older." : "Recommended once from 50 with a condition on your record that raises the risk.",
        how: "One shot, best given in late summer or early fall.",
        every: "Once",
        source: ACIP(2025),
        tags: [(age ?? 0) >= 75 ? { key: "age", text: "Age 75+" } : { key: "condition", text: "Your record" }, { key: "once", text: "Once" }],
      })
    );
  }
  if (p.pregnant) {
    out.push(
      vaccine({
        key: "rsv_pregnancy",
        name: "RSV vaccine in pregnancy",
        checks: "Passes protection against RSV to the baby for its first months",
        why: "Recommended at 32–36 weeks during RSV season, unless the baby will get antibody shots instead.",
        how: "One shot from your obstetric provider or a pharmacy.",
        every: "In pregnancy",
        source: ACIP(2025),
        tags: [{ key: "condition", text: "Pregnancy" }],
      })
    );
  }

  out.push(
    vaccine({
      key: "covid",
      name: "COVID-19 vaccine",
      checks: "Protects against severe COVID-19",
      why: "An individual decision with your clinician since 2025; most useful at 65+ or with a condition that raises the risk.",
      how: "One shot at a pharmacy or clinic.",
      every: "Yearly, if you choose it",
      source: ACIP(2025),
      tags: [],
      priority: (age ?? 0) >= 65 || pneumoRisk ? "CONSIDER" : "DISCUSS",
    })
  );

  return out;
};
