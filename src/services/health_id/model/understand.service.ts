/**
 * Spoken onboarding (H1): their words → a draft to check → the record + the
 * story. Nothing reaches the record until the person confirms the draft.
 * The one model call goes through the shared layer (llm/policy.ts task
 * "extract", escalation on a failed check).
 */
import prisma from "../../../utility/prismaClient";
import { getLLM } from "../../agent/llm/openai.client";
import { dayKey, safeTz } from "../../agent/memory/dates";
import { createPatientSummary, updatePatientSummarySection } from "../../patient/model/patient.model";
import { calculateTDEE } from "../../../utils/calculateTDEE";
import { ensureTargets } from "../../targets/targets.model";
import { calculateAgeFromDob } from "../../../utils/calculateAgefromDob";
import HealthIdService from "./healthId.model";
import { parseStory, SECTION_KEYS, type SectionEdit } from "../domain/healthId";
import {
  checkStory,
  draftOf,
  familyPayload,
  missingFacts,
  normalizeFacts,
  normalizeStory,
  systemPrompt,
  UNDERSTAND_SCHEMA,
  unionNames,
  userPrompt,
  type Heard,
  type HeardFacts,
  type Known,
  type RequiredFact,
  type StoryDraft,
} from "../domain/understand";

export type SourceKind = "onboarding" | "record_again" | "typed";

const todayFor = async (patientId: string) => {
  const p = await prisma.patient.findUnique({ where: { id: patientId }, select: { timeZone: true } });
  return dayKey(safeTz(p?.timeZone));
};

/** Which required facts the record already holds. */
export async function knownFacts(patientId: string): Promise<Known> {
  const p = await prisma.patient.findUnique({
    where: { id: patientId },
    select: { dob: true, gender: true, patientSummary: { select: { vitals: { select: { height: true, weight: true } } } } },
  });
  const v = p?.patientSummary?.vitals;
  return { birthDate: !!p?.dob, sex: !!p?.gender?.trim(), height: !!v?.height, weight: !!v?.weight };
}

export async function requiredMissing(patientId: string): Promise<RequiredFact[]> {
  const k = await knownFacts(patientId);
  return (["birthDate", "sex", "height", "weight"] as RequiredFact[]).filter((f) => !k[f]);
}

/**
 * The model call + every check after it, without the database (the eval runs
 * this directly). `currentFacts` / `currentStory` = what is already there.
 */
export async function readWords(input: {
  words: string;
  today: string;
  currentFacts?: HeardFacts | null;
  currentStory?: StoryDraft;
  model?: string;
}): Promise<{ facts: HeardFacts; story: StoryDraft }> {
  const currentStory = input.currentStory ?? {};
  const currentFacts = input.currentFacts ?? null;
  const raw = await getLLM().json<any>({
    system: systemPrompt(),
    user: userPrompt({ words: input.words, today: input.today, facts: currentFacts, story: currentStory }),
    schema: UNDERSTAND_SCHEMA as unknown as Record<string, unknown>,
    schemaName: "health_id_understand",
    task: "extract",
    ...(input.model ? { model: input.model } : {}),
    accept: (v) => checkStory(normalizeStory(v?.story), currentStory),
  });

  const facts = normalizeFacts(raw?.facts, input.today);
  // A model that dropped earlier facts on a re-tell: the screen's facts stay.
  if (currentFacts)
    for (const k of Object.keys(facts) as (keyof HeardFacts)[]) {
      const v = facts[k] as unknown;
      if (v === null || (Array.isArray(v) && v.length === 0)) (facts as any)[k] = currentFacts[k];
    }
  const story = normalizeStory(raw?.story);
  // Last guard after the shared layer's escalation: a section that lost what
  // was there, or slipped into the first person, keeps the text it had.
  for (const k of SECTION_KEYS) {
    if (checkStory({ [k]: story[k] }, { [k]: currentStory[k] }) !== true) {
      if (currentStory[k]) story[k] = currentStory[k];
      else delete story[k];
    }
  }
  return { facts, story };
}

/**
 * Their words → a draft. `draft` = what the screen already shows (they are
 * adding more); without it, the story starts from what is saved.
 */
