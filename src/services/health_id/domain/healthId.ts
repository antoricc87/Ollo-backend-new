/**
 * Health ID — who the person is and what they want from Ollo.
 * Plan: ../docs/onboarding-health-id-plan.md (Nov 11 2026).
 *
 * Two layers, one summary:
 * - FACTS are rendered by code from the record every time (never stored here,
 *   never written by a model), so the summary can't drift from the record.
 * - The STORY is a few short sections written from the person's own words, by
 *   the person or by Ollie.
 *
 * Third person throughout (ruling Nov 11 2026): "39-year-old man…".
 * Pure: no Prisma, no I/O.
 */

export const SECTION_KEYS = ["focus", "wants", "worries", "constraints", "success", "coaching"] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export const SECTION_LABELS: Record<SectionKey, string> = {
  focus: "Focus",
  wants: "Wants from Ollo",
  worries: "Worried about",
  constraints: "Constraints",
  success: "Success looks like",
  coaching: "How to coach",
};

export type Author = "person" | "ollie" | "onboarding";
export const AUTHORS: Author[] = ["person", "ollie", "onboarding"];

export type StorySection = { text: string; by: Author; updatedAt: string };
export type Story = Partial<Record<SectionKey, StorySection>>;

export const MAX_SECTION_CHARS = 600;

export const isSectionKey = (k: unknown): k is SectionKey =>
  typeof k === "string" && (SECTION_KEYS as readonly string[]).includes(k);

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/** Whatever is in the Json column → a valid Story (unknown keys and bad rows dropped). */
export function parseStory(raw: unknown): Story {
  const out: Story = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, any>)) {
    if (!isSectionKey(k) || !v || typeof v.text !== "string") continue;
    const text = clean(v.text).slice(0, MAX_SECTION_CHARS);
    if (!text) continue;
    out[k] = {
      text,
      by: AUTHORS.includes(v.by) ? v.by : "person",
      updatedAt: typeof v.updatedAt === "string" ? v.updatedAt : new Date(0).toISOString(),
    };
  }
  return out;
}

/* --------------------------------- Facts --------------------------------- */

export type HealthFacts = {
  age: number | null;
  sex: string | null;
  height: { value: number; unit: string } | null;
  weight: { value: number; unit: string } | null;
  conditions: string[];
  medications: string[];
  allergies: string[];
  smoking: string | null;
  alcohol: string | null;
  activity: string | null;
  lastPhysical: { status: string | null; at: string | null } | null;
  familyHistory: string[];
};

const NOT_SAID = /^prefer not to say$/i;
const lowerFirst = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s);
const said = (s: string | null | undefined) => (s && s.trim() && !NOT_SAID.test(s.trim()) ? s.trim() : null);

const noun = (sex: string | null) => {
  const s = (sex ?? "").toLowerCase();
  return s === "male" ? "man" : s === "female" ? "woman" : "person";
};

const listWords = (xs: string[]) =>
  xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

const monthYear = (iso: string) => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
};

// The stored vocabularies (the tap screens' values) as plain words.
const SMOKING_WORDS: Record<string, string> = {
  never: "doesn't smoke",
  "non-smoker": "doesn't smoke",
  "former smoker": "former smoker",
  occasionally: "smokes occasionally",
  daily: "smokes daily",
  smoker: "smokes",
};
const ALCOHOL_WORDS: Record<string, string> = {
  never: "doesn't drink",
  occasionally: "drinks occasionally",
  moderate: "drinks moderately",
  regular: "drinks regularly",
  heavy: "drinks heavily",
};
const ACTIVITY_WORDS: Record<string, string> = {
  "little/no exercise": "little or no exercise",
  "light exercise 1-2 times/week": "exercises 1–2 times a week",
  "moderate exercise 2-3 times/week": "exercises 2–3 times a week",
  "hard exercise 3-5 times/week": "exercises hard 3–5 times a week",
  "hard exercise 6-7 times/week": "exercises hard 6–7 times a week",
  "professional athlete": "trains as a professional athlete",
  "mostly sedentary": "mostly sedentary",
  "lightly active": "lightly active",
  active: "active",
  "very active": "very active",
};
/** A known value in words; an unknown one as "<what>: <value>" rather than dropped. */
const phrase = (words: Record<string, string>, v: string | null, what: string) =>
  v ? words[v.toLowerCase()] ?? `${what}: ${lowerFirst(v)}` : null;

