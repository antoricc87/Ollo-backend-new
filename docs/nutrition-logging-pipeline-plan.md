# Nutrition logging — pipeline redesign plan

Status: v1 — 2026-08-24. **Phases 0–4 applied 2026-08-24** (bug fixes, unified `analyzeMeal`, USDA resolver, per-ingredient persistence + editable portions, model bake-off → gpt-5.6-luna adopted), not yet deployed. Model selection deliberately deferred (Phase 4).

## 1. Goal

Make every logged meal as realistic as possible:

- Portion estimates that are explicit, personalized, and correctable.
- Nutrient values that come from a reference database whenever possible, not from model recall.
- Deterministic, auditable numbers (same input → same output; every number has a `source`).
- One code path for all four entry points (text, photo, voice, chat agent).

## 2. Current pipeline (for reference)

```
text/photo/voice/agent ──► gpt-4o-mini (one prompt does everything:
                           identify + portion + 18 nutrients + GI + warnings)
                       ──► client/agent sums ingredients
                       ──► ONE FoodEntry row, quantity "1", ingredients discarded
```

Four near-duplicate prompt/functions in `openai.model.ts` (`getOpenAiCaloriesCalculator`,
`calculateMultipleMealsCaloriesAndNutrients`, `getCaloriesFromImage`, `getCaloriesFromAudio`)
plus `generatePortionsFromAI` in `nutrition.model.ts`.

## 3. Target architecture: three stages behind one service

```
                    ┌─────────────────────────────────────────────────┐
 text ─────────────►│                                                 │
 photo ────────────►│  analyzeMeal({ input, patientId, opts })        │
 voice ─► STT ─────►│                                                 │
 agent LogMealTool ►│                                                 │
                    └───────┬───────────────┬───────────────┬─────────┘
                            ▼               ▼               ▼
                     A. IDENTIFY       B. RESOLVE       C. COMPOSE
                     (LLM, structured) (deterministic)  (code)
                     what + how much   nutrients/100g   totals, GL,
                     in grams          × grams          servings, warnings
```

### Stage A — Identify & portion (LLM, structured output)

Input: text (or transcript, or image + optional caption) + **patient context** (age, gender,
weight, height, meal-type hint, unit locale).

Output per meal: `mealName`, `mealType`, `mealDate`; per item:

| field | notes |
|---|---|
| `name` | display name, no quantity |
| `searchTerm` | canonical DB-friendly term ("rice, white, cooked") |
| `brand` | if user named one |
| `quantity`, `unit` | as the user said it, or the assumed one |
| `grams` | model's best estimate of edible weight |
| `gramsRange` | `[low, high]` — drives the "tap to adjust" UI |
| `portionSource` | `user` \| `assumed` — never silently assume |
| `confidence` | 0–1 |
| `glycemicIndex` | keep here for now (Stage B may override from table) |
| `isProcessed`, `foodGroup` | for servings / processed count |

Portion rules (in this priority):

1. **User said it** ("2 eggs", "a big bowl", "half a pizza") → use it, `portionSource: user`.
   Descriptive sizes map to explicit multipliers (small ×0.7, large ×1.4, "big bowl" ~1.5 cup…).
2. **Brand/menu knowledge** ("a Big Mac", "a Starbucks grande latte") → the known unit.
3. **Personalized default**: reference serving scaled by profile — child vs adult, meal type
   (dinner protein larger than breakfast), body weight. This is the answer to "what if no
   amount is given": we do not guess a generic serving, we compute a *plausible one for this
   person* and flag it as assumed.
4. **Standard serving** (FNDDS/USDA reference portion) as last resort.

Photo path extras: the prompt asks for explicit reasoning about reference objects (plate ≈ 27 cm,
fork, hand); image is downscaled client-side (~1024 px) before upload; `gramsRange` widened.

Stage A does **not** output nutrients. This is the single biggest change — it stops
compounding portion error with recall error.