export async function understandWords(
  patientId: string,
  input: { words: string; kind: SourceKind; draft?: { facts?: HeardFacts | null; story?: StoryDraft | null } | null }
): Promise<{ sourceId: string; heard: Heard }> {
  const [today, row, known] = await Promise.all([
    todayFor(patientId),
    prisma.healthId.findUnique({ where: { patientId }, select: { story: true } }),
    knownFacts(patientId),
  ]);
  const currentStory = input.draft?.story ?? draftOf(parseStory(row?.story));
  const currentFacts = input.draft?.facts ? normalizeFacts(input.draft.facts, today) : null;
  const source = await HealthIdService.addSource(patientId, input.kind, input.words);
  const { facts, story } = await readWords({ words: input.words, today, currentFacts, currentStory });
  return { sourceId: source.id, heard: { facts, story, missing: missingFacts(facts, known) } };
}

/** The app's units, as the tap screens store them. */
const heightUnit = (u: "cm" | "in") => (u === "cm" ? "metric" : "imperial");
const weightUnit = (u: "kg" | "lb") => (u === "kg" ? "kg" : "lbs");

/**
 * The person confirmed the draft: facts into the SAME record tables the tap
 * screens write (lists are ADDED to, never replaced), the story into the
 * Health ID as one version.
 */
export async function confirmHeard(
  patientId: string,
  input: { facts: HeardFacts; story: StoryDraft; sourceId?: string | null }
) {
  const today = await todayFor(patientId);
  const f = normalizeFacts(input.facts, today);
  const story = normalizeStory(input.story);

  let summary = await prisma.patientSummary.findUnique({
    where: { patientId },
    include: {
      vitals: true,
      exercise: true,
      familyHistory: true,
      conditions: { include: { condition: true } },
      medications: { include: { medication: true } },
      allergies: { include: { allergy: true } },
    },
  });
  if (!summary) {
    await createPatientSummary(patientId);
    summary = await prisma.patientSummary.findUnique({
      where: { patientId },
      include: {
        vitals: true,
        exercise: true,
        familyHistory: true,
        conditions: { include: { condition: true } },
        medications: { include: { medication: true } },
        allergies: { include: { allergy: true } },
      },
    });
  }

  // Patient row: birth date, sex, last physical.
  const patientData: Record<string, unknown> = {};
  if (f.firstName) patientData.firstName = f.firstName;
  if (f.lastName) patientData.lastName = f.lastName;
  if (f.birthDate) patientData.dob = new Date(`${f.birthDate}T00:00:00Z`);
  if (f.sex) patientData.gender = f.sex;
  if (f.lastPhysical) {
    patientData.lastPhysicalStatus = f.lastPhysical.status;
    patientData.lastPhysicalAt = f.lastPhysical.month ? new Date(`${f.lastPhysical.month}-01T00:00:00Z`) : null;
  }
  if (Object.keys(patientData).length) await prisma.patient.update({ where: { id: patientId }, data: patientData });

  // Vitals: a new row needs height AND weight (the table requires both).
  const vitals: Record<string, unknown> = {};
  if (f.height) Object.assign(vitals, { height: f.height.value, height_unit: heightUnit(f.height.unit) });
  if (f.weight) Object.assign(vitals, { weight: f.weight.value, weight_unit: weightUnit(f.weight.unit) });
  if (f.smoking) Object.assign(vitals, { smokingHabit: f.smoking, isSmoker: f.smoking === "Occasionally" || f.smoking === "Daily" });
  if (f.alcohol) vitals.alcoholConsumption = f.alcohol;
  if (f.caffeine) vitals.caffeine = f.caffeine;
  if (f.activity) vitals.activityLevel = f.activity;
  const canWriteVitals = !!summary?.vitals || (vitals.height !== undefined && vitals.weight !== undefined);
  // Said out loud, never silently dropped: what had to wait for height + weight comes back by name.
  const notSaved: string[] = [];
  if (Object.keys(vitals).length && canWriteVitals) await updatePatientSummarySection(patientId, "vitals", [vitals]);
  else if (Object.keys(vitals).length)
    notSaved.push(...(["height", "weight", "smoking", "alcohol", "caffeine"] as const).filter((k) => (f as any)[k]));

  if (f.activity)
    await updatePatientSummarySection(patientId, "exercise", [
      { frequency: f.activity, preferences: summary?.exercise?.preferences ?? [] },
    ]);

  // Lists: ADD to what is on record. The section writer replaces the whole
  // list, so the existing entries go back in with it.
  if (f.conditions.length) {
    const existing = (summary?.conditions ?? []).map((c) => c.condition?.name).filter(Boolean) as string[];
    const names = unionNames(existing, f.conditions);
    if (names.length > existing.length)
      await updatePatientSummarySection(
        patientId,
        "conditions",
        names.map((name) => ({ name, clinicalStatus: "active", verificationStatus: "unconfirmed", onset: "" }))
      );
  }
  if (f.medications.length) {
    const existing = (summary?.medications ?? []).filter((m) => m.medication).map((m) => ({ name: m.medication.name, dosage: m.medication.dosage ?? "" }));
    const have = new Set(existing.map((m) => m.name.toLowerCase()));
    const added = f.medications.filter((m) => !have.has(m.name.toLowerCase()));
    if (added.length)
      await updatePatientSummarySection(
        patientId,
        "medications",
        // The dose goes in the name: Medication rows are shared by name across
        // patients, so a separate dosage column would show someone else's dose.
        [...existing, ...added.map((m) => ({ name: m.dosage ? `${m.name} ${m.dosage}` : m.name, dosage: "" }))].map((m) => ({ ...m, status: "active" }))
      );
  }
  if (f.allergies.length) {
    const existing = (summary?.allergies ?? []).map((a) => a.allergy?.substance).filter(Boolean) as string[];
    const names = unionNames(existing, f.allergies);
    if (names.length > existing.length)
      await updatePatientSummarySection(patientId, "allergies", names.map((substance) => ({ substance, status: "active", reactions: [] })));
  }
  if (f.familyHistory.length)
    await updatePatientSummarySection(patientId, "family_history", [familyPayload(summary?.familyHistory as any, f.familyHistory)]);

  // Story: one version; sections they did not touch stay as they are (adding).
  const edits: SectionEdit[] = SECTION_KEYS.filter((k) => story[k]).map((k) => ({ key: k, text: story[k]! }));
  if (edits.length) await HealthIdService.edit(patientId, edits, "onboarding", { sourceId: input.sourceId ?? null });

  return { healthId: await HealthIdService.get(patientId), missing: await requiredMissing(patientId), notSaved };
}

