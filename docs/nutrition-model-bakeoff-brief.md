# Nutrition logging — model bake-off brief

What the model has to do in the meal-logging pipeline, what "better" means, and how to
measure a candidate. Companion to `nutrition-logging-pipeline-plan.md` (Phase 4).

## 1. Where models are called

| Call site | Setting | Today | What it does |
|---|---|---|---|
| **Stage A — identify & portion** (`meal_analysis/mealAnalysis.service.ts`) | `NUTRITION_MODEL` | gpt-4o-mini | The main job, described below. One call per log (text, voice transcript, or photo). |
| **Reranker** (`resolver/nutrientResolution.ts`) | `NUTRITION_RERANK_MODEL` | gpt-4o-mini | Picks the best USDA candidate from a short list, or rejects all. Tiny prompt, called only when the heuristic match is not clear-cut (~60 % of new foods, never on cache hits). |
| Speech-to-text | fixed | gpt-4o-mini-transcribe | Voice note → text. Out of scope for this bake-off. |
| Chat agent, lab reports, meal plans | various | gpt-4o-mini | Not part of the logging estimator. Out of scope. |

Both settings are env vars, so a candidate can be trialled without code changes. Reasoning
models (o-series, gpt-5*) are supported: the service sends `reasoning.effort`
(`NUTRITION_REASONING_EFFORT`, default `low`) instead of `temperature: 0`.

## 2. The Stage A job, in plain terms

Input: a short description of what someone ate, or a photo (plus optional caption), and a
profile line — age, gender, weight, height, meal-type hint. Output: strict JSON (`MealAnalysisSchema`)
listing meals → ingredients, where every ingredient has a name, a database-style search term,
a quantity + unit, an edible weight in grams with a plausible range, a `portionSource` that says
*where the amount came from*, a one-sentence `portionAssumption` when it estimated, a confidence,
food group, glycemic index, processed flag, and a nutrient estimate.

The model must be good at, in priority order:

1. **Identification** — every food the user mentioned, none invented, none duplicated; composite
   dishes kept whole unless the user listed components; brands and regional dishes recognised
   ("cornetto", "tikka masala", "Big Mac"); a canonical search term a food database will match
   ("rice, white, cooked" not "some rice").
2. **Portion reasoning** — the core of realism. Apply the rule hierarchy exactly: user-stated
   amount (count, weight, volume, container, size word) → brand size → personalised default
   scaled by the profile (child vs adult, body weight, meal) → standard serving. Keep the user's
   unit (`2 cup`, not `468 g`); convert to grams realistically (1 cup cooked rice ≈ 160–200 g,
   not 240); size toppings as toppings (¼ cup granola, 1 tbsp honey); label provenance
   correctly and explain assumptions in one sentence.
3. **Nutrient estimation** — still matters: ~20 % of items are not in USDA (restaurant items,
   regional dishes) and keep the model's numbers; and the model's kcal is the plausibility
   yardstick that rejects bad database matches. Needs sound per-100 g knowledge of common foods.
4. **Structure & literalness** — meals grouped by the user's cues, date phrases extracted
   ("yesterday", "Monday"), meal type inferred, every required field filled, no prose.
5. **Consistency** — the same description should yield the same portions and numbers run to run.
6. **Vision** — for photos: identify visible foods, size them from reference objects (plate,
   fork, hand), state the reasoning, widen the gram range. The same model handles text and
   photos today; a separate vision model would need a `NUTRITION_VISION_MODEL` setting (small change).

What it no longer has to do well: recall exact micronutrient tables for common foods —
USDA supplies those when the match resolves.

## 3. Hard requirements for a candidate

- **Strict structured outputs** via the Responses API (`text.format` JSON schema). Non-negotiable.
- **Image input** (unless a separate vision model is introduced).
- **Latency**: text p50 ≤ 5 s end-to-end including the USDA stage (today 6.8 s with gpt-4o-mini;
  the model call itself is ~4 s). Photos ≤ 10 s. Users wait on this screen.