### Stage B — Resolve nutrients (deterministic)

For each item: `searchTerm` → **food reference lookup** → per-100 g nutrient vector × `grams`.

Sources, in order:

1. **Local cache table `FoodReference`** (name/alias → fdcId, per-100 g nutrients, standard
   portion weights). Grows with every resolved item; most lookups become free.
2. **USDA FoodData Central** (free, CC0, 1 000 req/h). Type preference: Foundation → SR Legacy
   → Survey (FNDDS, good for mixed dishes like "lasagna") → Branded only if a brand was named.
   A tiny LLM reranker call picks the best of the top-N candidates (or plain string scoring
   first; escalate only on low score).
3. **LLM estimate fallback** (`nutrientSource: llm`) for dishes with no match — restaurant items,
   regional dishes. Optionally decompose into ingredients first, resolve each.

Every item carries `nutrientSource: reference | llm` and `fdcId` so numbers are auditable.

Open question: USDA is US-centric. For EU/Italian branded products, **Open Food Facts** as a
second branded source is worth considering (also free). Decide in Phase 2.

### Stage C — Compose (code, no LLM)

- Sum ingredients per meal; compute glycemic load `Σ GI × carbs / 100` **server-side** (today
  the app does it and the agent path skips it).
- Fruit/vegetable servings from `foodGroup` + grams (½ cup cooked ≈ 80 g, 1 cup raw ≈ 90 g…).
- **Condition warnings as rules in code** — the thresholds already live in the prompt
  (sugar > 15 g for diabetes, sodium > 600 mg for hypertension…). Moving them to code makes
  them consistent and testable; the LLM can still phrase the message if we want, but the
  trigger is deterministic.
- Return the **existing `meals[] → ingredients[]` shape** so the app and agent keep working,
  plus the new fields (`grams`, `gramsRange`, `portionSource`, `nutrientSource`, `per100g`).

### Editing & persistence

- Client receives `per100g` for each item → changing the quantity recomputes locally, no
  round-trip. New UI affordance: tap the quantity (currently read-only) to adjust; assumed
  portions are visually marked.
- **Persist ingredients.** Keep `FoodEntry` as the meal-level row (every dashboard reads it) and
  add a child table `MealIngredient` (`foodEntryId`, `name`, `grams`, `quantity`, `unit`,
  `fdcId`, `portionSource`, `nutrientSource`, per-item nutrients). Nothing that exists
  breaks; favorites and "re-log this" become exact.
- Agent path uses the same service and the same persistence.

### Determinism

`temperature: 0`, fixed `seed`, strict structured output schema (not the loose tool-call
schema). Stage B is pure code. Golden-file tests over ~30 descriptions guard regressions.

## 4. Bug fixes (independent of the redesign — do first)

