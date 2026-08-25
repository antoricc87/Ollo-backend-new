import prisma from "../../../utility/prismaClient";
import { buildCurrentLabs, labFreshness, LabFreshness } from "../../../utils/labBiomarkers";
import { calculateAgeFromDob } from "../../../utils/calculateAgefromDob";
import memoryStore from "../memory/memory.store";
import {
  dayKey,
  daysBetween,
  isoWeekRange,
  nowIn,
  parseStoredDate,
  safeTz,
} from "../memory/dates";

/**
 * Patient snapshot — the compact (~1–2k token) picture of the patient that
 * is injected into EVERY agent turn. Depth comes from read tools; this is
 * only what the agent must always know: plan, today vs targets, flagged
 * labs, recent vitals, what's on record, preferences, sub-accounts, memories.
 *
 * Sleep/steps/HRV live in HealthKit on the phone, so the app may pass them
 * as `ClientContext`; the server never stores them here.
 *
 * Date handling (tracker tables store strings, three shapes — see dates.ts):
 *   DailyFood / DailyNutrients / DailyCalories.date  "YYYY-MM-DDT00:00:00.000+00:00" (local midnight)
 *   DailyExercise.date                                "YYYY-MM-DDT00:00:00.000-05:00" (local, real offset)
 *   DailyBloodPressure / DailyGlucose.date            "MM-DD-YYYY"
 *   WeightEntry / BFPEntry / *Entry.createdAt         ISO from the client
 */

export type ClientContext = {
  sleepMinutesLastNight?: number;
  stepsToday?: number;
  activeEnergyToday?: number; // kcal
  restingHeartRate?: number;
  hrvMs?: number;
  weekSleepAvgMinutes?: number;
  weekStepsAvg?: number;
};

export type SnapshotTarget = {
  pillar: "SLEEP" | "EXERCISE" | "NUTRITION";
  metricKey: string;
  cadence: "DAILY" | "WEEKLY";
  min: number | null;
  max: number | null;
  unit: string;
};

export type PatientSnapshot = {
  generatedAt: string;
  patientId: string;
  timeZone: string;
  today: string; // local YYYY-MM-DD
  profile: {
    firstName: string | null;
    age: number | null;
    gender: string | null;
    height: { value: number; unit: string } | null;
    weight: { value: number; unit: string } | null;
    activityLevel: string | null;
    smoking: string | null;
    alcohol: string | null;
    caffeine: string | null;
    isProUser: boolean;
    onboardingComplete: boolean;
  };
  plan: null | {
    id: string;
    outcome: string;
    intensity: string;
    status: string;
    startedAt: string;
    weekNumber: number;
    outcomeMetric: { metric: string | null; start: number | null; target: number | null; unit: string | null } | null;
    targets: SnapshotTarget[];
    watchOuts: { nutrientKey: string; level: string; limit: number | null; unit: string | null; reason: string | null }[];
  };
  today_log: {
    calories: number | null;
    protein_g: number | null;
    carbs_g: number | null;
    fat_g: number | null;
    fiber_g: number | null;
    sodium_mg: number | null;
    addedSugar_g: number | null;
    meals: { mealType: string | null; description: string; calories: number }[];
    exerciseMinutes: number | null;
  };
  week: {
    start: string;
    end: string;
    daysLogged: number;
    avgCalories: number | null;
    avgProtein_g: number | null;
    exerciseSessions: number;
    exerciseMinutes: number;
  };
  vitals: {
    weight: { value: number; unit: string; at: string; change30d: number | null } | null;
    bfp: { value: number; at: string } | null;
    bloodPressure: { systolic: number; diastolic: number; readings: number; at: string } | null;
    glucose: { value: number; at: string } | null;
  };
  labs: {
    totalBiomarkers: number;
    latestCollectedAt: string | null;
    flagged: {
      key: string;
      testType: string;
      result: string;
      units: string | null;
      referenceRange: string;
      collectedAt: string;
      freshness: LabFreshness;
    }[];
  };
  records: {
    conditions: string[];
    allergies: string[];
    medications: { name: string; dosage: string }[];
    immunizations: number;
  };
  nutrition: {
    dietaryPreferences: string[];
    foodAllergies: string[];
    intolerances: string[];
    likes: string[];
    dislikes: string[];
    avoid: string[];
    increase: string[];
    supplements: { name: string; quantity: string }[];
    hydration: string | null;
  };
  exercise: { frequency: string | null; preferences: string[] };
  subAccounts: { id: string; name: string; age: number | null }[];
  memories: { id: string; category: string; content: string }[];
  client: ClientContext | null;
};