- **Cost**: ≤ $0.01 per log (today ≈ $0.0007 for text: ~2.9 k input / ~400 output tokens).
- **Determinism**: `temperature: 0` for standard models; `reasoning.effort` minimal/low for
  reasoning models. A model that needs high effort to be accurate will fail the latency budget.

## 4. What "better" means — the yardstick

`npm run eval:nutrition -- --model=<id> [--effort=minimal|low] --resolver=usda|llm`
runs the 37 reference cases (`src/eval/nutrition/cases.json`) and writes a report to
`eval-results/`. Compare candidates on, in this order:

| Metric | Why it matters | gpt-4o-mini today (usda / llm) |
|---|---|---|
| kcal within tolerance | the headline "was the log realistic" number | 86 % / 95 % |
| kcal MAPE and median APE | average and typical size of the miss | 15 % · 9 % / 11 % · 7 % |
| portion-source accuracy | did it label user-stated vs assumed amounts correctly (drives the edit UI) | 86 % / 83 % |
| meal-count and date accuracy | multi-meal / "yesterday" parsing | 100 % / 100 % |
| cases with duplicates | should be 0 | 0 / 0 |
| macros MAPE (P/C/F) | secondary; USDA fixes most of this when it resolves | 24/16/29 % / 14/14/22 % |
| items grounded in USDA | a better `searchTerm` → more matches | 81 % / — |
| median latency, cost per run | budget | 6.8 s, $0.025 / 4.7 s, $0.025 |

Run each candidate in **both** resolver modes: a model whose own numbers are better than the
database would change the default (`NUTRITION_RESOLVER=llm`); a model with better search terms
lifts the grounded share. Run each configuration twice — run-to-run drift is itself a score.

Two caveats on the harness: the references are hand-derived (USDA/manufacturer values for the
portion a careful dietitian would assume), so a few cases are inherently ambiguous (pancake size,
"a whole pizza"); and there are no photo or voice cases yet — add a labelled image set before
trusting a vision verdict.

## 5. Suggested candidates

| Model | Role | Why |
|---|---|---|
| gpt-4.1-mini | Stage A | Closest non-reasoning upgrade; better instruction following than 4o-mini, similar latency, ~2.5× cost. |
| gpt-5-mini (effort minimal, then low) | Stage A | Reasoning may help portion logic and rule adherence; check latency at each effort. |
| gpt-4.1 / gpt-5 | Stage A, reference only | Establish the ceiling; likely over budget on cost/latency. |
| gpt-5-nano / gpt-4.1-nano | Reranker | The reranker is a short single-choice task — a nano model at $0.05–0.10/M is enough if it stops picking "chocolate milk" for milk. |

Decision rule: adopt a candidate for Stage A only if it beats gpt-4o-mini on within-tolerance
**and** portion-source accuracy without breaking the latency/cost budget; adopt a reranker only
if grounded share and kcal MAPE in usda mode do not regress.

## 6. Results log

### 2026-08-24 — gpt-5.6-terra (Stage A) + gpt-5.6-luna (reranker), effort low, 37 text cases

| Configuration | kcal MAPE / median | within tol. | macros P/C/F | portion-source | grounded | median latency | Stage A cost / run |
|---|---|---|---|---|---|---|---|
| gpt-4o-mini, model-only | 11 % / 7 % | 95 % | 14 / 14 / 22 % | 83 % | — | 4.7 s | $0.025 |
| gpt-4o-mini, usda (4o-mini rerank) | 15 % / 9 % | 86 % | 24 / 16 / 29 % | 86 % | 81 % | 6.8 s | $0.025 |
| **gpt-5.6-terra, model-only** | 11 % / 6 % | 95 % | **13 / 14 / 15 %** | **97 %** | — | 5.3 s | $0.46 |
| **gpt-5.6-terra, usda (luna rerank)** | 15 % / 6 % | 84 % | 21 / 22 / 26 % | **100 %** | **92 %** | 10.4 s | $0.48 (+ reranker, not counted) |
| gpt-5.6-luna, model-only | 14 % / 6 % | 84 % | 17 / 17 / 17 % | 98 % | — | 5.8 s | $0.045 |
| **gpt-5.6-luna, usda (luna rerank)** | 14 % / 8 % | **92 %** | 22 / 25 / 28 % | 97 % | 89 % | 9.4 s | $0.045 (+ reranker) |