| # | Bug | Where | Fix |
|---|---|---|---|
| 1 | Vitamin D and B12 requested "in mg" — real values are µg; numbers are 1000× off or the model quietly returns µg | `openai.model.ts` prompts, `generatePortionsFromAI`, `generateNutrientsTotalAmount` | Decide one unit convention per nutrient (µg for D, B12; mg for the rest), encode in schema field descriptions, and check dashboard targets/display use the same |
| 2 | Mobile save drops `vitaminC`, `vitaminE`, `vitaminB12` | `loggingscreen.tsx` ~260–275 | Include them (or build the nutrients object from a shared key list) |
| 3 | No `temperature` on any estimator call → non-reproducible numbers | all calorie functions | `temperature: 0` |
| 4 | Processed-food count precedence bug: `acc + entry.isProcessedFood ? 1 : 0` evaluates as `(acc + x) ? 1 : 0` → total is always 0/1 | `calories.model.ts` createFoodEntry | `acc + (entry.isProcessedFood ? 1 : 0)` |
| 5 | Agent-logged meals always get `glycemicLoad: 0` (`entry.glycemicLoad \|\| 0`, but LLM never returns it; GL only computed client-side) | `nutrition.tools.ts` ~655 | Compute GL server-side (Stage C) |
| 6 | Audio uses a fixed temp path `temp-audio-file.raw` in `__dirname` → concurrent requests clobber each other, and it writes into the build dir | `getCaloriesFromAudio` | `os.tmpdir()` + unique name, `finally` cleanup; or send the buffer directly |
| 7 | Photo sent at full camera resolution, no `detail` param | `loggingscreen.tsx:226`, `getCaloriesFromImage` | Done: `quality: 0.6` + `detail: "high"`. True resize needs `expo-image-manipulator` (native rebuild) — deferred to Phase 1 |
| 8 | `FavMeal.userId` is `@unique` → schema allows one favorite per user; second `createFavMeal` will fail with a unique-constraint error (no `migrations/` dir, so this is whatever `db push` applied — confirm on the Railway DB) | `schema.prisma` | Drop `@unique`, add `@@index([userId])` |
| 9 | Favorites "ingredients" are the meal-level `FoodEntry` rows (quantity "1"), not real ingredients — re-logging a favorite can't be adjusted | `nutrition.model.ts:827` | Resolved by Phase 3 (`MealIngredient`) |
| 10 | Four copies of the same prompt drifting apart | `openai.model.ts` | Collapsed by Phase 1 |

## 5. Phasing

| Phase | Scope | Outcome |
|---|---|---|
| 0 | Bug fixes 1–8 | Safe to ship immediately; no behavior redesign |
| 1 | `analyzeMeal` service: unify four paths, structured output, portion rules + patient context, temperature 0, warnings in code. Response shape unchanged. **Build the eval harness** (30–50 real descriptions/photos with hand-checked answers). | Same product, better and reproducible estimates; a yardstick for every later change |
| 2 | Stage B: `FoodReference` cache + USDA resolver + LLM fallback + `nutrientSource` flags | Nutrients grounded in reference data |
| 3 | `MealIngredient` persistence + editable portions in the app + favorites with ingredients | Users can correct assumed portions; corrections are saved |
| 4 | **Model selection** — run the Phase-1 harness across candidate models for Stage A (text and vision separately) and the reranker; pick on accuracy/latency/cost | Evidence-based choice rather than a guess |

## 6. Phase 1 — what was built (2026-08-24)

- `src/services/meal_analysis/` — `mealAnalysis.schema.ts` (strict zod schema for structured output), `mealAnalysis.prompt.ts` (portion rules + worked examples), `mealAnalysis.rules.ts` (code-side warnings, servings, glycemic load, normalisation), `mealAnalysis.service.ts` (`analyzeMeal`, patient-context loader, legacy shape adapters), `tests/` (16 jest tests).
- `openai.model.ts`: the four calorie functions are now thin wrappers over `analyzeMeal`; the old prompts live in `openAI/model/legacy/calories.legacy.ts` and are selected with `MEAL_ANALYSIS_ENGINE=legacy`.
- Env: `NUTRITION_MODEL` (default `gpt-4o-mini`), `NUTRITION_REASONING_EFFORT` (reasoning models only), `MEAL_ANALYSIS_ENGINE`.
- Every ingredient now carries `grams`, `gramsLow/High`, `portionSource` (`user | brand | personalized_default | standard_serving`), `portionAssumption`, `confidence`, `foodGroup`, `searchTerm`, `brand`; the single-meal response adds `portionAssumptions[]` for the UI. Nutrients gain `saturatedFats` (not persisted yet).
- Eval harness: `npm run eval:nutrition -- --model=<id> [--effort=] [--filter=] [--concurrency=]` over `src/eval/nutrition/cases.json` (37 text cases, USDA/manufacturer references), reports to `eval-results/`.
- Mobile: photos are downscaled to 1024 px with `expo-image-manipulator` before upload (needs a native rebuild).

