/**
 * Their words → facts + story (H1 of ../docs/onboarding-health-id-plan.md).
 *
 * The model only TRANSCRIBES what was said into a closed shape; this file
 * decides everything else in code: ranges, vocabularies, which facts are
 * still missing, and whether the story kept what was there. Pure — the LLM
 * call lives in model/understand.service.ts and goes through the shared
 * policy (task "extract").
 */
import { SECTION_KEYS, SECTION_LABELS, type SectionKey, type Story } from "./healthId";

/* ------------------------------ Vocabularies ------------------------------ */
// The SAME values the tap screens store, so "Your body", the TDEE and the
// screening engine read a spoken answer exactly like a tapped one.

export const SEX = ["Female", "Male", "Other"] as const;
export const SMOKING = ["Never", "Former smoker", "Occasionally", "Daily"] as const;
export const ALCOHOL = ["Never", "Occasionally", "Moderate", "Regular", "Heavy"] as const;
export const CAFFEINE = ["None", "Light", "Moderate", "Heavy"] as const;
export const ACTIVITY = [
  "Little/no exercise",
  "Light exercise 1-2 times/week",
  "Moderate exercise 2-3 times/week",
  "Hard exercise 3-5 times/week",
  "Hard exercise 6-7 times/week",
] as const;
export const PHYSICAL = ["within_year", "over_year", "never"] as const;
/** The family-history chips of the physical step, by key. */
export const FAMILY = [
  "breastOrOvarianCancer",
  "colorectalCancer",
  "prostateCancer",
  "diabetes",
  "earlyHeartDisease",
  "highCholesterol",
  "osteoporosis",
] as const;

export type FamilyKey = (typeof FAMILY)[number];

/** Required to finish onboarding (ruling Nov 11 2026). */
export const REQUIRED = ["birthDate", "sex", "height", "weight"] as const;
export type RequiredFact = (typeof REQUIRED)[number];

/* --------------------------------- Shapes --------------------------------- */

export type HeardFacts = {
  /** Their name as they said it (the old Set 01 asked it; nothing else does). */
  firstName: string | null;
  lastName: string | null;
  /** YYYY-MM-DD, only when a full date was said. */
  birthDate: string | null;
  /** When only an age was said: shown as a hint, never turned into a date. */
  age: number | null;
  sex: (typeof SEX)[number] | null;
  height: { value: number; unit: "cm" | "in" } | null;
  weight: { value: number; unit: "kg" | "lb" } | null;
  conditions: string[];
  medications: { name: string; dosage: string | null }[];
  allergies: string[];
  smoking: (typeof SMOKING)[number] | null;
  alcohol: (typeof ALCOHOL)[number] | null;
  caffeine: (typeof CAFFEINE)[number] | null;
  activity: (typeof ACTIVITY)[number] | null;
  lastPhysical: { status: (typeof PHYSICAL)[number]; month: string | null } | null;
  familyHistory: FamilyKey[];
};

export type StoryDraft = Partial<Record<SectionKey, string>>;

export type Heard = { facts: HeardFacts; story: StoryDraft; missing: RequiredFact[] };

/** What the record already holds for the required facts (the app's draft wins over it). */
export type Known = Partial<Record<RequiredFact, boolean>>;

export const emptyFacts = (): HeardFacts => ({
  firstName: null,
  lastName: null,
  birthDate: null,
  age: null,
  sex: null,
  height: null,
  weight: null,
  conditions: [],
  medications: [],
  allergies: [],
  smoking: null,
  alcohol: null,
  caffeine: null,
  activity: null,
  lastPhysical: null,
  familyHistory: [],
});

/* ------------------------------ Model schema ------------------------------ */

const nullable = (t: Record<string, unknown>) => ({ anyOf: [t, { type: "null" }] });
const enumOf = (xs: readonly string[]) => nullable({ type: "string", enum: [...xs] });

