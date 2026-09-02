import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import {
  analyzeMeal,
  FALLBACK_MEAL_MODEL,
  formatQuantity,
  getClient,
  modelRequestParams,
} from "./mealAnalysis.service";
import { AnalyzedMeal, MEAL_TYPES, PORTION_STOPS, PortionStop } from "./mealAnalysis.schema";
import { applyPortionStop, DEFAULT_PORTION_STOP, ensurePortionBase, gramsAtEveryStop, isMealPortionScalable, isPortionStop, rescaleTo } from "./mealPortion";
import { dayLabel, resolveMealDate } from "./mealDate";
import type { PatientContext } from "./mealAnalysis.types";

/**
 * Batch meal logging: one narration ("yesterday I had…, Tuesday dinner was…")
 * → dated meals the user reviews in a single proposal.
 *
 *   narration ─► (long? segment by day) ─► analyzeMeal per segment, in parallel
 *             ─► resolveMealDate (code-side) ─► resolved meals + held-back meals
 *
 * `buildMealPreview` / `applyMealEdits` are pure so the tool's run and commit
 * paths (and the tests) share one definition of the preview the app renders.
 */

/* ------------------------------- types ---------------------------------- */

export type BatchMeal = AnalyzedMeal & {
  /** Local calendar day the meal is proposed for. */
  date: string;
  /** What the user said about the day (kept for the card and for audit). */
  datePhrase: string;
  /** Unticked meals are shown but not saved. */
  included: boolean;
  /** How much of it: the meal portion dial, applied to assumed portions only. */
  portion: PortionStop;
  /** "Already logged" note: description of the existing entry with the same slot. */
  duplicateOf: string | null;
};

export type HeldBackMeal = {
  name: string;
  mealType: string;
  /** The day phrase we could not resolve ("the other day"). */
  whenSaid: string;
  calories: number;
  /** Ready to resend through log_meal once the user says which day. */
  description: string;
};

export type NarrationAnalysis = {
  meals: BatchMeal[];
  heldBack: HeldBackMeal[];
  model: string;
  segments: number;
};

export type MealEdits = z.infer<typeof MealEditsSchema>;

/* ---------------------------- segmentation ------------------------------ */

const DAY_CUE =
  /\b(yesterday|today|tonight|last night|this morning|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|days? ago|day before yesterday|the other day|last week|weekend|\d{4}-\d{2}-\d{2})\b/gi;

export const SEGMENT_MIN_CHARS = Number(process.env.NUTRITION_SEGMENT_MIN_CHARS || 400);

/** Long or clearly multi-day narrations get split by day before analysis. */
export function needsSegmentation(text: string): boolean {
  if (text.length >= SEGMENT_MIN_CHARS) return true;
  const cues = new Set((text.match(DAY_CUE) || []).map((c) => c.toLowerCase()));
  return cues.size >= 2;
}

const SegmentsSchema = z.object({
  segments: z.array(
    z.object({
      dayPhrase: z
        .string()
        .nullable()
        .describe("The day words the person used for this segment, verbatim ('yesterday', 'Monday', 'two days ago'); null when no day is mentioned"),
      text: z.string().describe("The person's words for that day, copied verbatim — every food kept, nothing paraphrased"),
    })
  ),
});

const SEGMENT_SYSTEM = `You cut a person's account of what they ate into one segment per day.
- Segments are contiguous, non-overlapping slices of the original text, in order, copied character for character. Cut exactly where a new day expression begins ("yesterday", "on Monday", "two days ago", "the other day"); the day expression starts its segment. Together the segments must reproduce the whole text once — nothing repeated, nothing dropped.
- dayPhrase is the day expression at the start of the segment, exactly as written; null when the segment has none (that means today).
- Meals that follow a day cue belong to that day until the next cue. "Then for dinner…" after "yesterday" is still yesterday.
- Do not resolve phrases into dates; keep the person's words.
- If the whole text is about one day, return one segment containing all of it.`;

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Accept the model's split only if every segment is found, in order and without
 * overlap, in the narration (whitespace/case-insensitive) and the pieces cover
 * most of it. A bad split would double-count or drop meals, so the fallback is
 * to analyse the narration whole and let the analyser date meals itself.
 */
export function validateSegments(text: string, segments: { dayPhrase: string | null; text: string }[]): boolean {
  if (!segments.length) return false;
  const hay = norm(text);
  let cursor = 0;
  let covered = 0;
  for (const s of segments) {
    const piece = norm(s.text);
    if (!piece) return false;
    const pos = hay.indexOf(piece, cursor);
    if (pos < 0) return false;
    cursor = pos + piece.length;
    covered += piece.length;
  }
  return covered >= hay.length * 0.7;
}