/** The record as a few plain third-person sentences; null when nothing is known. */
export function factsSummary(f: HealthFacts): string | null {
  const parts: string[] = [];

  const who = f.age !== null ? `${f.age}-year-old ${noun(f.sex)}` : f.sex ? lowerFirst(noun(f.sex)) : null;
  const body = [
    f.height ? `${f.height.value} ${f.height.unit}` : null,
    f.weight ? `${f.weight.value} ${f.weight.unit}` : null,
  ].filter(Boolean);
  if (who || body.length) {
    const lead = who ? who[0].toUpperCase() + who.slice(1) : "Height and weight";
    parts.push(body.length ? `${lead}, ${body.join(", ")}.` : `${lead}.`);
  }

  if (f.conditions.length) parts.push(`Conditions on record: ${listWords(f.conditions)}.`);
  if (f.medications.length) parts.push(`Takes ${listWords(f.medications)}.`);
  if (f.allergies.length) parts.push(`Allergic to ${listWords(f.allergies)}.`);

  const habits = [
    phrase(SMOKING_WORDS, said(f.smoking), "smoking"),
    phrase(ALCOHOL_WORDS, said(f.alcohol), "alcohol"),
    phrase(ACTIVITY_WORDS, said(f.activity), "exercise"),
  ].filter(Boolean) as string[];
  if (habits.length) parts.push(`${habits.join(", ")[0].toUpperCase()}${habits.join(", ").slice(1)}.`);

  const lp = f.lastPhysical;
  if (lp?.status === "within_year") {
    const when = lp.at ? monthYear(lp.at) : null;
    parts.push(when ? `Last physical: ${when}.` : "Last physical: within the last year.");
  } else if (lp?.status === "over_year") parts.push("Last physical: more than a year ago.");
  else if (lp?.status === "never") parts.push("Has not had a physical.");

  if (f.familyHistory.length) parts.push(`Family history: ${listWords(f.familyHistory)}.`);

  return parts.length ? parts.join(" ") : null;
}

/* ------------------------------- Rendering ------------------------------- */

export type HealthIdSectionView = { key: SectionKey; label: string; text: string; by: Author; updatedAt: string };

export type HealthIdRender = {
  /** The record, in sentences (null when nothing is known). */
  facts: string | null;
  /** Story sections in their fixed order, only the ones that exist. */
  sections: HealthIdSectionView[];
  /** True when no story has been told yet. */
  storyEmpty: boolean;
};

export function renderHealthId(facts: HealthFacts, story: Story): HealthIdRender {
  const sections = SECTION_KEYS.filter((k) => story[k]).map((k) => ({
    key: k,
    label: SECTION_LABELS[k],
    text: story[k]!.text,
    by: story[k]!.by,
    updatedAt: story[k]!.updatedAt,
  }));
  return { facts: factsSummary(facts), sections, storyEmpty: sections.length === 0 };
}

/** The block Ollie reads on every turn. Same content the person sees. */
export function renderForAgent(r: HealthIdRender): string | null {
  if (!r.facts && r.storyEmpty) return null;
  const L = ["health id (who they are and what they want from Ollo; let it shape every answer, never recite it back):"];
  if (r.facts) L.push(`  ${r.facts}`);
  // No "story not told yet" line: until onboarding asks for the story, it
  // would make Ollie ask every existing user about their goals unprompted.
  for (const s of r.sections) L.push(`  ${s.label.toLowerCase()}: ${s.text}`);
  return L.join("\n");
}

/* --------------------------------- Edits --------------------------------- */

export type SectionEdit = { key: SectionKey; text: string; reason?: string | null };

export type AppliedChange = { section: SectionKey; before: string | null; after: string | null; reason: string | null };

/**
 * Applies edits by one author. Empty text removes a section. A no-op edit
 * makes no change. Ollie never overwrites a section the person wrote last:
 * that edit comes back in `held` (to be offered to them instead).
 */
export function applyEdits(
  story: Story,
  edits: SectionEdit[],
  by: Author,
  now: Date
): { story: Story; changes: AppliedChange[]; held: SectionEdit[] } {
  const next: Story = { ...story };
  const changes: AppliedChange[] = [];
  const held: SectionEdit[] = [];
  for (const e of edits) {
    if (!isSectionKey(e.key)) continue;
    const text = clean(e.text ?? "").slice(0, MAX_SECTION_CHARS);
    const prev = next[e.key];
    if (by === "ollie" && prev?.by === "person") {
      held.push(e);
      continue;
    }
    if ((prev?.text ?? "") === text) continue;
    if (text) next[e.key] = { text, by, updatedAt: now.toISOString() };
    else delete next[e.key];
    changes.push({ section: e.key, before: prev?.text ?? null, after: text || null, reason: e.reason ?? null });
  }
  return { story: next, changes, held };
}
