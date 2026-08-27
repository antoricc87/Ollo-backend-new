/**
 * Nutrition estimator eval harness.
 *
 *   npm run eval:nutrition -- --model=gpt-4o-mini
 *   npm run eval:nutrition -- --model=gpt-5-mini --effort=minimal --filter=t3 --concurrency=4
 *   npm run eval:nutrition -- --resolver=llm      # model-only nutrients (Phase 1 behaviour)
 *
 * Runs every case in cases.json through analyzeMeal (no DB needed — profile comes
 * from the case or defaultContext), compares totals with the reference values and
 * writes a JSON report to eval-results/. Use the same cases across models so the
 * numbers are comparable (Phase 4).
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import {
  analyzeMeal,
  DEFAULT_MEAL_MODEL,
} from "../../services/meal_analysis/mealAnalysis.service";
import { MealAnalysisResult } from "../../services/meal_analysis/mealAnalysis.schema";
import { analyzeNarration } from "../../services/meal_analysis/mealBatch";
import { resolveMealDate } from "../../services/meal_analysis/mealDate";
import {
  PatientContext,
  ReasoningEffort,
} from "../../services/meal_analysis/mealAnalysis.types";

interface EvalCase {
  id: string;
  input: string;
  mealTypeHint?: string;
  patientContext?: PatientContext;
  expected: { kcal: number; protein: number; carbs: number; fat: number };
  tolerance?: number;
  expectedMeals?: number;
  expectedDateReference?: string;
  /** Batch path: run through analyzeNarration (segmentation + code-side date resolution). */
  narration?: boolean;
  /** Per-meal day checks, relative to EVAL_TODAY (a meal of that type must land daysAgo days back). */
  expectedMealDays?: { mealType: string; daysAgo: number }[];
  /** How many meals must be held back (unresolvable day). Totals cover resolved meals only. */
  expectHeldBack?: number;
  expectUser?: string[];
  expectAssumed?: string[];
  notes?: string;
}

interface CaseResult {
  id: string;
  ok: boolean;
  error?: string;
  latencyMs: number;
  tokens: { input: number; output: number };
  predicted: { kcal: number; protein: number; carbs: number; fat: number };
  expected: EvalCase["expected"];
  ape: { kcal: number; protein: number; carbs: number; fat: number };
  withinTolerance: boolean;
  mealCountOk: boolean | null;
  dateOk: boolean | null;
  datesOk: boolean | null;
  heldBackOk: boolean | null;
  portionChecks: { passed: number; total: number; failures: string[] };
  duplicates: string[];
  items: { name: string; quantity: string; grams: number; portionSource: string; kcal: number; nutrientSource: string; reference: string | null; reason: string | null }[];
  usdaItems: number;
  totalItems: number;
}

