import { calculateAgeFromDob } from "../../../utils/calculateAgefromDob";
import {
  buildCurrentLabs,
  labFreshness,
  LabFreshness,
  LabReportLike,
} from "../../../utils/labBiomarkers";
import { PanelItem, ScreeningProfile, Sex, SmokingStatus } from "./screening.rules";

/** What the app renders: a panel item plus whether existing labs already cover it. */
export type PanelItemView = PanelItem & {
  covered: null | {
    /** biomarker keys found within 12 months */
    keys: string[];
    collectedAt: string; // ISO of the oldest covering value
    freshness: LabFreshness;
  };
};

const lower = (xs: unknown[]): string[] =>
  xs.map((x) => String(x ?? "").toLowerCase().trim()).filter(Boolean);

const toCm = (height: unknown, unit: unknown): number | null => {
  const h = Number(height);
  if (!h) return null;
  const u = String(unit ?? "").toLowerCase();
  return u === "imperial" || u === "in" ? h * 2.54 : h;
};
const toKg = (weight: unknown, unit: unknown): number | null => {
  const w = Number(weight);
  if (!w) return null;
  return String(unit ?? "").toLowerCase() === "lbs" ? w * 0.4536 : w;
};

const smokingStatus = (vitals: any): SmokingStatus | null => {
  const habit = String(vitals?.smokingHabit ?? "").toLowerCase();
  if (habit.includes("daily") || habit.includes("occasion")) return "current";
  if (habit.includes("former")) return "former";
  if (habit.includes("never")) return "never";
  if (vitals?.isSmoker === true) return "current";
  if (vitals?.isSmoker === false) return "never";
  return null;
};

/** Map a `getPatientById` result onto the rules' input. */
export const buildScreeningProfile = (patient: any): ScreeningProfile => {
  const summary = patient?.patientSummary ?? {};
  const vitals = summary.vitals ?? {};
  const fh = summary.familyHistory ?? {};
  const conditions = lower((summary.conditions ?? []).map((c: any) => c?.condition?.name));
  const medications = lower((summary.medications ?? []).map((m: any) => m?.medication?.name));
  const diet = lower(summary.nutrition?.dietaryPreferences ?? []);

  const cm = toCm(vitals.height, vitals.height_unit);
  const kg = toKg(vitals.weight, vitals.weight_unit);
  const bmi = cm && kg ? kg / Math.pow(cm / 100, 2) : null;

  const sexRaw = String(patient?.gender ?? "").toLowerCase();
  const sex: Sex | null = sexRaw.startsWith("f") ? "female" : sexRaw.startsWith("m") ? "male" : sexRaw ? "other" : null;

  const cancers = lower(fh.historyOfCancer ?? []);
  const chronic = lower(fh.historyOfChronicConditions ?? []);
  const hereditary = lower(fh.historyOfHereditaryConditions ?? []);

  return {
    age: patient?.dob ? calculateAgeFromDob(patient.dob) : null,
    sex,
    bmi,
    smoking: smokingStatus(vitals),
    conditions,
    medications,
    diet,
    family: {
      breastOrOvarianCancer: cancers.some((x) => x.includes("breast") || x.includes("ovarian")),
      colorectalCancer: cancers.some((x) => x.includes("colorectal") || x.includes("colon") || x.includes("bowel")),
      prostateCancer: cancers.some((x) => x.includes("prostate")),
      diabetes: chronic.some((x) => x.includes("diabet")) || hereditary.some((x) => x.includes("diabet")),
      earlyHeartDisease: fh.historyOfHeartAttack === true || chronic.some((x) => x.includes("heart")),
      highCholesterol: fh.historyOfHighCholesterol === true,
      osteoporosis: chronic.some((x) => x.includes("osteopor")) || hereditary.some((x) => x.includes("osteopor")),
    },
    pregnant: conditions.some((x) => x.includes("pregnan")),
  };
};

/**
 * Mark LAB items whose biomarkers already exist within 12 months. An item is
 * covered when at least one of its biomarkers is present and none of the
 * present ones is stale; "aging" (6–12 mo) still counts as covered so the
 * app can show "retest in N months" rather than "due".
 */
export const applyCoverage = (items: PanelItem[], reports: LabReportLike[]): PanelItemView[] => {
  const current = buildCurrentLabs(reports ?? []);
  const byKey = new Map(current.map((b) => [b.key, b]));
  return items.map((item) => {
    if (item.kind !== "LAB" || !item.biomarkers?.length) return { ...item, covered: null };
    const found = item.biomarkers.map((k) => byKey.get(k)).filter(Boolean) as typeof current;
    if (found.length === 0) return { ...item, covered: null };
    const fresh = found.filter((b) => labFreshness(b.collectedAt) !== "stale");
    if (fresh.length === 0) return { ...item, covered: null };
    const oldest = fresh.reduce((a, b) => (a.collectedAt < b.collectedAt ? a : b));
    return {
      ...item,
      covered: {
        keys: fresh.map((b) => b.key),
        collectedAt: oldest.collectedAt,
        freshness: labFreshness(oldest.collectedAt),
      },
    };
  });
};

/** Plain-text checklist for the "bring to your doctor" route and the Share sheet. */
export const checklistText = (items: PanelItemView[], firstName?: string | null): string => {
  const due = items.filter((i) => i.priority === "DUE" && !i.covered);
  const consider = items.filter((i) => i.priority !== "DUE" && !i.covered);
  const covered = items.filter((i) => i.covered);
  const line = (i: PanelItemView) =>
    `• ${i.title} — ${i.cadence} (${i.source.org}${i.source.grade ? ` ${i.source.grade}` : ""}, ${i.source.year})`;
  const parts: string[] = [];
  parts.push(`Labs and screenings to discuss${firstName ? ` — ${firstName}` : ""}`);
  parts.push("Guideline-based suggestions from Ollo. Your clinician decides what to order.");
  if (due.length) parts.push("", "Due:", ...due.map(line));
  if (consider.length) parts.push("", "Worth discussing:", ...consider.map(line));
  if (covered.length)
    parts.push(
      "",
      "Already current:",
      ...covered.map((i) => `• ${i.title} — last ${i.covered!.collectedAt.slice(0, 10)}`)
    );
  return parts.join("\n");
};
