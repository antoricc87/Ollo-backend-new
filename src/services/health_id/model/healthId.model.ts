import prisma from "../../../utility/prismaClient";
import { calculateAgeFromDob } from "../../../utils/calculateAgefromDob";
import {
  applyEdits,
  parseStory,
  renderForAgent,
  renderHealthId,
  type Author,
  type HealthFacts,
  type SectionEdit,
  type Story,
} from "../domain/healthId";

const MAX_SOURCES = 20;
const MAX_CHANGES = 30;
const MAX_SOURCE_CHARS = 8000;

const str = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
const uniq = (xs: (string | null | undefined)[]) =>
  Array.from(new Set(xs.filter((x): x is string => !!x && x.trim().length > 0).map((x) => x.trim())));
const heightUnit = (u: string | null | undefined) => (!u || u === "metric" ? "cm" : u === "imperial" ? "in" : u);
const weightUnit = (u: string | null | undefined) => (!u || u === "metric" ? "kg" : u === "imperial" ? "lb" : u);

const FAMILY_FLAGS: [string, string][] = [
  ["historyOfHeartAttack", "heart attack"],
  ["historyOfStroke", "stroke"],
  ["historyOfHighCholesterol", "high cholesterol"],
  ["historyOfHighTriglyceride", "high triglycerides"],
  ["historyOfKidneyDisease", "kidney disease"],
  ["historyOfRespiratoryConditions", "respiratory conditions"],
  ["historyOfDementiaOrAlzheimer", "dementia or Alzheimer's"],
];
const FAMILY_LISTS = [
  "historyOfCancer",
  "historyOfChronicConditions",
  "historyOfMentalHealth",
  "historyOfHereditaryConditions",
  "historyOfAutoimmuneConditions",
];

/** The facts layer, read from the record (never from the HealthId row). */
export async function loadFacts(patientId: string): Promise<HealthFacts | null> {
  const p = await prisma.patient.findUnique({
    where: { id: patientId },
    select: {
      dob: true,
      gender: true,
      lastPhysicalStatus: true,
      lastPhysicalAt: true,
      patientSummary: {
        select: {
          vitals: true,
          exercise: { select: { frequency: true } },
          familyHistory: true,
          conditions: { include: { condition: true } },
          allergies: { include: { allergy: true } },
          medications: { include: { medication: true } },
        },
      },
    },
  });
  if (!p) return null;
  const s = p.patientSummary;
  const v = s?.vitals;
  const fh = s?.familyHistory as Record<string, any> | null | undefined;
  const family = fh
    ? uniq([
        ...FAMILY_LISTS.flatMap((k) => (Array.isArray(fh[k]) ? fh[k] : [])),
        ...FAMILY_FLAGS.filter(([k]) => fh[k] === true).map(([, label]) => label),
      ])
    : [];
  return {
    age: p.dob ? calculateAgeFromDob(p.dob) : null,
    sex: str(p.gender),
    height: v?.height ? { value: v.height, unit: heightUnit(v.height_unit) } : null,
    weight: v?.weight ? { value: v.weight, unit: weightUnit(v.weight_unit) } : null,
    conditions: uniq((s?.conditions ?? []).map((c) => c.condition?.name)),
    medications: uniq(
      (s?.medications ?? []).map((m) => (m.medication ? `${m.medication.name} ${m.medication.dosage ?? ""}` : null))
    ),
    allergies: uniq((s?.allergies ?? []).map((a) => a.allergy?.substance)),
    smoking: str(v?.smokingHabit) ?? (v?.isSmoker === true ? "smoker" : null),
    alcohol: str(v?.alcoholConsumption),
    activity: str(s?.exercise?.frequency) ?? str(v?.activityLevel),
    lastPhysical: p.lastPhysicalStatus
      ? { status: p.lastPhysicalStatus, at: p.lastPhysicalAt ? p.lastPhysicalAt.toISOString() : null }
      : null,
    familyHistory: family,
  };
}

const ensureRow = (patientId: string) =>
  prisma.healthId.upsert({ where: { patientId }, create: { patientId }, update: {} });

export default class HealthIdService {
  /** What the app shows: the summary (facts + story), their words, the history. */
  static async get(patientId: string) {
    const [facts, row] = await Promise.all([
      loadFacts(patientId),
      prisma.healthId.findUnique({
        where: { patientId },
        include: {
          sources: { orderBy: { createdAt: "desc" }, take: MAX_SOURCES },
          changes: { orderBy: { createdAt: "desc" }, take: MAX_CHANGES },
        },
      }),
    ]);
    if (!facts) return null;
    const render = renderHealthId(facts, parseStory(row?.story));
    return {
      ...render,
      version: row?.version ?? 0,
      sources: (row?.sources ?? []).map((s) => ({ id: s.id, kind: s.kind, text: s.text, createdAt: s.createdAt })),
      changes: (row?.changes ?? []).map((c) => ({
        id: c.id,
        version: c.version,
        by: c.by,
        section: c.section,
        before: c.before,
        after: c.after,
        reason: c.reason,
        undone: !!c.undoneAt,
        createdAt: c.createdAt,
      })),
    };
  }

  /** The block for Ollie's snapshot; null when nothing is known yet. */
  static async forAgent(patientId: string): Promise<string | null> {
    const [facts, row] = await Promise.all([
      loadFacts(patientId),
      prisma.healthId.findUnique({ where: { patientId }, select: { story: true } }),
    ]);
    if (!facts) return null;
    return renderForAgent(renderHealthId(facts, parseStory(row?.story)));
  }

  /** Writes story sections as one version. Ollie's edits to sections the person wrote last come back `held`. */
  static async edit(
    patientId: string,
    edits: SectionEdit[],
    by: Author,
    opts: { sourceId?: string | null } = {}
  ) {
    return prisma.$transaction(async (tx) => {
      const row = await tx.healthId.upsert({ where: { patientId }, create: { patientId }, update: {} });
      const { story, changes, held } = applyEdits(parseStory(row.story), edits, by, new Date());
      if (!changes.length) return { version: row.version, changes, held };
      const version = row.version + 1;
      await tx.healthId.update({ where: { id: row.id }, data: { story: story as Story as any, version } });
      await tx.healthIdChange.createMany({
        data: changes.map((c) => ({
          healthIdId: row.id,
          version,
          by,
          section: c.section,
          before: c.before,
          after: c.after,
          reason: c.reason,
          sourceId: opts.sourceId ?? null,
        })),
      });
      return { version, changes, held };
    });
  }

  /** Keeps their words verbatim (onboarding, record again, typed). */
  static async addSource(patientId: string, kind: "onboarding" | "record_again" | "typed", text: string) {
    const row = await ensureRow(patientId);
    return prisma.healthIdSource.create({
      data: { healthIdId: row.id, kind, text: text.trim().slice(0, MAX_SOURCE_CHARS) },
    });
  }

  /** Start from scratch: the story, their words and the history all go. The record (facts) stays. */
  static async reset(patientId: string) {
    await prisma.healthId.deleteMany({ where: { patientId } });
  }
}