/**
 * Onboarding is complete only with the required facts on record (server-side
 * since Nov 11 2026; the phone used to be the only check). Writes a starting
 * calorie target when none exists.
 */
export async function completeOnboarding(patientId: string): Promise<{ ok: true } | { ok: false; missing: RequiredFact[] }> {
  const missing = await requiredMissing(patientId);
  if (missing.length) return { ok: false, missing };
  const p = await prisma.patient.findUnique({
    where: { id: patientId },
    select: { dob: true, gender: true, patientSummary: { select: { id: true, caloricAmount: true, vitals: true, exercise: true } } },
  });
  const s = p?.patientSummary;
  if (s && !s.caloricAmount && s.vitals && p?.dob) {
    const kg = s.vitals.weight_unit === "lbs" || s.vitals.weight_unit === "lb" || s.vitals.weight_unit === "imperial" ? s.vitals.weight * 0.4536 : s.vitals.weight;
    const cm = s.vitals.height_unit === "imperial" || s.vitals.height_unit === "in" ? s.vitals.height * 2.54 : s.vitals.height;
    const tdee = calculateTDEE(kg, cm, calculateAgeFromDob(p.dob), p.gender, s.exercise?.frequency);
    if (isFinite(tdee) && tdee >= 800) await prisma.patientSummary.update({ where: { id: s.id }, data: { caloricAmount: Math.round(tdee / 50) * 50 } });
  }
  await prisma.patient.update({ where: { id: patientId }, data: { onBoardingComplete: true, lastSectionCompleted: "complete" } });
  // Their targets exist by now (Ollie set them on the targets step); make sure for any path that skipped it.
  await ensureTargets(patientId).catch((e) => console.error("targets at onboarding", e));
  return { ok: true };
}