Baseline on gpt-4o-mini (text cases): kcal MAPE 14 %, median APE 6 %, 86 % within tolerance; macros MAPE P 14 % / C 21 % / F 24 %; portion-source accuracy 88 %; meal/date detection 100 %; ~5 s median latency; ~$0.02 per full run. Biggest remaining misses are nutrient recall for composite foods (granola bowls, whole pizzas) → Phase 2.

Not yet in the harness: photo cases (need a small labelled image set) and voice transcripts.

## 7. Phase 2 — what was built (2026-08-24)

- `src/services/meal_analysis/resolver/` — `foodResolver.types.ts` (adapter interface: `search`, `portions`, `isCoolingDown`), `usdaFdc.resolver.ts` (FoodData Central adapter; POST search with data-type filter, detail call only for household portions; 429/5xx → 60 s/30 s cooldown), `usdaNutrients.ts` (FDC nutrient ids → Ollo fields with unit conversion, omega-3 = ALA+EPA+DPA+DHA, vitamin D IU→µg), `matchScoring.ts` (token coverage − narrowing-qualifier penalties + data-type preference; plausibility band 0.4–2.5× vs the model's own kcal), `portionMatching.ts` (household unit → reference gram weight), `foodReference.repository.ts` (Prisma cache), `nutrientResolution.ts` (orchestration).
- Prisma: `FoodReference` (per-100 g vector + portions per source id) and `FoodReferenceAlias` (normalised term+brand → reference; null = negative cache, 7-day TTL).
- Flow per ingredient: cache → search (Foundation/SR Legacy/Survey; Survey first for mixed dishes; Branded only when a brand was named) → deterministic ranking → LLM rerank (gpt-4o-mini, top 6) only when the top score is < 0.55, not clearly ahead, or implausible → plausibility check → reference-portion correction when the model's grams differ > 25 % from the USDA household weight → nutrients = per-100 g × grams.
- Every ingredient now carries `nutrientSource` (`usda | llm`), `reference` (source, id, data type, description), `per100g` (for client-side rescaling in Phase 3) and `resolution` (method, reason, match score, portion note). Legacy shapes pass these through.
- Env: `USDA_FDC_API_KEY` (free, https://fdc.nal.usda.gov/api-key-signup; without it DEMO_KEY = 30 req/h), `NUTRITION_RESOLVER` = `usda` (default) | `llm`, `NUTRITION_RERANK_MODEL` (default gpt-4o-mini).
- Eval: `--resolver=usda|llm` and a "nutrients from USDA" share in the summary.
- Finding: FDC's Branded set is packaged retail goods; restaurant/fast-food menu items ("Big Mac") do not resolve there and keep the model's published-value estimate (`reason: brand_not_in_db`). FNDDS generic fast-food entries ("Cheeseburger, from fast food") still cover unbranded cases.

Verified: unit tests (30), live smoke — eggs/rice/banana all grounded in USDA with correct kcal; cache hits resolve even while the provider is rate-limited.

**Eval results (gpt-4o-mini, 37 text cases, 2026-08-24):**

| | model-only (`--resolver=llm`) | USDA-grounded (`--resolver=usda`) |
|---|---|---|
| kcal MAPE / median APE | 11 % / 7 % | 15 % / 9 % |
| within tolerance | 95 % | 86 % |
| macros MAPE P / C / F | 14 / 14 / 22 % | 24 / 16 / 29 % |
| items grounded in USDA | — | 81 % |
| median latency | 4.7 s | 6.8 s |

Grounding started at 30 % MAPE; three rounds of fixes (heuristic accept only on exact coverage, plausibility 0.5–2× judged after the portion correction, portion overrides only when the label names the food and stays within 2×, Branded search only when a brand was named, household units preserved in the model output) brought it to 15 %. What remains is mostly ambiguity in the reference cases themselves (pancake size, cheeseburger style, "a whole pizza") rather than database error, and the model-only estimate for common foods is competitive because gpt-4o-mini's recall for everyday items is decent.

Decision (proposed): keep `NUTRITION_RESOLVER=usda` as the default anyway — every grounded number is auditable (`reference`, `per100g`), deterministic across runs, and `per100g` is what Phase 3's portion editing needs; the model-only mode stays one env var away. Revisit the comparison once the harness has (a) weighed-meal references instead of hand-derived ones and (b) photo cases, and again in Phase 4 with stronger models, where recall-vs-database may flip.

Known gaps: restaurant/menu items are not in FDC (kept as model estimates, `brand_item_no_reference`); FNDDS densities for fast-food composites (cheeseburger NFS ≈ 296 kcal/100 g) run higher than chain-published values.

## 8. Phase 3 — what was built (2026-08-24)

- Prisma `MealIngredient` (child of `FoodEntry`, cascade delete): name, search term, brand, quantity + unit, grams (+ range), portion provenance, confidence, food group, GI, calories, nutrients JSON, `per100g`, nutrient source and reference. `FoodEntry` stays the meal-level row every dashboard reads; **its totals are recomputed from the ingredient rows** whenever they are present (`totalsFromIngredients`).
- `createFoodEntry` accepts `entries[].ingredients[]` in either the analysis shape (`description`, `"2 slices"`, `measurementUnit`…) or the row shape; `normalizeIngredientInput` handles both. Reads (`getFoodTracker`) include ingredients.
- New endpoint `PUT /api/nutrition/update_food_entry_ingredients { entryId, ingredients, timeZone }` → replaces the rows, recomputes totals, moves daily/weekly calorie + nutrient trackers by the signed difference (verified: +150/+15 on create, +100/+20 on edit, −250/−35 on delete).
- Favorites: `fetchFavMeals` (app) and both agent lookups include the linked entries' ingredient rows; re-logging a favorite (app `FavoriteMeal.tsx`, agent `logFavoriteMeal`) copies them, so favorites are exact.
- Agent `LogMealTool` passes the analysis ingredients on all three regular/mixed paths.
- App: `loggingscreen` sends `ingredients`; `GeneratedMeal` shows grams, marks assumed portions (dashed amber pill + the assumption sentence, "N portions assumed — tap to adjust"), and lets the user tap a portion to type or step it; the item rescales linearly client-side and becomes `portionSource: user`. `updateFoodEntryIngredients` hook added for post-log edits.
- Tests: 6 for the ingredient helpers (36 total across phases); typecheck clean; live smoke on the local DB for create → edit → read → delete.

Deferred: an edit screen for *already logged* entries (endpoint + hook exist; the logged-meals list currently only deletes), and ingredient rows for the portion-calculator / meal-generator save paths.

## 9. Phase 4 — model bake-off outcome (2026-08-24)

Full results and reasoning in `nutrition-model-bakeoff-brief.md` §6. Outcome: **gpt-5.6-luna at
`reasoning.effort: none` for both Stage A and the reranker, USDA grounding on**, is now the code
default (`mealAnalysis.service.ts`, `modelParams.ts`, `nutrientResolution.ts`) and is written into
the local `.env`. Versus gpt-4o-mini: portion labelling 86 → 97 %, grounded 81 → 88 %,
within-tolerance 86 → 89 %, equal median latency (6.8 s cold cache), ≈ 1.7× cost (≈ $0.0011/log).
gpt-5.6-terra was best on the model-owned metrics but ≈ 18× the cost for kcal parity.
Robustness added along the way: OpenAI client 20 s timeout + 1 retry; USDA adapter one retry
then a 10 s cooldown; search-term sanitising; `none`/`minimal` effort mapping per model family.

Open: a drift run of the adopted config, and a labelled photo set for the vision path.

## 10. Decisions needed

Decided 2026-08-24: USDA-only behind a resolver interface (Open Food Facts later if brand misses show up); vitamin units handled at display time, history before cutover treated as unreliable; warnings fully templated from code triggers; ingredients persisted as a `MealIngredient` child table.