export const UNDERSTAND_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["facts", "story"],
  properties: {
    facts: {
      type: "object",
      additionalProperties: false,
      required: [
        "firstName", "lastName", "birthDate", "age", "sex", "height", "weight", "conditions", "medications", "allergies",
        "smoking", "alcohol", "caffeine", "activity", "lastPhysical", "familyHistory",
      ],
      properties: {
        firstName: nullable({ type: "string" }),
        lastName: nullable({ type: "string" }),
        birthDate: nullable({ type: "string" }),
        age: nullable({ type: "integer" }),
        sex: enumOf(SEX),
        height: nullable({
          type: "object",
          additionalProperties: false,
          required: ["value", "unit"],
          properties: { value: { type: "number" }, unit: { type: "string", enum: ["cm", "in"] } },
        }),
        weight: nullable({
          type: "object",
          additionalProperties: false,
          required: ["value", "unit"],
          properties: { value: { type: "number" }, unit: { type: "string", enum: ["kg", "lb"] } },
        }),
        conditions: { type: "array", items: { type: "string" } },
        medications: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["name", "dosage"],
            properties: { name: { type: "string" }, dosage: nullable({ type: "string" }) },
          },
        },
        allergies: { type: "array", items: { type: "string" } },
        smoking: enumOf(SMOKING),
        alcohol: enumOf(ALCOHOL),
        caffeine: enumOf(CAFFEINE),
        activity: enumOf(ACTIVITY),
        lastPhysical: nullable({
          type: "object",
          additionalProperties: false,
          required: ["status", "month"],
          properties: { status: { type: "string", enum: [...PHYSICAL] }, month: nullable({ type: "string" }) },
        }),
        familyHistory: { type: "array", items: { type: "string", enum: [...FAMILY] } },
      },
    },
    story: {
      type: "object",
      additionalProperties: false,
      required: [...SECTION_KEYS],
      properties: Object.fromEntries(SECTION_KEYS.map((k) => [k, nullable({ type: "string" })])),
    },
  },
} as const;

/* --------------------------------- Prompt --------------------------------- */

export function systemPrompt(): string {
  return [
    "You turn what a person said about themselves into their Ollo profile. Ollo is a preventive-health app; Ollie is its coach.",
    "",
    "Two parts:",
    "1. facts — copy ONLY what they actually said. Never guess, never fill a gap, never round a range into a number.",
    "   - firstName / lastName: as they introduced themselves (\"I'm Marco Rossi\"), else null.",
    "   - birthDate: YYYY-MM-DD only when they gave a full date. If they only gave an age, put it in age and leave birthDate null.",
    "   - height: cm, or total inches (5'10\" = 70). weight: kg or lb, as they said it.",
    "   - conditions: only conditions they say they HAVE (diagnosed or managed). A worry or a suspicion (\"I think I might have…\") is not a condition — it belongs in the story's worries.",
    "   - medications: only what they take now, with the dose if said. Supplements count.",
    "   - allergies: what they say they're allergic to.",
    "   - smoking/alcohol/caffeine/activity: pick the closest option only when they said something about it.",
    "   - lastPhysical: within_year / over_year / never, with month YYYY-MM when they named one.",
    "   - familyHistory: only these keys, only for blood relatives they named.",
    "2. story — short sections in the THIRD PERSON, plain sentences, built from their words:",
    ...SECTION_KEYS.map((k) => `   - ${k} (${SECTION_LABELS[k]}): ${SECTION_HINT[k]}`),
    "   Keep their specifics (numbers, names, events, dates). One to three sentences per section. null when they said nothing for it.",
    "   Never add a diagnosis, a guess about their health, advice, or praise. Never write \"I\" or \"my\".",
    "",
    "When CURRENT facts or a CURRENT story are given, this is them adding more:",
    "   - facts: return what the new words say; a fact they did not mention again stays as it is (return the current value).",
    "   - story: return the FULL updated text for every section — keep everything already there and add the new detail; change a statement only when they corrected it.",
  ].join("\n");
}

const SECTION_HINT: Record<SectionKey, string> = {
  focus: "what matters most to them about their health right now",
  wants: "what they hope to get from Ollo",
  worries: "what worries them, in their terms",
  constraints: "what limits them: time, money, injuries, family, work, schedule",
  success: "what success would look like for them, and by when if they said",
  coaching: "how they want to be coached (tone, detail, how often)",
};

