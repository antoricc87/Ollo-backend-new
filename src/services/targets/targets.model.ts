import prisma from "../../utility/prismaClient";
import { calculateTDEE } from "../../utils/calculateTDEE";
import { calculateAgeFromDob } from "../../utils/calculateAgefromDob";
import HealthIdService from "../health_id/model/healthId.model";
import { adjustTargets } from "./adjust.service";
import { computeTargets, inBounds, resolveTarget, TARGET_KEYS, whyOf, type TargetFrom, type TargetKey, type Targets } from "./domain/targets";

/**
 * Profile targets, saved (Nov 22 2026).
 *
 * THE HYBRID (his ruling, persona eval 28/28): code computes the starting
 * numbers from the profile, Ollie adjusts them from the Health ID with a
 * reason each, code checks them (domain/adjust.ts). It runs when onboarding
 * reaches the targets step (`setup`) and when the person asks Ollie to set them
 * again (`redo`) — never on an ordinary read: an account that finished
 * onboarding before this existed gets the formula's numbers until it asks.
 *
 * A value the person changed is theirs: never recomputed, never adjusted.
 * Calories stay in PatientSummary.caloricAmount, which the nutrition screens read.
 */

const PLAN_METRIC: Record<TargetKey, string> = {
  calories: "calories",
  proteinG: "protein_g",
  sleepMinutes: "sleep_minutes",
  sessionsPerWeek: "exercise_sessions",
  activeMinutesWeek: "active_minutes",
};

const LABEL: Record<TargetKey, { label: string; unit: string }> = {
  calories: { label: "Calories", unit: "kcal a day" },
  proteinG: { label: "Protein", unit: "g a day" },
  sleepMinutes: { label: "Sleep", unit: "a night" },
  sessionsPerWeek: { label: "Workouts", unit: "a week" },
  activeMinutesWeek: { label: "Active minutes", unit: "min a week" },
};

const kgOf = (v: { weight: number; weight_unit: string | null } | null | undefined) =>
  !v?.weight ? null : ["lbs", "lb", "imperial"].includes((v.weight_unit ?? "").toLowerCase()) ? v.weight * 0.4536 : v.weight;
const cmOf = (v: { height: number; height_unit: string | null } | null | undefined) =>
  !v?.height ? null : ["imperial", "in"].includes((v.height_unit ?? "").toLowerCase()) ? v.height * 2.54 : v.height;

type Profile = { base: Targets; summaryId: string | null; caloriesOnRecord: number | null; kg: number | null; cm: number | null; facts: string };