export async function segmentNarration(text: string): Promise<{ dayPhrase: string | null; text: string }[]> {
  const model = process.env.NUTRITION_SEGMENT_MODEL || FALLBACK_MEAL_MODEL;
  const response = await getClient().responses.parse({
    model,
    ...(modelRequestParams(model) as any),
    input: [
      { role: "system", content: SEGMENT_SYSTEM },
      { role: "user", content: text },
    ],
    text: { format: zodTextFormat(SegmentsSchema, "narration_segments") },
  });
  const parsed = response.output_parsed as z.infer<typeof SegmentsSchema> | null;
  const segments = (parsed?.segments || [])
    .filter((s) => s.text && s.text.trim())
    .map((s) => ({ dayPhrase: s.dayPhrase ?? null, text: s.text as string }));
  if (!validateSegments(text, segments)) {
    console.warn(`[meal-batch] segmenter split rejected (${segments.length} segments); analysing whole`);
    return [{ dayPhrase: null, text }];
  }
  return segments;
}

/* ------------------------------ analysis -------------------------------- */

export type NarrationOptions = {
  patientId?: string;
  /** Skip the DB lookup (evals, tests). */
  patientContext?: PatientContext;
  today: string;
  timeZone: string;
  mealTypeHint?: string;
  /** Caller-supplied day that overrides whatever the text says (the tool's `date`). */
  dateOverride?: string;
};

const CONCURRENCY = 3;

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    })
  );
  return out;
}

export const describeMeal = (m: AnalyzedMeal): string =>
  m.ingredients.map((i) => `${formatQuantity(i.quantity, i.unit)} ${i.name}`).join(", ");

export async function analyzeNarration(text: string, opts: NarrationOptions): Promise<NarrationAnalysis> {
  const segments = needsSegmentation(text) && !opts.dateOverride ? await segmentNarration(text) : [{ dayPhrase: null, text }];
  const results = await mapLimit(segments, CONCURRENCY, (s) =>
    analyzeMeal(
      { text: s.text, mealTypeHint: segments.length === 1 ? opts.mealTypeHint : undefined, todayLocal: opts.today, dayHint: s.dayPhrase ?? undefined },
      { patientId: opts.patientId, patientContext: opts.patientContext }
    )
  );

  const meals: BatchMeal[] = [];
  const heldBack: HeldBackMeal[] = [];
  results.forEach((res, si) => {
    const segPhrase = segments[si].dayPhrase;
    for (const m of res.meals) {
      if (!m.ingredients?.length) continue;
      // Inside a "yesterday" segment the analyser's default "today" means the segment's day.
      const own = (m.mealDate || "").trim();
      const phrase = opts.dateOverride ?? (segPhrase && (!own || /^today$/i.test(own)) ? segPhrase : own || segPhrase || "today");
      const resolved = resolveMealDate(phrase, opts.today, opts.timeZone);
      if (resolved.unresolved) {
        heldBack.push({
          name: m.mealName,
          mealType: m.mealType,
          whenSaid: phrase,
          calories: Math.round(sum(m.ingredients.map((i) => i.calories))),
          description: describeMeal(m),
        });
        continue;
      }
      const portion = isPortionStop((m as any).portion) ? ((m as any).portion as PortionStop) : DEFAULT_PORTION_STOP;
      const meal: BatchMeal = { ...m, ingredients: m.ingredients.map((i) => ({ ...i })), date: resolved.date, datePhrase: phrase, included: true, duplicateOf: null, portion: DEFAULT_PORTION_STOP };
      // Stamp the reference grams before anything can scale them, then apply what
      // the person said about the meal as a whole ("I ate a lot") so the proposal
      // already reads right and the card opens on the matching stop.
      ensurePortionBase(meal.ingredients);
      if (portion !== DEFAULT_PORTION_STOP) {
        applyPortionStop(meal.ingredients, portion);
        meal.portion = portion;
      }
      meals.push(meal);
    }
  });
  const unique = dedupeMeals(meals);
  unique.sort((a, b) => (a.date === b.date ? MEAL_ORDER[a.mealType] - MEAL_ORDER[b.mealType] : a.date < b.date ? -1 : 1));
  return { meals: unique, heldBack, model: results[0]?.model ?? "", segments: segments.length };
}