export function userPrompt(input: { words: string; today: string; facts?: HeardFacts | null; story?: StoryDraft | null }): string {
  const L = [`Today: ${input.today}`];
  if (input.facts) L.push("CURRENT facts:", JSON.stringify(input.facts));
  if (input.story && Object.keys(input.story).length) L.push("CURRENT story:", JSON.stringify(input.story));
  L.push("Their words:", `"""${input.words.trim()}"""`);
  return L.join("\n");
}

/* ------------------------------- Normalising ------------------------------- */

const clean = (s: unknown) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");
const oneOf = <T extends string>(xs: readonly T[], v: unknown): T | null => (xs as readonly string[]).includes(v as string) ? (v as T) : null;
const dedupe = (xs: string[]) => {
  const seen = new Set<string>();
  return xs.filter((x) => {
    const k = x.toLowerCase();
    if (!x || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

const RANGES = {
  cm: [120, 230],
  in: [48, 90],
  kg: [30, 250],
  lb: [66, 550],
} as const;

const inRange = (v: unknown, [lo, hi]: readonly [number, number]) => typeof v === "number" && isFinite(v) && v >= lo && v <= hi;

/** A real calendar date, not in the future, age 13–110. */
export function validBirthDate(s: unknown, today: string): string | null {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return null;
  const t = new Date(`${today}T00:00:00Z`);
  const age = (t.getTime() - d.getTime()) / (365.25 * 24 * 3600 * 1000);
  return age >= 13 && age <= 110 ? s : null;
}

/** Whatever the model returned → facts that fit the record, out-of-range values dropped. */
export function normalizeFacts(raw: any, today: string): HeardFacts {
  const f = emptyFacts();
  if (!raw || typeof raw !== "object") return f;
  const name = (v: unknown) => {
    const t = clean(v);
    return t && t.length <= 60 && /^[\p{L}' .-]+$/u.test(t) ? t : null;
  };
  f.firstName = name(raw.firstName);
  f.lastName = name(raw.lastName);
  f.birthDate = validBirthDate(raw.birthDate, today);
  f.age = Number.isInteger(raw.age) && raw.age >= 13 && raw.age <= 110 ? raw.age : null;
  f.sex = oneOf(SEX, raw.sex);
  if (raw.height && (raw.height.unit === "cm" || raw.height.unit === "in") && inRange(raw.height.value, RANGES[raw.height.unit as "cm" | "in"]))
    f.height = { value: Math.round(raw.height.value * 10) / 10, unit: raw.height.unit };
  if (raw.weight && (raw.weight.unit === "kg" || raw.weight.unit === "lb") && inRange(raw.weight.value, RANGES[raw.weight.unit as "kg" | "lb"]))
    f.weight = { value: Math.round(raw.weight.value * 10) / 10, unit: raw.weight.unit };
  f.conditions = dedupe((Array.isArray(raw.conditions) ? raw.conditions : []).map(clean)).slice(0, 30);
  f.allergies = dedupe((Array.isArray(raw.allergies) ? raw.allergies : []).map(clean)).slice(0, 30);
  const meds = (Array.isArray(raw.medications) ? raw.medications : [])
    .map((m: any) => ({ name: clean(m?.name), dosage: clean(m?.dosage) || null }))
    .filter((m: { name: string }) => m.name);
  const seen = new Set<string>();
  f.medications = meds.filter((m: { name: string }) => !seen.has(m.name.toLowerCase()) && seen.add(m.name.toLowerCase())).slice(0, 30);
  f.smoking = oneOf(SMOKING, raw.smoking);
  f.alcohol = oneOf(ALCOHOL, raw.alcohol);
  f.caffeine = oneOf(CAFFEINE, raw.caffeine);
  f.activity = oneOf(ACTIVITY, raw.activity);
  const status = oneOf(PHYSICAL, raw.lastPhysical?.status);
  if (status) {
    const m = typeof raw.lastPhysical.month === "string" && /^\d{4}-\d{2}$/.test(raw.lastPhysical.month) ? raw.lastPhysical.month : null;
    // A month only means something for "within the last year", and never in the future.
    f.lastPhysical = { status, month: status === "within_year" && m && m <= today.slice(0, 7) ? m : null };
  }
  f.familyHistory = Array.from(new Set((Array.isArray(raw.familyHistory) ? raw.familyHistory : []).filter((k: unknown) => oneOf(FAMILY, k)))) as FamilyKey[];
  return f;
}

export function normalizeStory(raw: any): StoryDraft {
  const out: StoryDraft = {};
  if (!raw || typeof raw !== "object") return out;
  for (const k of SECTION_KEYS) {
    const t = clean(raw[k]).slice(0, 600);
    if (t) out[k] = t;
  }
  return out;
}

/** Which required facts are still missing, given what was heard and what the record holds. */
export function missingFacts(f: HeardFacts, known: Known = {}): RequiredFact[] {
  const has: Record<RequiredFact, boolean> = {
    birthDate: !!f.birthDate || !!known.birthDate,
    sex: !!f.sex || !!known.sex,
    height: !!f.height || !!known.height,
    weight: !!f.weight || !!known.weight,
  };
  return REQUIRED.filter((k) => !has[k]);
}

/* ------------------------------- The checks ------------------------------- */
// The caller's `accept` on the shared JSON call: a failure re-runs the call
// once on the escalation model (llm/policy.ts). Facts that fail ranges are
// simply dropped above — a slip there is not worth a second call.

const FIRST_PERSON = /\b(I|I'm|I've|I'd|my|me|mine|myself)\b/;
/** A section that existed must survive an addition mostly intact. */
const KEPT_RATIO = 0.6;

export function checkStory(next: StoryDraft, current: StoryDraft = {}): true | string {
  for (const k of SECTION_KEYS) {
    const t = next[k];
    if (t && FIRST_PERSON.test(t)) return `story.${k} is written in the first person; write it in the third person`;
    const before = current[k];
    if (before && (!t || t.length < before.length * KEPT_RATIO))
      return `story.${k} dropped what was already there ("${before.slice(0, 60)}…"); keep it and add the new detail`;
  }
  return true;
}

/** Story Json from the DB row → the plain draft shape the prompt and the check use. */
export const draftOf = (story: Story): StoryDraft =>
  Object.fromEntries(SECTION_KEYS.filter((k) => story[k]).map((k) => [k, story[k]!.text]));

/* ----------------------------- To the record ----------------------------- */

/** Family chips → FamilyHistorySummary fields, merged onto what is there (same mapping the physical step used). */
export function familyPayload(current: Record<string, any> | null | undefined, keys: FamilyKey[]) {
  const base = {
    historyOfChronicConditions: [] as string[],
    historyOfCancer: [] as string[],
    historyOfMentalHealth: [] as string[],
    historyOfStroke: false,
    historyOfHeartAttack: false,
    historyOfHereditaryConditions: [] as string[],
    historyOfHighCholesterol: false,
    historyOfHighTriglyceride: false,
    historyOfAutoimmuneConditions: [] as string[],
    historyOfKidneyDisease: false,
    historyOfRespiratoryConditions: false,
    historyOfDementiaOrAlzheimer: false,
    ...(current ?? {}),
  };
  delete (base as any).id;
  delete (base as any).patientSummaryId;
  const add = (list: string[], v: string, on: boolean) => (on ? Array.from(new Set([...list, v])) : list);
  const has = (k: FamilyKey) => keys.includes(k);
  return {
    ...base,
    historyOfCancer: add(add(add(base.historyOfCancer, "breast cancer", has("breastOrOvarianCancer")), "colorectal cancer", has("colorectalCancer")), "prostate cancer", has("prostateCancer")),
    historyOfChronicConditions: add(add(base.historyOfChronicConditions, "diabetes", has("diabetes")), "osteoporosis", has("osteoporosis")),
    historyOfHeartAttack: base.historyOfHeartAttack || has("earlyHeartDisease"),
    historyOfHighCholesterol: base.historyOfHighCholesterol || has("highCholesterol"),
  };
}

/** Adds names to a list without duplicates (case-insensitive), keeping the existing spelling. */
export const unionNames = (existing: string[], added: string[]) => dedupe([...existing, ...added.map(clean)]);