const round = (n: number | null | undefined, d = 0) =>
  n === null || n === undefined || isNaN(n) ? null : Number(n.toFixed(d));

const sum = (xs: (number | null | undefined)[]) =>
  xs.reduce<number>((a, b) => a + (b ?? 0), 0);

/** Empty strings from onboarding forms count as "not provided". */
const str = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

/** VitalsSummary stores unit *systems* ("metric"/"imperial") as often as units. */
const heightUnit = (u: string | null | undefined) =>
  !u || u === "metric" ? "cm" : u === "imperial" ? "in" : u;
const weightUnit = (u: string | null | undefined) =>
  !u || u === "metric" ? "kg" : u === "imperial" ? "lb" : u;

const uniq = (xs: (string | null | undefined)[]) =>
  Array.from(new Set(xs.filter((x): x is string => !!x && x.trim().length > 0)));

/** A day counts as an exercise session from this many minutes. */
const SESSION_MIN_MINUTES = 10;
const MAX_FLAGGED_LABS = 10;
const MAX_MEMORIES = 20;

export async function buildPatientSnapshot(
  patientId: string,
  client: ClientContext | null = null
): Promise<PatientSnapshot | null> {
  const patient = await prisma.patient.findUnique({
    where: { id: patientId },
    include: {
      patientSummary: {
        include: {
          vitals: true,
          nutrition: { include: { supplements: true } },
          exercise: true,
          conditions: { include: { condition: true } },
          allergies: { include: { allergy: true } },
          medications: { include: { medication: true } },
          labResults: { include: { labResults: true } },
        },
      },
      subAccounts: { select: { id: true, firstName: true, lastName: true, dob: true } },
    },
  });
  if (!patient) return null;

  const tz = safeTz(patient.timeZone);
  const now = nowIn(tz);
  const today = dayKey(tz, now);
  const week = isoWeekRange(tz, now);
  const summary = patient.patientSummary;

  const [plan, todayFood, weekFood, todayNutrients, weekExercise, weightEntries, bfpEntry, bpEntries, glucoseEntry, memories] =
    await Promise.all([
      prisma.healthPlan.findFirst({
        where: { patientId, status: "ACTIVE" },
        include: { targets: true, watchOuts: true },
        orderBy: { createdAt: "desc" },
      }),
      prisma.dailyFood.findMany({
        where: { userId: patientId, date: { startsWith: today } },
        include: {
          foodEntries: {
            select: { mealType: true, description: true, calories: true, proteins: true, carbohydrates: true, fats: true, fiber: true, sodium: true, addedSugar: true },
          },
        },
      }),
      prisma.dailyFood.findMany({
        where: { userId: patientId, date: { gte: week.start, lt: week.next } },
        include: { foodEntries: { select: { calories: true, proteins: true } } },
      }),
      prisma.dailyNutrients.findMany({
        where: { userId: patientId, date: { startsWith: today } },
      }),
      prisma.dailyExercise.findMany({
        where: { userId: patientId, date: { gte: week.start, lt: week.next } },
        select: { date: true, minutesOfExercise: true },
      }),
      prisma.weightEntry.findMany({
        where: { tracker: { userId: patientId } },
        orderBy: { createdAt: "desc" },
        take: 90,
        select: { weight: true, unit: true, createdAt: true },
      }),
      prisma.bFPEntry.findFirst({
        where: { tracker: { userId: patientId } },
        orderBy: { createdAt: "desc" },
        select: { percentage: true, createdAt: true },
      }),
      prisma.bloodPressureEntry.findMany({
        where: { dailyTracker: { userId: patientId } },
        orderBy: { createdAt: "desc" },
        take: 3,
        select: { systolic: true, diastolic: true, createdAt: true },
      }),
      prisma.glucoseEntry.findFirst({
        where: { dailyTracker: { userId: patientId } },
        orderBy: { createdAt: "desc" },
        select: { value: true, createdAt: true },
      }),
      memoryStore.listActive(patientId, MAX_MEMORIES),
    ]);

  /* ----------------------------- today ----------------------------- */
  const todayEntries = todayFood.flatMap((d) => d.foodEntries);
  const nutrientsToday = todayNutrients[0] ?? null; // one row per local day
  const todayCalories = todayEntries.length ? sum(todayEntries.map((e) => e.calories)) : null;
  const macro = (fromEntries: number | null, fromTracker: number | null | undefined) =>
    fromEntries !== null ? round(fromEntries, 1) : round(fromTracker ?? null, 1);
  const todayExercise = weekExercise.filter((e) => e.date.startsWith(today));

  const today_log: PatientSnapshot["today_log"] = {
    calories: todayCalories,
    protein_g: macro(todayEntries.length ? sum(todayEntries.map((e) => e.proteins)) : null, nutrientsToday?.proteins),
    carbs_g: macro(todayEntries.length ? sum(todayEntries.map((e) => e.carbohydrates)) : null, nutrientsToday?.carbohydrates),
    fat_g: macro(todayEntries.length ? sum(todayEntries.map((e) => e.fats)) : null, nutrientsToday?.fats),
    fiber_g: macro(todayEntries.length ? sum(todayEntries.map((e) => e.fiber)) : null, nutrientsToday?.fiber),
    sodium_mg: macro(todayEntries.length ? sum(todayEntries.map((e) => e.sodium)) : null, nutrientsToday?.sodium),
    addedSugar_g: macro(todayEntries.length ? sum(todayEntries.map((e) => e.addedSugar)) : null, nutrientsToday?.addedSugar),
    meals: todayEntries.map((e) => ({
      mealType: e.mealType ?? null,
      description: e.description.slice(0, 80),
      calories: e.calories,
    })),
    exerciseMinutes: todayExercise.length ? sum(todayExercise.map((e) => e.minutesOfExercise)) : null,
  };

  /* ----------------------------- week ------------------------------ */
  const perDay = new Map<string, { kcal: number; protein: number; n: number }>();
  for (const d of weekFood) {
    const key = d.date.slice(0, 10);
    const cur = perDay.get(key) ?? { kcal: 0, protein: 0, n: 0 };
    cur.kcal += sum(d.foodEntries.map((e) => e.calories));
    cur.protein += sum(d.foodEntries.map((e) => e.proteins));
    cur.n += d.foodEntries.length;
    perDay.set(key, cur);
  }
  const loggedDays = Array.from(perDay.values()).filter((d) => d.n > 0);
  const exerciseByDay = new Map<string, number>();
  for (const e of weekExercise)
    exerciseByDay.set(e.date.slice(0, 10), (exerciseByDay.get(e.date.slice(0, 10)) ?? 0) + e.minutesOfExercise);
  const weekOut: PatientSnapshot["week"] = {
    start: week.start,
    end: week.end,
    daysLogged: loggedDays.length,
    avgCalories: loggedDays.length ? round(sum(loggedDays.map((d) => d.kcal)) / loggedDays.length) : null,
    avgProtein_g: loggedDays.length ? round(sum(loggedDays.map((d) => d.protein)) / loggedDays.length) : null,
    exerciseSessions: Array.from(exerciseByDay.values()).filter((m) => m >= SESSION_MIN_MINUTES).length,
    exerciseMinutes: sum(Array.from(exerciseByDay.values())),
  };

  /* ----------------------------- vitals ---------------------------- */
  const weights = weightEntries
    .map((w) => ({ ...w, at: parseStoredDate(w.createdAt) }))
    .filter((w): w is typeof w & { at: Date } => !!w.at)
    .sort((a, b) => b.at.getTime() - a.at.getTime());
  let weight: PatientSnapshot["vitals"]["weight"] = null;
  if (weights.length) {
    const latest = weights[0];
    const ref = weights.find((w) => daysBetween(latest.at, w.at) >= 28 && w.unit === latest.unit);
    weight = {
      value: latest.weight,
      unit: latest.unit,
      at: dayKey(tz, latest.at),
      change30d: ref ? round(latest.weight - ref.weight, 1) : null,
    };
  }
  const bfpAt = parseStoredDate(bfpEntry?.createdAt);
  const bpAt = parseStoredDate(bpEntries[0]?.createdAt);
  const gluAt = parseStoredDate(glucoseEntry?.createdAt);
  const vitals: PatientSnapshot["vitals"] = {
    weight,
    bfp: bfpEntry && bfpAt ? { value: bfpEntry.percentage, at: dayKey(tz, bfpAt) } : null,
    bloodPressure:
      bpEntries.length && bpAt
        ? {
            systolic: Math.round(sum(bpEntries.map((b) => b.systolic)) / bpEntries.length),
            diastolic: Math.round(sum(bpEntries.map((b) => b.diastolic)) / bpEntries.length),
            readings: bpEntries.length,
            at: dayKey(tz, bpAt),
          }
        : null,
    glucose: glucoseEntry && gluAt ? { value: glucoseEntry.value, at: dayKey(tz, gluAt) } : null,
  };

  /* ------------------------------ labs ----------------------------- */
  const current = buildCurrentLabs((summary?.labResults ?? []) as any);
  const flagged = current
    .filter((b) => b.isOutOfRange)
    .sort((a, b) => b.collectedAt.localeCompare(a.collectedAt))
    .slice(0, MAX_FLAGGED_LABS)
    .map((b) => ({
      key: b.key,
      testType: b.testType,
      result: b.result,
      units: b.units ?? null,
      referenceRange: b.referenceRange,
      collectedAt: b.collectedAt.slice(0, 10),
      freshness: labFreshness(b.collectedAt, now.toDate()),
    }));
  const labs: PatientSnapshot["labs"] = {
    totalBiomarkers: current.length,
    latestCollectedAt: current.length
      ? current.map((b) => b.collectedAt).sort().reverse()[0].slice(0, 10)
      : null,
    flagged,
  };

  /* ------------------------------ plan ----------------------------- */
  const planOut: PatientSnapshot["plan"] = plan
    ? {
        id: plan.id,
        outcome: plan.outcome,
        intensity: plan.intensity,
        status: plan.status,
        startedAt: dayKey(tz, plan.startedAt),
        weekNumber: Math.floor(daysBetween(now.toDate(), plan.startedAt) / 7) + 1,
        outcomeMetric: plan.outcomeMetric
          ? { metric: plan.outcomeMetric, start: plan.outcomeStart, target: plan.outcomeTarget, unit: plan.outcomeUnit }
          : null,
        targets: plan.targets.map((t) => ({
          pillar: t.pillar,
          metricKey: t.metricKey,
          cadence: t.cadence,
          min: t.min,
          max: t.max,
          unit: t.unit,
        })),
        watchOuts: plan.watchOuts.map((w) => ({
          nutrientKey: w.nutrientKey,
          level: w.level,
          limit: w.limit,
          unit: w.unit,
          reason: w.reason,
        })),
      }
    : null;

  /* ----------------------------- records --------------------------- */
  const v = summary?.vitals;
  const n = summary?.nutrition;
  return {
    generatedAt: now.toISOString(),
    patientId,
    timeZone: tz,
    today,
    profile: {
      firstName: patient.firstName ?? null,
      age: patient.dob ? calculateAgeFromDob(patient.dob) : null,
      gender: patient.gender ?? null,
      height: v?.height ? { value: v.height, unit: heightUnit(v.height_unit) } : null,
      weight: v?.weight ? { value: v.weight, unit: weightUnit(v.weight_unit) } : null,
      activityLevel: str(v?.activityLevel),
      smoking: str(v?.smokingHabit) ?? (v?.isSmoker === true ? "smoker" : v?.isSmoker === false ? "non-smoker" : null),
      alcohol: str(v?.alcoholConsumption),
      caffeine: str(v?.caffeine),
      isProUser: patient.isProUser,
      onboardingComplete: patient.onBoardingComplete,
    },
    plan: planOut,
    today_log,
    week: weekOut,
    vitals,
    labs,
    records: {
      conditions: uniq((summary?.conditions ?? []).map((c) => c.condition?.name)),
      allergies: uniq((summary?.allergies ?? []).map((a) => a.allergy?.substance)),
      medications: (summary?.medications ?? [])
        .filter((m) => m.medication)
        .map((m) => ({ name: m.medication.name, dosage: m.medication.dosage })),
      immunizations: summary?.immunizations?.length ?? 0,
    },
    nutrition: {
      dietaryPreferences: uniq(n?.dietaryPreferences ?? []),
      foodAllergies: uniq(n?.foodAllergies ?? []),
      intolerances: uniq(n?.foodIntollerances ?? []),
      likes: uniq(n?.foodILike ?? []),
      dislikes: uniq(n?.foodIDontLike ?? []),
      avoid: uniq(n?.foodsToAvoid ?? []),
      increase: uniq(n?.foodsToIncrease ?? []),
      supplements: (n?.supplements ?? []).map((s) => ({ name: s.name, quantity: s.quantity })),
      hydration: str(n?.hydrationHabits),
    },
    exercise: {
      frequency: str(summary?.exercise?.frequency),
      preferences: uniq(summary?.exercise?.preferences ?? []),
    },
    subAccounts: patient.subAccounts.map((s) => ({
      id: s.id,
      name: [s.firstName, s.lastName].filter(Boolean).join(" ") || "unnamed",
      age: s.dob ? calculateAgeFromDob(s.dob) : null,
    })),
    memories: memories.map((m) => ({ id: m.id, category: m.category, content: m.content })),
    client,
  };
}