/** The same meal analysed twice (an overlapping split) collapses to one: same day, slot and ingredient names. */
export function dedupeMeals<T extends { date: string; mealType?: string; ingredients: { name?: string }[] }>(meals: T[]): T[] {
  const seen = new Set<string>();
  return meals.filter((m) => {
    const key = `${m.date}|${m.mealType}|${m.ingredients.map((i) => (i.name ?? "").trim().toLowerCase()).sort().join(",")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/* --------------------------- preview building --------------------------- */

const MEAL_ORDER: Record<string, number> = { BREAKFAST: 0, LUNCH: 1, DINNER: 2, SNACK: 3 };
const r1 = (n: number) => Math.round(n * 10) / 10;
const sum = (xs: (number | null | undefined)[]) => xs.reduce<number>((a, b) => a + (b ?? 0), 0);

export type PreviewContext = {
  today: string;
  timeZone: string;
  subject: string;
  subjectId: string;
  model: string;
  heldBack: HeldBackMeal[];
};

export const mealRow = (m: BatchMeal, index: number) => ({
  index,
  date: m.date,
  name: m.mealName || "Meal",
  mealType: m.mealType,
  included: m.included,
  duplicateOf: m.duplicateOf,
  portion: m.portion ?? DEFAULT_PORTION_STOP,
  /** False when every item's amount came from the user or a brand — the dial would do nothing. */
  portionScalable: isMealPortionScalable(m.ingredients as any),
  calories: Math.round(sum(m.ingredients.map((i) => i.calories))),
  protein_g: r1(sum(m.ingredients.map((i) => i.nutrients?.proteins))),
  carbs_g: r1(sum(m.ingredients.map((i) => i.nutrients?.carbohydrates))),
  fat_g: r1(sum(m.ingredients.map((i) => i.nutrients?.fats))),
  ingredients: m.ingredients.map((i) => ({
    name: i.name,
    quantity: i.quantity,
    unit: i.unit,
    grams: i.grams,
    calories: Math.round(i.calories ?? 0),
    portionSource: i.portionSource ?? null,
    nutrientSource: (i as any).nutrientSource ?? null,
    /** Precomputed on the server so the card never re-derives the band and drifts. */
    gramsAt: gramsAtEveryStop(i as any),
  })),
});

export type MealRow = ReturnType<typeof mealRow>;

/**
 * The proposal preview the app renders. `analysis.meals` (flat, with date and
 * included flags) is the source of truth; `days` is that list grouped for
 * display, and every row carries its flat `index` so edits can address it.
 */
export function buildMealPreview(meals: BatchMeal[], ctx: PreviewContext) {
  const rows = meals.map(mealRow);
  const byDay = new Map<string, MealRow[]>();
  for (const r of rows) (byDay.get(r.date) ?? byDay.set(r.date, []).get(r.date)!).push(r);
  const days = [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, ms]) => ({
      date,
      label: dayLabel(date, ctx.today, ctx.timeZone),
      calories: ms.filter((m) => m.included).reduce((a, m) => a + m.calories, 0),
      meals: ms,
    }));
  const included = rows.filter((r) => r.included);
  return {
    subject: ctx.subject,
    subjectId: ctx.subjectId,
    today: ctx.today,
    timeZone: ctx.timeZone,
    days,
    heldBack: ctx.heldBack,
    totals: { meals: rows.length, included: included.length, calories: included.reduce((a, r) => a + r.calories, 0) },
    analysis: { model: ctx.model, meals },
  };
}

export type MealPreview = ReturnType<typeof buildMealPreview>;

/* ------------------------------- edits ---------------------------------- */

/**
 * Card edits: `{ meals: [{ index, included?, date?, mealType?, portion?, ingredients? }] }`
 * — `index` addresses `analysis.meals`; `ingredients[].grams: null` removes the
 * ingredient. Calories and every numeric nutrient scale linearly with grams.
 * `portion` is the coarse dial (see mealPortion.ts); it is applied before any
 * explicit gram edit, which always wins.
 */
export const MealEditsSchema = z.object({
  meals: z
    .array(
      z.object({
        index: z.number().int().min(0),
        included: z.boolean().optional(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        mealType: z.enum(MEAL_TYPES).optional(),
        portion: z.enum(PORTION_STOPS).optional(),
        ingredients: z.array(z.object({ index: z.number().int().min(0), grams: z.number().min(0).max(5000).nullable() })).max(60).optional(),
      })
    )
    .max(60),
});

/** Old single-day previews (pending when this shipped) are lifted into the batch shape. */
export function normalizePreview(preview: any): MealPreview {
  if (preview?.days && preview?.analysis?.meals?.every((m: any) => m.date)) return preview as MealPreview;
  const date: string = preview?.date ?? preview?.today;
  const meals: BatchMeal[] = (preview?.analysis?.meals ?? []).map((m: any) => ({
    ...m,
    date: m.date ?? date,
    datePhrase: m.datePhrase ?? "",
    included: m.included ?? true,
    duplicateOf: m.duplicateOf ?? null,
    portion: isPortionStop(m.portion) ? m.portion : DEFAULT_PORTION_STOP,
  }));
  return buildMealPreview(meals, {
    today: preview?.today ?? date,
    timeZone: preview?.timeZone ?? "UTC",
    subject: preview?.subject ?? "you",
    subjectId: preview?.subjectId,
    model: preview?.analysis?.model ?? "",
    heldBack: preview?.heldBack ?? [],
  });
}

export function applyMealEdits(rawPreview: any, rawEdits: unknown): MealPreview & { edited: true } {
  const edits = MealEditsSchema.parse(rawEdits);
  const preview = normalizePreview(rawPreview);
  const today = preview.today;
  const meals: BatchMeal[] = preview.analysis.meals.map((m) => ({ ...m, ingredients: m.ingredients.map((i) => ({ ...i })) }));
  if (!meals.length) throw new Error("preview has no analysed meals to edit");
  for (const m of meals) ensurePortionBase(m.ingredients);
  for (const me of edits.meals) {
    const meal = meals[me.index];
    if (!meal) throw new Error(`no meal at index ${me.index}`);
    if (me.included !== undefined) meal.included = me.included;
    if (me.mealType) meal.mealType = me.mealType;
    // The dial goes first and is recomputed from the untouched band, so sending
    // the same stop twice changes nothing. An explicit gram edit below is an
    // absolute target, so it overrides the dial for that ingredient.
    if (me.portion && me.portion !== meal.portion) {
      applyPortionStop(meal.ingredients, me.portion);
      meal.portion = me.portion;
    }
    if (me.date) {
      if (me.date > today) throw new Error("a meal can't be logged on a future day");
      meal.date = me.date;
    }
    const removed = new Set<number>();
    for (const ie of me.ingredients ?? []) {
      const ing: any = meal.ingredients[ie.index];
      if (!ing) throw new Error(`no ingredient at index ${ie.index}`);
      if (ie.grams === null || ie.grams === 0) {
        removed.add(ie.index);
        continue;
      }
      rescaleTo(ing, ie.grams);
      // Typing a weight is the user stating the amount — it also freezes the item
      // against the dial from here on. The coarse stop never does this.
      ing.portionSource = "user";
    }
    meal.ingredients = meal.ingredients.filter((_, i) => !removed.has(i));
    if (!meal.ingredients.length) throw new Error("a meal must keep at least one ingredient — untick it instead");
  }
  return { ...buildMealPreview(meals, { ...preview, heldBack: preview.heldBack, model: preview.analysis.model }), edited: true };
}

/* ------------------------------ overlaps -------------------------------- */

export type ExistingEntry = { mealType: string | null; description: string; calories: number };
const MAIN_SLOTS = ["BREAKFAST", "LUNCH", "DINNER"];

/**
 * Marks meals that collide with something already logged. A main-slot
 * collision unticks the meal (the user can tick it back); a snack collision
 * only gets the note.
 */
export function markDuplicates(meals: BatchMeal[], existing: Record<string, ExistingEntry[]>): BatchMeal[] {
  return meals.map((m) => {
    const hit = (existing[m.date] ?? []).find((e) => e.mealType === m.mealType);
    if (!hit) return m;
    const duplicateOf = `${hit.description} (${hit.calories} kcal)`;
    return { ...m, duplicateOf, included: MAIN_SLOTS.includes(m.mealType) ? false : m.included };
  });
}

/** Main slots with nothing proposed and nothing logged, per day — only worth asking about in a multi-day batch. */
export function missingSlots(meals: BatchMeal[], existing: Record<string, ExistingEntry[]>): Record<string, string[]> {
  const days = [...new Set(meals.map((m) => m.date))];
  if (days.length < 2) return {};
  const out: Record<string, string[]> = {};
  for (const d of days) {
    const have = new Set([...meals.filter((m) => m.date === d).map((m) => m.mealType), ...(existing[d] ?? []).map((e) => e.mealType)]);
    const missing = MAIN_SLOTS.filter((s) => !have.has(s)).map((s) => s.toLowerCase());
    if (missing.length) out[d] = missing;
  }
  return out;
}
