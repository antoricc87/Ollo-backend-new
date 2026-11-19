import { LastDone, Outcome } from "./cadence";

/**
 * LAST DONE, from every source the record has (pure). For each plan item the
 * newest DATED event wins; a record that only says it happened ("colonoscopy"
 * in the procedures list, a vaccine name) counts when nothing dated does, as
 * "done, date unknown".
 *
 * Sources: lab results (by biomarker, or by the test's name for tests without
 * a biomarker key: HIV, hepatitis C, PSA, chlamydia) · completed bookings and
 * what the person or a clinician said (PreventiveDone) · the record's
 * procedures and vaccines (names only).
 */

export type LabPoint = { key: string; name: string; collectedAt: string; outOfRange: boolean };
export type DoneRow = { itemKey: string; doneOn: Date | string; source: string; outcome: string };

/** Lab plan items → the biomarker keys that satisfy them (screening.rules `biomarkers`). */
export type BiomarkerMap = Record<string, string[]>;

/** Lab items without a biomarker key, found by the test's own name. */
const LAB_NAMES: Record<string, RegExp> = {
  hiv: /\bhiv\b/i,
  hepatitis_c: /hepatitis c|\bhcv\b/i,
  psa: /\bpsa\b|prostate[- ]specific/i,
  chlamydia_gonorrhea: /chlamydia|gonorr/i,
  apob: /apolipoprotein b|\bapo ?b\b/i,
  hscrp: /\bhs-?crp\b|high[- ]sensitivity c-?reactive/i,
};

/** Record names (procedures, vaccines) → plan item keys. */
const RECORD_NAMES: [RegExp, string][] = [
  [/colonoscop|sigmoidoscop|cologuard|\bfit\b|stool test/i, "colorectal"],
  [/mammogra/i, "mammography"],
  [/pap\b|pap smear|cervical|hpv test/i, "cervical"],
  [/dexa|dxa|bone density/i, "dxa"],
  [/low[- ]dose ct|ldct|lung cancer screen/i, "lung_ldct"],
  [/aortic aneurysm|aaa/i, "aaa_ultrasound"],
  [/influenza|\bflu\b/i, "flu"],
  [/tetanus|tdap|\btd\b/i, "tdap"],
  [/shingl|zoster|shingrix/i, "shingles"],
  [/pneumo|prevnar|pcv/i, "pneumococcal"],
  [/gardasil|hpv vacc/i, "hpv"],
  [/hepatitis b|hep b|heplisav|engerix/i, "hepatitis_b"],
  [/covid|sars-cov/i, "covid"],
  [/\brsv\b|arexvy|abrysvo/i, "rsv"],
  [/calcium score|coronary calcium|\bcac\b/i, "cac"],
  [/endoscop|\begd\b/i, "endoscopy"],
];

const dayOf = (d: Date | string) => (typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10));
const newer = (a: LastDone | undefined, b: LastDone) => !a || (b.on !== null && (a.on === null || b.on > a.on)) ? b : a;

export const lastDoneByItem = (input: {
  labs: LabPoint[];
  biomarkers: BiomarkerMap;
  done: DoneRow[];
  recordNames: string[];
}): Record<string, LastDone> => {
  const out: Record<string, LastDone> = {};
  const put = (key: string, d: LastDone) => (out[key] = newer(out[key], d));

  // Labs: the newest sample that measured the item, and what was out of range in it.
  const labKeys = new Set([...Object.keys(input.biomarkers), ...Object.keys(LAB_NAMES)]);
  for (const item of labKeys) {
    const want = new Set(input.biomarkers[item] ?? []);
    const re = LAB_NAMES[item];
    const hits = input.labs.filter((l) => want.has(l.key) || (re ? re.test(l.name) : false));
    if (!hits.length) continue;
    const day = hits.map((h) => dayOf(h.collectedAt)).sort().slice(-1)[0];
    const same = hits.filter((h) => dayOf(h.collectedAt) === day);
    const flagged = same.filter((h) => h.outOfRange).map((h) => h.name);
    put(item, { on: day, source: "lab", outcome: flagged.length ? "findings" : "normal", flagged });
  }

  for (const r of input.done)
    put(r.itemKey, { on: dayOf(r.doneOn), source: (["booking", "person", "clinician"].includes(r.source) ? r.source : "person") as LastDone["source"], outcome: (["normal", "findings"].includes(r.outcome) ? r.outcome : "unknown") as Outcome });

  for (const name of input.recordNames)
    for (const [re, key] of RECORD_NAMES) if (re.test(name) && !out[key]) out[key] = { on: null, source: "record", outcome: "unknown" };

  return out;
};