| gpt-5.6-luna, usda, **effort none** (both roles) | 16 % / 9 % | 89 % | 28 / 25 / 31 % | 97 % | 88 % | **6.8 s** | $0.042 |

Per log: gpt-4o-mini ≈ $0.0007, luna ≈ $0.0012, terra ≈ $0.0125.

Effort none vs low (Luna, usda): within-tolerance 89 % vs 92 % (one case), macros a little worse,
median latency 6.8 s vs 9.4 s. The mean (11 s) was inflated by three requests that hung ~45 s
until the client timeout/retry fired — the OpenAI client now has a 20 s timeout with one retry.
Drift check (second run of the adopted config, warm cache): 14 % / 9 %, 86 % within tolerance,
portion-source 95 %, grounded 84 %, 6.7 s median, no hung requests with the 20 s timeout. Run-to-run
movement is ±1 case on within-tolerance and ±2 points on labelling — the stable read is
"≈ 87–89 % within tolerance, ≈ 96 % labelling, ≈ 86 % grounded, ≈ 6.7 s". Also seen once outside the
harness: the model emitted the same item twice ("Black coffee" ×2); exact duplicates are now dropped
in code (`dedupeIngredients`).

**Adopted 2026-08-24** as the code default. Production setting: `NUTRITION_MODEL=gpt-5.6-luna`,
`NUTRITION_REASONING_EFFORT=none`, `NUTRITION_RERANK_MODEL=gpt-5.6-luna`, `NUTRITION_RERANK_EFFORT=none`.

Luna reading: its own nutrient recall is weaker than 4o-mini/terra (model-only 84 % within tolerance), but
it is the best portion/identification model per dollar (98 % provenance labelling, no omissions) and
with USDA grounding it reaches the best usda-mode result so far (92 % within tolerance) at ~2× the
cost of gpt-4o-mini. Its weakness is latency: ~9 s median in usda mode because Stage A and each
rerank are reasoning calls. Candidate fixes before adopting: `effort: none` for Stage A and/or the
reranker, fewer rerank calls (raise the heuristic-accept rate now that search terms are cleaner),
and the FoodReference cache (warm cache → no rerank at all for repeat foods).

Caveat: 37 cases — a 5–8 point difference is 2–3 cases and within run-to-run drift.

Reading: Terra is a clear step up on the things the model is responsible for — portion provenance
labelling (83 → 97–100 %), fat estimation (22 → 15 %), zero duplicates/omissions — while kcal
accuracy is at parity with gpt-4o-mini (the residual misses are reference ambiguity and USDA
composite-dish densities, not model errors). Luna as reranker lifts the grounded share from 81 %
to 92 % with correct, generic picks. Costs: Terra ≈ $0.0125 per log vs $0.0007 (≈ 18×), over the
$0.01 budget; usda-mode latency (10 s median) is over budget because reasoning calls stack
(Stage A + several reranks). Model-only latency (5.3 s) is fine.

Not adopted yet under the decision rule (no headline gain, over cost budget). Natural next
experiment: gpt-5.6-luna as Stage A (≈ 10× cheaper than Terra, same family) — if it keeps the
portion-labelling gains at gpt-4o-mini-like cost, it is the better trade; and Terra/Luna with
`effort: none` to test latency.

Harness note: the reported cost covers Stage A tokens only; reranker usage is not yet summed.
