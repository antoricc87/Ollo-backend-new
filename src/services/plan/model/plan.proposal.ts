/**
 * PLAN PROPOSAL — deterministic v1.
 *
 * Turns two answers (outcome, intensity) plus the patient's own baseline into
 * a concrete plan: pillar targets (sleep / exercise / nutrition) and nutrition
 * watch-outs derived from flagged labs and vitals. No LLM in the loop: the
 * shape is fixed, the numbers come from the user's data, and the user edits
 * before saving. The agent later reads the saved plan as a typed contract.
 *
 * Pure module — no I/O.
 */
import { calculateTDEE } from "../../../utils/calculateTDEE";
import { calculateAgeFromDob } from "../../../utils/calculateAgefromDob";

export type PlanOutcome =
  | "LOSE_WEIGHT"
  | "RECOMPOSITION"
  | "GENERAL_HEALTH"
  | "FIX_LAB";
export type PlanIntensity = "GENTLE" | "STEADY" | "AMBITIOUS";
export type PlanPillar = "SLEEP" | "EXERCISE" | "NUTRITION";
export type PlanCadence = "DAILY" | "WEEKLY";

export interface TargetProposal {
  pillar: PlanPillar;
  metricKey: string;
  cadence: PlanCadence;
  min: number | null;
  max: number | null;
  unit: string;
  baseline: number | null;
  tolerance: number;
}

export interface WatchOutProposal {
  nutrientKey: string;
  level: "WATCH" | "LIMIT";
  limit: number | null;
  unit: string | null;
  reason: string;
}

export interface PlanProposal {
  outcome: PlanOutcome;
  intensity: PlanIntensity;
  outcomeMetric: string | null;
  outcomeStart: number | null;
  outcomeTarget: number | null;
  outcomeUnit: string | null;
  labKey: string | null;
  targets: TargetProposal[];
  watchOuts: WatchOutProposal[];
  /** Human-readable notes on how numbers were derived (shown in setup). */
  notes: string[];
}

export interface ProposalInputs {
  outcome: PlanOutcome;
  intensity: PlanIntensity;
  labKey?: string | null;
  patient: {
    dob?: Date | string | null;
    gender?: string | null;
  };
  vitals: {
    weight?: number | null;
    weight_unit?: string | null;
    height?: number | null;
    height_unit?: string | null;
    bfp?: number | null;
    sBp?: number | null;
    dBp?: number | null;
  } | null;
  exerciseFrequency?: string | null;
  labs: { testType: string; isOutOfRange: boolean; result?: string }[];
  /** Observed on-device baselines the client sends (HealthKit). */
  baselines: {
    sleepMinutesAvg?: number | null;
    exerciseSessionsPerWeek?: number | null;
    weightKg?: number | null;
  };
}

const round = (n: number, step = 1) => Math.round(n / step) * step;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

const toKg = (w: number, unit?: string | null) =>
  unit && unit.toLowerCase().startsWith("lb") ? w * 0.453592 : w;
const toCm = (h: number, unit?: string | null) =>
  unit && unit.toLowerCase() === "metric" ? h : h * 2.54;

const CALORIE_DEFICIT: Record<PlanOutcome, Record<PlanIntensity, number>> = {
  LOSE_WEIGHT: { GENTLE: 250, STEADY: 500, AMBITIOUS: 750 },
  RECOMPOSITION: { GENTLE: 100, STEADY: 200, AMBITIOUS: 300 },
  GENERAL_HEALTH: { GENTLE: 0, STEADY: 0, AMBITIOUS: 0 },
  FIX_LAB: { GENTLE: 0, STEADY: 0, AMBITIOUS: 0 },
};

/** Macro split as fractions of calories: [protein, carbs, fat]. */
const MACRO_SPLIT: Record<PlanOutcome, [number, number, number]> = {
  LOSE_WEIGHT: [0.35, 0.35, 0.3],
  RECOMPOSITION: [0.4, 0.35, 0.25],
  GENERAL_HEALTH: [0.25, 0.45, 0.3],
  FIX_LAB: [0.25, 0.45, 0.3],
};

const SESSIONS_PER_WEEK: Record<PlanIntensity, number> = {
  GENTLE: 2,
  STEADY: 3,
  AMBITIOUS: 4,
};

const WEIGHT_LOSS_KG: Record<PlanIntensity, number> = {
  GENTLE: 2,
  STEADY: 4,
  AMBITIOUS: 6,
};