// Fixed "today" so weekday phrases in the cases resolve the same way every run (2026-08-26 is a Wednesday).
const EVAL_TODAY = process.env.EVAL_TODAY || "2026-08-26";
const EVAL_TZ = "Europe/Rome";
const daysAgo = (n: number) => {
  const d = new Date(`${EVAL_TODAY}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};
// Batch results carry a resolved `date`; plain analyzeMeal results carry the phrase.
const mealDay = (m: any): string | null => m.date ?? resolveMealDate(m.mealDate, EVAL_TODAY, EVAL_TZ).date;

// $ per 1M tokens [input, output] — update as pricing changes.
const PRICING: Record<string, [number, number]> = {
  "gpt-4o-mini": [0.15, 0.6],
  "gpt-4o": [2.5, 10],
  "gpt-4.1-nano": [0.1, 0.4],
  "gpt-4.1-mini": [0.4, 1.6],
  "gpt-4.1": [2, 8],
  "gpt-5-nano": [0.05, 0.4],
  "gpt-5-mini": [0.25, 2],
  "gpt-5": [1.25, 10],
  "o4-mini": [1.1, 4.4],
  "gpt-5.6-terra": [2, 12],
  "gpt-5.6-luna": [0.2, 1.2],
  "gpt-5.6-sol": [4, 20],
};

const arg = (name: string, fallback?: string) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const ape = (pred: number, ref: number) =>
  ref === 0 ? (pred <= 2 ? 0 : 1) : Math.abs(pred - ref) / ref;

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const pad = (s: string | number, n: number) => String(s).padEnd(n);

async function runCase(
  c: EvalCase,
  ctx: PatientContext,
  model: string,
  effort: ReasoningEffort | undefined,
  resolver: "usda" | "llm"
): Promise<CaseResult> {
  const started = Date.now();
  let result: MealAnalysisResult;
  let heldBack = 0;
  try {
    if (c.narration) {
      // Batch path: segmentation + per-meal date resolution, no DB.
      const n = await analyzeNarration(c.input, { patientContext: c.patientContext ?? ctx, today: EVAL_TODAY, timeZone: EVAL_TZ, mealTypeHint: c.mealTypeHint });
      heldBack = n.heldBack.length;
      result = { meals: n.meals, dateReference: null, dateConfidence: 1, model: n.model, latencyMs: Date.now() - started, usage: null };
    } else {
      result = await analyzeMeal(
        { text: c.input, mealTypeHint: c.mealTypeHint, todayLocal: EVAL_TODAY },
        { patientContext: c.patientContext ?? ctx, model, reasoningEffort: effort, resolver }
      );
    }
  } catch (e: any) {
    return {
      id: c.id,
      ok: false,
      error: e?.message || String(e),
      latencyMs: Date.now() - started,
      tokens: { input: 0, output: 0 },
      predicted: { kcal: 0, protein: 0, carbs: 0, fat: 0 },
      expected: c.expected,
      ape: { kcal: 1, protein: 1, carbs: 1, fat: 1 },
      withinTolerance: false,
      mealCountOk: null,
      dateOk: null,
      datesOk: null,
      heldBackOk: null,
      portionChecks: { passed: 0, total: 0, failures: [] },
      duplicates: [],
      items: [],
      usdaItems: 0,
      totalItems: 0,
    };
  }

  const ings = result.meals.flatMap((m) => m.ingredients);
  const predicted = {
    kcal: ings.reduce((a, i) => a + i.calories, 0),
    protein: ings.reduce((a, i) => a + i.nutrients.proteins, 0),
    carbs: ings.reduce((a, i) => a + i.nutrients.carbohydrates, 0),
    fat: ings.reduce((a, i) => a + i.nutrients.fats, 0),
  };
  const errs = {
    kcal: ape(predicted.kcal, c.expected.kcal),
    protein: ape(predicted.protein, c.expected.protein),
    carbs: ape(predicted.carbs, c.expected.carbs),
    fat: ape(predicted.fat, c.expected.fat),
  };
  const tolerance = c.tolerance ?? 0.2;

  const find = (needle: string) => {
    const alts = needle.toLowerCase().split("|");
    return ings.find((i) =>
      alts.some((a) => i.name.toLowerCase().includes(a) || i.searchTerm.toLowerCase().includes(a))
    );
  };
  const failures: string[] = [];
  let total = 0;
  let passed = 0;
  for (const needle of c.expectUser ?? []) {
    total++;
    const hit = find(needle);
    if (!hit) failures.push(`missing item '${needle}'`);
    else if (hit.portionSource !== "user")
      failures.push(`'${hit.name}' portionSource=${hit.portionSource}, expected user`);
    else passed++;
  }
  for (const needle of c.expectAssumed ?? []) {
    total++;
    const hit = find(needle);
    if (!hit) failures.push(`missing item '${needle}'`);
    else if (hit.portionSource === "user")
      failures.push(`'${hit.name}' portionSource=user, expected assumed`);
    else if (!hit.portionAssumption)
      failures.push(`'${hit.name}' assumed but portionAssumption empty`);
    else passed++;
  }

  const names = ings.map((i) => i.name.trim().toLowerCase());
  const duplicates = names.filter((n, idx) => names.indexOf(n) !== idx);

  return {
    id: c.id,
    ok: true,
    latencyMs: result.latencyMs,
    tokens: {
      input: result.usage?.inputTokens ?? 0,
      output: result.usage?.outputTokens ?? 0,
    },
    predicted,
    expected: c.expected,
    ape: errs,
    withinTolerance: errs.kcal <= tolerance,
    mealCountOk:
      c.expectedMeals != null ? result.meals.length === c.expectedMeals : null,
    dateOk:
      c.expectedDateReference != null
        ? (result.dateReference || "").toLowerCase().includes(c.expectedDateReference.toLowerCase())
        : null,
    datesOk: c.expectedMealDays ? c.expectedMealDays.every((e) => result!.meals.some((m) => m.mealType === e.mealType && mealDay(m) === daysAgo(e.daysAgo))) : null,
    heldBackOk: c.expectHeldBack != null ? heldBack === c.expectHeldBack : null,
    portionChecks: { passed, total, failures },
    duplicates,
    items: ings.map((i) => ({
      name: i.name,
      quantity: `${i.quantity} ${i.unit}`,
      grams: i.grams,
      portionSource: i.portionSource,
      kcal: Math.round(i.calories),
      nutrientSource: i.nutrientSource,
      reference: i.reference ? `${i.reference.description} [${i.reference.dataType}]` : null,
      reason: i.resolution.reason,
    })),
    usdaItems: ings.filter((i) => i.nutrientSource === "usda").length,
    totalItems: ings.length,
  };
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>) {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

(async () => {
  const file = JSON.parse(fs.readFileSync(path.join(__dirname, "cases.json"), "utf8"));
  const model = arg("model", DEFAULT_MEAL_MODEL)!;
  const effort = arg("effort") as ReasoningEffort | undefined;
  const filter = arg("filter");
  const limit = Number(arg("limit", "0"));
  const concurrency = Number(arg("concurrency", "3"));
  const resolver = (arg("resolver", process.env.NUTRITION_RESOLVER || "usda") as "usda" | "llm");
  const stamp = arg("stamp", new Date().toISOString().replace(/[:.]/g, "-"));

  let cases: EvalCase[] = file.cases;
  if (filter) cases = cases.filter((c) => c.id.includes(filter) || c.input.includes(filter));
  if (limit > 0) cases = cases.slice(0, limit);
  console.log(`Running ${cases.length} cases on ${model}${effort ? ` (effort=${effort})` : ""}, resolver ${resolver}${resolver === "usda" ? ` (rerank ${process.env.NUTRITION_RERANK_MODEL || "gpt-5.6-luna"})` : ""}, concurrency ${concurrency}\n`);

  const results = await pool(cases, concurrency, (c) => runCase(c, file.defaultContext, model, effort, resolver));

  console.log(
    pad("case", 30) + pad("kcal pred/ref", 16) + pad("kcal err", 10) + pad("P", 6) + pad("C", 6) + pad("F", 6) + pad("portion", 9) + pad("usda", 6) + pad("ms", 7) + "flags"
  );
  for (const r of results) {
    const flags: string[] = [];
    if (!r.ok) flags.push(`ERROR ${r.error}`);
    if (r.mealCountOk === false) flags.push("meals!");
    if (r.dateOk === false) flags.push("date!");
    if (r.datesOk === false) flags.push("mealDays!");
    if (r.heldBackOk === false) flags.push("heldBack!");
    if (r.duplicates.length) flags.push(`dup:${r.duplicates.join(",")}`);
    flags.push(...r.portionChecks.failures);
    console.log(
      pad(r.id, 30) +
        pad(`${Math.round(r.predicted.kcal)}/${r.expected.kcal}`, 16) +
        pad((r.withinTolerance ? "✓ " : "✗ ") + pct(r.ape.kcal), 10) +
        pad(pct(r.ape.protein), 6) +
        pad(pct(r.ape.carbs), 6) +
        pad(pct(r.ape.fat), 6) +
        pad(`${r.portionChecks.passed}/${r.portionChecks.total}`, 9) +
        pad(`${r.usdaItems}/${r.totalItems}`, 6) +
        pad(r.latencyMs, 7) +
        flags.join("; ")
    );
  }

  const okResults = results.filter((r) => r.ok);
  const inTok = results.reduce((a, r) => a + r.tokens.input, 0);
  const outTok = results.reduce((a, r) => a + r.tokens.output, 0);
  const price = PRICING[model];
  const cost = price ? (inTok * price[0] + outTok * price[1]) / 1e6 : null;
  const portionTotal = results.reduce((a, r) => a + r.portionChecks.total, 0);
  const portionPassed = results.reduce((a, r) => a + r.portionChecks.passed, 0);

  const usdaItems = results.reduce((a, r) => a + r.usdaItems, 0);
  const totalItems = results.reduce((a, r) => a + r.totalItems, 0);
  const rerankModel = process.env.NUTRITION_RERANK_MODEL || "gpt-5.6-luna";
  const summary = {
    model,
    effort: effort ?? null,
    resolver,
    rerankModel: resolver === "usda" ? rerankModel : null,
    rerankEffort: resolver === "usda" ? process.env.NUTRITION_RERANK_EFFORT || "none" : null,
    usdaShare: totalItems ? usdaItems / totalItems : null,
    cases: results.length,
    errors: results.length - okResults.length,
    kcal: {
      mape: mean(okResults.map((r) => r.ape.kcal)),
      medianApe: median(okResults.map((r) => r.ape.kcal)),
      withinTolerance: okResults.filter((r) => r.withinTolerance).length / Math.max(1, okResults.length),
    },
    macrosMape: {
      protein: mean(okResults.map((r) => r.ape.protein)),
      carbs: mean(okResults.map((r) => r.ape.carbs)),
      fat: mean(okResults.map((r) => r.ape.fat)),
    },
    portionSourceAccuracy: portionTotal ? portionPassed / portionTotal : null,
    mealCountAccuracy: (() => {
      const xs = results.filter((r) => r.mealCountOk !== null);
      return xs.length ? xs.filter((r) => r.mealCountOk).length / xs.length : null;
    })(),
    duplicatesCases: results.filter((r) => r.duplicates.length).length,
    latencyMs: { mean: mean(okResults.map((r) => r.latencyMs)), median: median(okResults.map((r) => r.latencyMs)) },
    tokens: { input: inTok, output: outTok },
    estimatedCostUsd: cost,
  };

  console.log("\nSUMMARY");
  console.log(`  kcal MAPE ${pct(summary.kcal.mape)} | median APE ${pct(summary.kcal.medianApe)} | within tolerance ${pct(summary.kcal.withinTolerance)}`);
  console.log(`  macros MAPE  P ${pct(summary.macrosMape.protein)}  C ${pct(summary.macrosMape.carbs)}  F ${pct(summary.macrosMape.fat)}`);
  console.log(`  portion-source accuracy ${summary.portionSourceAccuracy == null ? "n/a" : pct(summary.portionSourceAccuracy)} | meal-count accuracy ${summary.mealCountAccuracy == null ? "n/a" : pct(summary.mealCountAccuracy)} | cases with duplicates ${summary.duplicatesCases}`);
  console.log(`  nutrients from USDA: ${usdaItems}/${totalItems} items (${summary.usdaShare == null ? "n/a" : pct(summary.usdaShare)})`);
  console.log(`  latency mean ${Math.round(summary.latencyMs.mean)} ms, median ${Math.round(summary.latencyMs.median)} ms | tokens in ${inTok} / out ${outTok}${cost != null ? ` | est. cost $${cost.toFixed(4)}` : ""}`);

  const outDir = path.join(process.cwd(), "eval-results");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `nutrition-${model}${effort ? `-${effort}` : ""}-${resolver}-${stamp}.json`);
  fs.writeFileSync(outFile, JSON.stringify({ summary, results }, null, 2));
  console.log(`\nReport: ${outFile}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