/** The profile and the formula's numbers from it (energy always from the formula, not from a target on record). */
async function profileOf(patientId: string): Promise<Profile> {
  const p = await prisma.patient.findUnique({
    where: { id: patientId },
    select: {
      dob: true,
      gender: true,
      trainingProfile: { select: { preferredDays: true } },
      patientSummary: { select: { id: true, caloricAmount: true, vitals: true, exercise: true } },
    },
  });
  const s = p?.patientSummary;
  const kg = kgOf(s?.vitals as any);
  const cm = cmOf(s?.vitals as any);
  const age = p?.dob ? calculateAgeFromDob(p.dob) : null;
  const tdee = kg && cm && age !== null ? calculateTDEE(kg, cm, age, p?.gender, s?.exercise?.frequency) : NaN;
  const base = computeTargets({
    weightKg: kg,
    calories: isFinite(tdee) ? tdee : s?.caloricAmount ?? null,
    trainingDays: p?.trainingProfile?.preferredDays?.length ?? null,
    exerciseFrequency: s?.exercise?.frequency ?? null,
  });
  const facts = [
    age !== null ? `${age} years old` : null,
    p?.gender ? String(p.gender).toLowerCase() : null,
    cm ? `${Math.round(cm)} cm` : null,
    kg ? `${Math.round(kg)} kg` : null,
    s?.exercise?.frequency ? `activity: ${s.exercise.frequency}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  return { base, summaryId: s?.id ?? null, caloriesOnRecord: s?.caloricAmount ?? null, kg, cm, facts };
}

const baseWhyOf = (t: Targets) => Object.fromEntries(TARGET_KEYS.map((k) => [k, whyOf(k, t)])) as Record<TargetKey, string>;

/**
 * Make sure the targets exist.
 *   (default)  create from the formula when missing; otherwise leave them
 *   adjust     Ollie adjusts the ones they never changed (setup, redo)
 */
export async function ensureTargets(patientId: string, opts: { adjust?: boolean } = {}) {
  const existing = await prisma.profileTargets.findUnique({ where: { patientId } });
  if (existing && !opts.adjust) return existing;

  const prof = await profileOf(patientId);
  let values: Targets = prof.base;
  let reasons: Record<TargetKey, string> = baseWhyOf(prof.base);
  let adjusted = false;
  if (opts.adjust) {
    const healthId = await HealthIdService.forAgent(patientId).catch(() => null);
    const r = await adjustTargets({ base: prof.base, baseWhy: reasons, facts: prof.facts, healthId, weightKg: prof.kg, heightCm: prof.cm });
    if (!r.error) {
      values = r.targets;
      reasons = r.why;
      adjusted = true;
    } else console.error("targets adjust failed — formula numbers stand", r.error);
  }

  const edited = new Set(existing?.edited ?? []);
  const oldReasons = (existing?.reasons ?? {}) as Record<string, string>;
  const pick = <K extends Exclude<TargetKey, "calories">>(k: K) => (edited.has(k) && existing ? existing[k] : values[k]);
  const keptReasons = Object.fromEntries(TARGET_KEYS.map((k) => [k, edited.has(k) ? oldReasons[k] ?? "You set this" : reasons[k]]));
  const data = {
    proteinG: pick("proteinG"),
    sleepMinutes: pick("sleepMinutes"),
    sessionsPerWeek: pick("sessionsPerWeek"),
    activeMinutesWeek: pick("activeMinutesWeek"),
    reasons: keptReasons,
    computedAt: new Date(),
    ...(adjusted ? { adjustedAt: new Date() } : {}),
  };
  // Calories live where nutrition reads them: written when Ollie set them, or when there was none.
  if (prof.summaryId && values.calories && !edited.has("calories") && (adjusted || !prof.caloriesOnRecord))
    await prisma.patientSummary.update({ where: { id: prof.summaryId }, data: { caloricAmount: values.calories } });
  return prisma.profileTargets.upsert({ where: { patientId }, create: { patientId, ...data }, update: data });
}

export type TargetView = { key: TargetKey; label: string; unit: string; value: number | null; min: number | null; max: number | null; from: TargetFrom; why: string };
export type TargetsOut = { targets: TargetView[]; planActive: boolean; setByOllie: boolean };

/** Every target as the app shows it, with the plan's winning while one is active. `setup`: the onboarding step — Ollie sets them once. */
export async function targetsFor(patientId: string, opts: { setup?: boolean } = {}): Promise<TargetsOut> {
  let row = await ensureTargets(patientId);
  if (opts.setup && !row.adjustedAt) row = await ensureTargets(patientId, { adjust: true });
  const [summary, plan] = await Promise.all([
    prisma.patientSummary.findFirst({ where: { patientId }, select: { caloricAmount: true } }),
    prisma.healthPlan.findFirst({ where: { patientId, status: "ACTIVE" }, include: { targets: true }, orderBy: { createdAt: "desc" } }),
  ]);
  const profile: Targets = {
    calories: summary?.caloricAmount ?? null,
    proteinG: row.proteinG,
    sleepMinutes: row.sleepMinutes,
    sessionsPerWeek: row.sessionsPerWeek,
    activeMinutesWeek: row.activeMinutesWeek,
  };
  const reasons = (row.reasons ?? {}) as Record<string, string>;
  const targets = TARGET_KEYS.map((key): TargetView => {
    const pt = plan?.targets.find((t) => t.metricKey === PLAN_METRIC[key]);
    const planValue = pt ? pt.min ?? pt.max : null;
    const r = resolveTarget(planValue, profile[key], row.edited.includes(key));
    return {
      key,
      ...LABEL[key],
      value: r.value,
      min: r.from === "plan" ? pt?.min ?? null : r.value,
      max: r.from === "plan" ? pt?.max ?? null : key === "calories" ? r.value : null,
      from: r.from,
      why: r.from === "plan" ? "From your current plan" : r.from === "you" ? "You set this" : reasons[key] ?? whyOf(key, profile),
    };
  });
  return { targets, planActive: !!plan, setByOllie: !!row.adjustedAt };
}

/** Ollie sets them again from the profile and Health ID (their own values stay). */
export async function redoTargets(patientId: string) {
  await ensureTargets(patientId, { adjust: true });
  return targetsFor(patientId);
}

/** They change one. Returns the new view, or null for a key or value out of bounds. */
export async function setTarget(patientId: string, key: string, value: number) {
  if (!(TARGET_KEYS as readonly string[]).includes(key)) return null;
  const k = key as TargetKey;
  if (!inBounds(k, value)) return null;
  const row = await ensureTargets(patientId);
  const v = Math.round(value);
  if (k === "calories") {
    const s = await prisma.patientSummary.findFirst({ where: { patientId }, select: { id: true } });
    if (!s) return null;
    await prisma.patientSummary.update({ where: { id: s.id }, data: { caloricAmount: v } });
  }
  await prisma.profileTargets.update({
    where: { patientId },
    data: { ...(k === "calories" ? {} : { [k]: v }), edited: [...new Set([...row.edited, k])] },
  });
  return targetsFor(patientId);
}

/** Back to the formula's value for one key (Ollie's adjustment comes back with "Set them again"). */
export async function resetTarget(patientId: string, key: string) {
  if (!(TARGET_KEYS as readonly string[]).includes(key)) return null;
  const k = key as TargetKey;
  const row = await ensureTargets(patientId);
  const prof = await profileOf(patientId);
  if (k === "calories" && prof.summaryId && prof.base.calories)
    await prisma.patientSummary.update({ where: { id: prof.summaryId }, data: { caloricAmount: prof.base.calories } });
  const reasons = { ...((row.reasons ?? {}) as Record<string, string>), [k]: whyOf(k, prof.base) };
  await prisma.profileTargets.update({
    where: { patientId },
    data: { ...(k === "calories" ? {} : { [k]: prof.base[k] }), edited: row.edited.filter((e) => e !== k), reasons },
  });
  return targetsFor(patientId);
}

/** The week review's targets: the plan's ranges while active, else the profile's. */
export async function reviewTargets(patientId: string) {
  const { targets } = await targetsFor(patientId);
  const t = (k: TargetKey) => targets.find((x) => x.key === k)!;
  const range = (k: TargetKey) => (t(k).min !== null || t(k).max !== null ? { min: t(k).min, max: t(k).max } : null);
  return {
    calories: range("calories"),
    proteinG: t("proteinG").value !== null ? { min: t("proteinG").min, max: t("proteinG").from === "plan" ? t("proteinG").max : null } : null,
    sleepMinutes: t("sleepMinutes").value,
    sessionsPerWeek: t("sessionsPerWeek").value,
  };
}