export const buildProposal = (input: ProposalInputs): PlanProposal => {
  const notes: string[] = [];
  const { outcome, intensity } = input;

  // ---- Baseline body numbers -------------------------------------------
  const weightKg =
    input.baselines.weightKg ??
    (input.vitals?.weight ? toKg(input.vitals.weight, input.vitals.weight_unit) : null);
  const heightCm = input.vitals?.height
    ? toCm(input.vitals.height, input.vitals.height_unit)
    : null;
  const age = input.patient.dob ? calculateAgeFromDob(new Date(input.patient.dob)) : null;
  const gender = (input.patient.gender ?? "").toLowerCase().startsWith("m")
    ? "male"
    : "female";

  let tdee: number | null = null;
  if (weightKg && heightCm && age != null) {
    tdee = calculateTDEE(weightKg, heightCm, age, gender, input.exerciseFrequency ?? "Never");
    notes.push(`Maintenance estimated at ${round(tdee, 10)} kcal from your body data.`);
  } else {
    tdee = 2000;
    notes.push("Body data incomplete — using a 2000 kcal maintenance estimate.");
  }

  // ---- Nutrition targets ---------------------------------------------------
  const calories = round(Math.max(1200, tdee - CALORIE_DEFICIT[outcome][intensity]), 10);
  const [pF, cF, fF] = MACRO_SPLIT[outcome];
  const protein = round((calories * pF) / 4, 5);
  const carbs = round((calories * cF) / 4, 5);
  const fat = round((calories * fF) / 9, 5);
  const band = (v: number, step: number) => ({
    min: round(v * 0.9, step),
    max: round(v * 1.1, step),
  });

  const targets: TargetProposal[] = [
    {
      pillar: "NUTRITION",
      metricKey: "calories",
      cadence: "DAILY",
      ...band(calories, 10),
      unit: "kcal",
      baseline: null,
      tolerance: 0,
    },
    {
      pillar: "NUTRITION",
      metricKey: "protein_g",
      cadence: "DAILY",
      ...band(protein, 5),
      unit: "g",
      baseline: null,
      tolerance: 0,
    },
    {
      pillar: "NUTRITION",
      metricKey: "carbs_g",
      cadence: "DAILY",
      ...band(carbs, 5),
      unit: "g",
      baseline: null,
      tolerance: 0,
    },
    {
      pillar: "NUTRITION",
      metricKey: "fat_g",
      cadence: "DAILY",
      ...band(fat, 5),
      unit: "g",
      baseline: null,
      tolerance: 0,
    },
  ];

  // ---- Sleep -----------------------------------------------------------------
  const sleepBase = input.baselines.sleepMinutesAvg ?? null;
  const sleepTarget = clamp(round(Math.max((sleepBase ?? 420) + 30, 450), 15), 420, 510);
  targets.push({
    pillar: "SLEEP",
    metricKey: "sleep_minutes",
    cadence: "DAILY",
    min: sleepTarget,
    max: null,
    unit: "min",
    baseline: sleepBase,
    tolerance: 0.05,
  });
  if (sleepBase != null)
    notes.push(
      `You're averaging ${Math.floor(sleepBase / 60)}:${String(Math.round(sleepBase % 60)).padStart(2, "0")} of sleep — aiming for ${Math.floor(sleepTarget / 60)}:${String(sleepTarget % 60).padStart(2, "0")}.`
    );

  // ---- Exercise --------------------------------------------------------------
  const sessionsBase = input.baselines.exerciseSessionsPerWeek ?? null;
  let sessions = SESSIONS_PER_WEEK[intensity];
  if (sessionsBase != null && sessionsBase >= sessions) sessions = Math.min(6, Math.round(sessionsBase) + 1);
  targets.push({
    pillar: "EXERCISE",
    metricKey: "exercise_sessions",
    cadence: "WEEKLY",
    min: sessions,
    max: null,
    unit: "sessions",
    baseline: sessionsBase,
    tolerance: 0,
  });

  // ---- Outcome -----------------------------------------------------------------
  let outcomeMetric: string | null = null;
  let outcomeStart: number | null = null;
  let outcomeTarget: number | null = null;
  let outcomeUnit: string | null = null;
  if (outcome === "LOSE_WEIGHT" && weightKg) {
    outcomeMetric = "weight";
    outcomeStart = round(weightKg, 0.1);
    outcomeTarget = round(weightKg - WEIGHT_LOSS_KG[intensity], 0.1);
    outcomeUnit = "kg";
  } else if (outcome === "RECOMPOSITION" && input.vitals?.bfp) {
    outcomeMetric = "bfp";
    outcomeStart = input.vitals.bfp;
    outcomeTarget = round(input.vitals.bfp - 2, 0.1);
    outcomeUnit = "%";
  } else if (outcome === "FIX_LAB" && input.labKey) {
    outcomeMetric = "lab";
    outcomeUnit = null;
  }

  // ---- Watch-outs from labs + vitals ------------------------------------------
  const watch = new Map<string, WatchOutProposal>();
  const add = (nutrientKey: string, reason: string) => {
    if (!watch.has(nutrientKey))
      watch.set(nutrientKey, { nutrientKey, level: "WATCH", limit: null, unit: null, reason });
  };
  for (const lab of input.labs) {
    if (!lab.isOutOfRange) continue;
    const t = lab.testType.toLowerCase();
    if (/ldl|cholesterol|non-hdl/.test(t)) {
      add("saturated_fat", `${lab.testType} flagged`);
      add("cholesterol", `${lab.testType} flagged`);
    }
    if (/glucose|a1c/.test(t)) add("added_sugar", `${lab.testType} flagged`);
    if (/triglycer/.test(t)) {
      add("added_sugar", `${lab.testType} flagged`);
      add("alcohol", `${lab.testType} flagged`);
    }
    if (/sodium|creatinine|egfr/.test(t)) add("sodium", `${lab.testType} flagged`);
  }
  const sBp = input.vitals?.sBp ?? 0;
  const dBp = input.vitals?.dBp ?? 0;
  if (sBp >= 130 || dBp >= 85) add("sodium", "Blood pressure above range");
  if (outcome === "LOSE_WEIGHT" || outcome === "RECOMPOSITION")
    add("added_sugar", "Supports the weight goal");

  return {
    outcome,
    intensity,
    outcomeMetric,
    outcomeStart,
    outcomeTarget,
    outcomeUnit,
    labKey: input.labKey ?? null,
    targets,
    watchOuts: Array.from(watch.values()),
    notes,
  };
};