/* ======================================================================= */
/*  Rendering — the compact text block that goes into the system prompt.   */
/* ======================================================================= */

const fmt = (n: number | null | undefined, unit = "") =>
  n === null || n === undefined ? "—" : `${n}${unit}`;

const targetLine = (t: SnapshotTarget) => {
  const range =
    t.min !== null && t.max !== null
      ? `${t.min}–${t.max}`
      : t.min !== null
      ? `≥${t.min}`
      : t.max !== null
      ? `≤${t.max}`
      : "?";
  return `${t.metricKey} ${range} ${t.unit}/${t.cadence === "DAILY" ? "day" : "week"}`;
};

const list = (xs: string[], max = 8) =>
  xs.length ? xs.slice(0, max).join(", ") + (xs.length > max ? ` (+${xs.length - max})` : "") : "none on record";

/** Human-readable snapshot, ~40 lines, stable ordering for prompt caching. */
export function renderSnapshot(s: PatientSnapshot): string {
  const L: string[] = [];
  const p = s.profile;
  L.push(`# Patient snapshot (${s.today}, ${s.timeZone})`);
  L.push(
    `profile: ${p.firstName ?? "—"}, ${fmt(p.age)}y ${p.gender ?? ""}`.trim() +
      `; height ${p.height ? `${p.height.value} ${p.height.unit}` : "—"}, weight on file ${p.weight ? `${p.weight.value} ${p.weight.unit}` : "—"}` +
      `; activity ${p.activityLevel ?? "—"}; smoking ${p.smoking ?? "—"}; alcohol ${p.alcohol ?? "—"}; caffeine ${p.caffeine ?? "—"}`
  );

  if (s.plan) {
    const pl = s.plan;
    const om = pl.outcomeMetric;
    L.push(
      `plan: ${pl.outcome} · ${pl.intensity} · week ${pl.weekNumber} (since ${pl.startedAt})` +
        (om && om.metric ? ` · ${om.metric} ${fmt(om.start)} → ${fmt(om.target)} ${om.unit ?? ""}` : "")
    );
    const byPillar: Record<string, string[]> = {};
    for (const t of pl.targets) (byPillar[t.pillar] ??= []).push(targetLine(t));
    for (const pillar of ["NUTRITION", "EXERCISE", "SLEEP"])
      if (byPillar[pillar]) L.push(`  ${pillar.toLowerCase()}: ${byPillar[pillar].join("; ")}`);
    if (pl.watchOuts.length)
      L.push(
        `  watch-outs: ` +
          pl.watchOuts
            .map((w) => `${w.nutrientKey} ${w.level}${w.limit !== null ? ` ≤${w.limit}${w.unit ?? ""}` : ""}${w.reason ? ` (${w.reason})` : ""}`)
            .join("; ")
      );
  } else {
    L.push("plan: none active (offer to set one up via the Plan screen)");
  }

  const t = s.today_log;
  L.push(
    `today: ${fmt(t.calories, " kcal")} logged (P${fmt(t.protein_g)} C${fmt(t.carbs_g)} F${fmt(t.fat_g)}, fiber ${fmt(t.fiber_g)}g, sodium ${fmt(t.sodium_mg)}mg, added sugar ${fmt(t.addedSugar_g)}g)` +
      `; exercise ${fmt(t.exerciseMinutes, " min")}` +
      (s.client?.stepsToday !== undefined ? `; steps ${s.client.stepsToday}` : "") +
      (s.client?.sleepMinutesLastNight !== undefined
        ? `; slept ${Math.floor(s.client.sleepMinutesLastNight / 60)}h${String(s.client.sleepMinutesLastNight % 60).padStart(2, "0")}`
        : "")
  );
  if (t.meals.length)
    L.push(`  meals: ` + t.meals.map((m) => `${(m.mealType ?? "meal").toLowerCase()} — ${m.description} (${m.calories} kcal)`).join("; "));
  else L.push("  meals: nothing logged yet today");

  const w = s.week;
  L.push(
    `this week (${w.start}→${w.end}): ${w.daysLogged}/7 days logged, avg ${fmt(w.avgCalories, " kcal")}, avg protein ${fmt(w.avgProtein_g, "g")}` +
      `; ${w.exerciseSessions} exercise sessions (${w.exerciseMinutes} min)` +
      (s.client?.weekSleepAvgMinutes !== undefined ? `; sleep avg ${(s.client.weekSleepAvgMinutes / 60).toFixed(1)}h` : "")
  );

  const v = s.vitals;
  L.push(
    `vitals: weight ${v.weight ? `${v.weight.value} ${v.weight.unit} (${v.weight.at}${v.weight.change30d !== null ? `, ${v.weight.change30d > 0 ? "+" : ""}${v.weight.change30d} vs 30d ago` : ""})` : "—"}` +
      `; body fat ${v.bfp ? `${v.bfp.value}% (${v.bfp.at})` : "—"}` +
      `; BP ${v.bloodPressure ? `${v.bloodPressure.systolic}/${v.bloodPressure.diastolic} (avg of ${v.bloodPressure.readings}, ${v.bloodPressure.at})` : "—"}` +
      `; glucose ${v.glucose ? `${v.glucose.value} (${v.glucose.at})` : "—"}` +
      (s.client?.restingHeartRate !== undefined ? `; resting HR ${s.client.restingHeartRate}` : "") +
      (s.client?.hrvMs !== undefined ? `; HRV ${s.client.hrvMs}ms` : "")
  );

  if (s.labs.totalBiomarkers === 0) L.push("labs: none uploaded");
  else {
    L.push(`labs: ${s.labs.totalBiomarkers} biomarkers on file, latest ${s.labs.latestCollectedAt}; ${s.labs.flagged.length} outside the lab's reference range:`);
    for (const b of s.labs.flagged)
      L.push(`  - ${b.testType}: ${b.result} ${b.units ?? ""} (ref ${b.referenceRange}; ${b.collectedAt}, ${b.freshness})`);
  }

  const r = s.records;
  L.push(`on record: conditions — ${list(r.conditions)}; allergies — ${list(r.allergies)}; medications — ${r.medications.length ? r.medications.map((m) => `${m.name} ${m.dosage}`.trim()).join(", ") : "none on record"}`);

  const n = s.nutrition;
  L.push(
    `food: diet ${list(n.dietaryPreferences)}; food allergies ${list(n.foodAllergies)}; intolerances ${list(n.intolerances)}` +
      `; likes ${list(n.likes, 6)}; dislikes ${list(n.dislikes, 6)}; avoid ${list(n.avoid, 6)}; increase ${list(n.increase, 6)}` +
      `; supplements ${n.supplements.length ? n.supplements.map((x) => `${x.name} ${x.quantity}`.trim()).join(", ") : "none"}`
  );
  L.push(`exercise prefs: ${s.exercise.frequency ?? "—"}; ${list(s.exercise.preferences, 6)}`);

  if (s.subAccounts.length)
    L.push(`sub-accounts: ` + s.subAccounts.map((a) => `${a.name}${a.age !== null ? ` (${a.age})` : ""}`).join(", "));

  if (s.memories.length) {
    L.push("remembered about this person:");
    for (const m of s.memories) L.push(`  - [${m.category.toLowerCase()}] ${m.content}`);
  }
  return L.join("\n");
}
