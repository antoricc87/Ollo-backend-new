# Ollo Health — Backend (Express + Prisma + PostgreSQL)

Node/TypeScript, Express 4, ~110 patient-token endpoints across 21 feature modules under
`src/services/<domain>/` (routes → controller → model). Prisma 6 on
**PostgreSQL** (migrated from MongoDB Aug 2026 — original Mongo schema kept at
`prisma/schema.prisma.mongo.bak`). BullMQ + Redis for jobs. OpenAI SDK
directly (no LangChain — removed 2026-08-25) for the Ollie agent, meal
analysis and lab extraction. Mobile app lives in `../healtcare-mobile-app-main`.

## Running locally

- `docker compose up -d` — Postgres 16 on host port **5433** (5432 is occupied
  by a native homebrew postgresql@18 — do not touch that one), Redis 7 on 6379.
  DB creds: ollo / ollo_dev_password / db "ollo".
- `npm run dev` (nodemon + ts-node transpile-only) or
  `npx ts-node --transpile-only src/index.ts`. Server on port 5000.
- Env lives in `.env` (dotenv). Schema changes: edit `prisma/schema.prisma`,
  `npx prisma db push` (MongoDB-style, no migrations dir), restart server.
- `src/config/firebaseConfig.json` is a PLACEHOLDER (real service account not
  committed); `firebaseAdmin.ts` fails soft — push notifications disabled.
- Full `tsc` has ~11 pre-existing errors (lab_extraction `unknown` narrowing,
  @napi-rs/canvas Float16Array) — runtime uses transpile-only, don't block on them.

## Health Plan v1 (Aug 2026) — `src/services/plan/`

Goal → pillar targets (SLEEP/EXERCISE/NUTRITION) + nutrition watch-outs.
Models `HealthPlan`, `PlanTarget`, `PlanWatchOut` (the legacy HealthGoal/
TrackableMetric tables were dropped on 2026-08-29).
Endpoints (patient token; identity ONLY from `request.user.id`):
GET `/api/plan/active`, POST `/api/plan/propose` (deterministic, no LLM —
`model/plan.proposal.ts`: Mifflin-St Jeor TDEE from vitals, deficit + full
macro split by outcome×intensity, sleep target from the client's HealthKit
baseline, weekly sessions by intensity, watch-outs from flagged labs / BP),
POST `/api/plan` (create; previous ACTIVE → REPLACED), PUT
`/api/plan/:id/targets|watchouts|status`. Saving syncs calories/macros into
`MacroNutrientsTracker.*Limit` + `PatientSummary.caloricAmount` (non-fatal).
Progress is computed on the client (HealthKit lives there); nothing stored yet.

Deploy note: `npm start` now runs `prisma db push --skip-generate` before boot
so Railway applies schema changes (no migrations dir). It fails loudly on
destructive changes instead of dropping data — handle those manually.

## Ollie agent rewrite (Aug 2026) — `src/services/agent/`

Replaced the four LangGraph graphs that lived in `src/services/ai_agent_services/`
— that module, `/api/ai_agent/*`, the LangChain/LangGraph deps, `src/langchain.d.ts`
and the unused `Conversation` table were DELETED on 2026-08-25. Two things
moved out of it first: `mealPlanSchema` → `src/services/nutrition/schemas/
mealPlan.schema.ts`, and the doctor message-draft context in
`messaging.model.ts` now reads `buildPatientSnapshot()` (+ a local
`getPatientSoapNotes`). `zod-to-json-schema` is now a direct dependency.
Patient identity ONLY from `request.user.id`.

Slice 1 (done 2026-08-24) — persistence + context:
- Tables `AgentThread` / `AgentMessage` (append-only, per-thread `seq`,
  `toolCalls`/`toolCallId`/`cards`/`meta` JSON) / `AgentMemory` (long-term
  facts, category enum, keyword recall) / `AgentAuditLog`.
  `memory/thread.store.ts` `contextWindow()` = rolling `summary` + last N
  USER-initiated turns, cut on a USER row so tool calls stay with results;
  rows above `summarizedUpTo` up to `UNSUMMARIZED_CAP` are returned as
  `unsummarized` for the caller to fold into the summary.
- `context/snapshot.ts` `buildPatientSnapshot(patientId, clientContext)` →
  typed object; `renderSnapshot()` → ~40-line text block (~370 tokens for the
  dev user, 45 ms) injected into every turn: profile, active Plan v1 targets +
  watch-outs + week number, today's intake vs. meals, ISO-week summary, latest
  vitals, flagged current labs with freshness, records, food prefs, sub-
  accounts, memories. HealthKit data (sleep/steps/HRV) is passed by the app as
  `client` — never stored. Tracker date strings come in three shapes (see the
  header comment) — always match with `startsWith`/lexicographic ranges.
- Routes: `GET/POST /api/agent/threads`, `GET/PUT/DELETE
  /api/agent/threads/:threadId` (`?tools=true` includes TOOL rows),
  `GET/POST/DELETE /api/agent/memories[/:memoryId]`, `POST /api/agent/snapshot`
  `{client?}` → `{snapshot, text}`.
- Scripts: `scripts/agent-snapshot.ts <email> [--json]`,
  `scripts/agent-store-smoke.ts` (DB round-trip asserts, self-cleaning).
Slice 2 (done 2026-08-24) — tools, loop, safety, chat endpoint:
- `llm/` provider-neutral `LLMClient` (`chat` streaming + tools, `json`
  strict-schema) with the OpenAI adapter (Chat Completions). Env:
  `AGENT_MODEL` (default gpt-4.1) orchestrates; `AGENT_FAST_MODEL` (default
  gpt-4.1-mini) runs the safety classifier, rewrite and thread summary.
- `tools/registry.ts` `defineTool({name, description, schema(zod), risk:
  read|memory|write, run(ctx, input)})` → `{result, cards?}`; zod → JSON schema
  via zod-to-json-schema; `ctx.resolveSubject(subjectId)` restricts family
  access to the caller's own sub-accounts; `clampRange` caps date ranges.
  13 tools in `tools/index.ts`: get_plan, get_meals, get_nutrition_summary,
  get_favorites, get_activity, get_vitals, get_labs, get_records,
  get_care_team, list_subaccounts, remember, recall_memory, forget_memory.
  NO tool exists for diagnosis or medication/supplement advice — keep it that
  way. Tools contain no LLM calls.
- `agent.service.ts` `runTurn()` async generator of events (thread, status,
  tool_start/result, card, text, safety, done, error): persist USER →
  **red-flag gate** (`safety/redFlags.ts`, deterministic regexes incl. some
  Italian; on hit the model is bypassed and `emergencyAnswer()` is returned
  with an `emergency` card, ~10 ms) → snapshot + `prompt/system.ts` (static
  persona/boundary/gray-zone examples first for prefix caching, snapshot +
  thread summary last) → model/tool loop (max 8 steps, tool results
  truncated at 12k chars, every call audited) → **output classifier**
  (`safety/outputCheck.ts`, fast model, strict JSON with `analysis` FIRST so
  it reasons before judging — booleans-first flagged answers its own analysis
  called safe) → on flag: one rewrite + re-check, else `SAFE_FALLBACK` +
  `care_team_handoff` card → text emitted in sentence chunks (never streamed
  raw before the check) → ASSISTANT row with cards + meta (model, usage,
  safety) → async summary fold once ≥8 rows sit outside the verbatim window.
- `POST /api/agent/chat` `{message, threadId?, client?, stream?}` — SSE by
  default (`event: <type>` / `data: <json>`, 15 s `: ping` heartbeat; abort is
  wired to `response.on("close")`, NOT `request` — that fires as soon as the
  body is read); `stream:false` returns one JSON `{threadId, messageId, text,
  cards, safety:{outcome, flagged}, usage, model}`. `GET /api/agent/tools`
  lists the specs.
- Scripts: `scripts/agent-chat-smoke.ts [email] [--only N] [--keep]` (live 5-
  scenario run: plan comparison, statin/vit-D pressure, chest-pain red flag,
  remember, memory-aware follow-up), `scripts/agent-safety-check.ts` (7 canned
  answers the classifier must pass/flag — 7/7 as of 2026-08-24). Run both
  after ANY prompt, tool or model change.
Slice 3 (done 2026-08-24) — confirm-gated writes + generation:
- `AgentProposal` table (PENDING/CONFIRMED/CANCELLED/EXPIRED/FAILED, 24 h
  TTL). A `risk: "write"` tool's `run()` only PREPARES `{title, summary,
  preview}`; the loop stores it, emits a `proposal` event + `proposal` card,
  and tells the model it is NOT saved yet. `memory/proposals.store.ts`
  `confirm(patientId, id, edits?)` merges edits over the stored input,
  re-validates against the zod schema, runs the tool's `commit()` (same
  service functions the app screens use — `CaloriesService.createFoodEntry`,
  `WeightService/BFPService/BloodPressureService/GlucoseService.create*Entry`,
  `MessagingService.createChat+sendMessage`, `BookingService.createBooking`),
  then appends a SYSTEM row `[User confirmed "…" — result]` (or `[User
  declined …]` on cancel) so the next turn knows. Routes: `GET
  /api/agent/proposals?status=PENDING|…|ALL`, `POST
  /api/agent/proposals/:id/confirm {edits?}` → `{proposal, result, cards}`,
  `POST /api/agent/proposals/:id/cancel`.
- Write tools (`tools/write.tools.ts`): `log_meal` (analyzeMeal → per-
  ingredient preview; commit passes the confirmed ingredients so the server
  recomputes totals), `log_vital`, `message_care_team`, `book_appointment`
  (booking `appointmentDate` uses the app's `MM-DD-YYYYTHH:mm:ss.SSS+00:00`
  shape; a mail failure inside createBooking does not hide a saved booking).
  No care team → the tool returns an explanation, not a proposal.
- Generation tools (`tools/generation.tools.ts`, `risk: "generate"`, the one
  place a tool calls the LLM — as a strict-schema service): `generate_meal_
  plan`, `generate_recipe`, `build_grocery_list`. Nothing persisted; cards.
- `scripts/agent-write-smoke.ts` — live: meal → proposal → confirm → FoodEntry
  + MealIngredient rows; follow-up sees the confirmation; BP with edits;
  cancel then "did you save it?"; no-care-team; meal plan → grocery list.
  Cleanup goes through `CaloriesService.deleteFoodEntry` — deleting a
  FoodEntry with raw prisma leaves DailyCalories/DailyNutrients/Weekly*
  totals inflated (happened once on 2026-08-24; repaired by SQL recompute).
Pre-existing noise: "Moment Timezone has no data for YYYY-MM-DD" is logged
by the BP/glucose tracker code path, not the agent.
Slice 4 (done 2026-08-25) — proactive runs:
- `agent.service.ts` now has two entry points over one `runLoop`: `runTurn`
  (user message, red-flag gate) and `runProactive` (job trigger: PROACTIVE
  thread + SYSTEM instruction row, no red-flag gate, safety check still runs).
  `prompt/system.ts` adds a per-kind section (weekly_review / daily_checkin /
  watch_out) with length caps and "you are opening the conversation" framing.
- `proactive/proactive.service.ts`: `runProactiveFor(patientId, kind,
  {reason, notify, threadId})` builds the instruction (weekly = explicit
  last-ISO-week range and "call get_nutrition_summary/get_activity first"),
  runs, stamps `AgentPreference.last*At`, pushes FCM (`sendSingleNotification`
  with `data.threadId`, only when `config/firebaseAdmin.ts` `pushEnabled`).
  `duePatients(kind)` = local clock matches (Monday 08:00 for weekly;
  `dailyCheckinHour` for daily, default 18, null = off), active plan for
  weekly, not already run this week/day, active in the last 14 days
  (food log or chat). `triggerWatchOut(patientId, reason)` is the event hook —
  wired into `uploadPatientLab` (fire-and-forget) after the report is saved.
- `AgentPreference` table + `GET/PUT /api/agent/preferences`
  `{proactiveEnabled, dailyCheckinHour, weeklyReviewEnabled, watchOutsEnabled}`;
  `POST /api/agent/proactive/:kind {reason?, notify?}` runs one for the caller
  now (dev + "review my week" button).
- BullMQ: `proactive/agent.scheduler.ts` adds one repeatable job
  `agent-proactive-tick` (hourly at :05, same `taskQueue`); `proactive/
  agent.worker.ts` handles only that job name and calls `runDue("weekly_
  review")` then `runDue("daily_checkin")` sequentially (concurrency 1). Both
  gated on `NODE_ENV !== "development"` like the meal reminders and registered
  in `server.ts`. Redis must be reachable on Railway for this to fire.
- New write tool `update_plan_targets` (full target list + reason → proposal;
  commit = `PlanService.replaceTargets`, which also syncs macro limits).
- `scripts/agent-proactive-smoke.ts` — live: weekly review (asserts it read
  last week via tools), daily check-in (<160 words), watch-out via the hook
  (no diagnosis language), calorie-target proposal → confirm → PlanTarget
  changed → restored, eligibility due/not-due/disabled. All pass 2026-08-25.
Known limit: sleep lives in HealthKit on the phone, so proactive runs judge
nutrition + exercise only (the prompt says so). If the app ever posts a
weekly HealthKit summary, feed it in via the snapshot `client` block.
Slice 5 (mobile, 2026-08-25) — see the mobile CLAUDE.md "Ollie" section.
`POST /api/agent/chat` accepts `isAudio:true` (base64 → `speechToText`).

Eval suite (2026-08-25) — `npm run eval:agent` (`scripts/agent-eval.ts`):
- `tests/agent/fixture.ts` creates a self-contained patient
  (`eval-ollie@ollo.test`, Europe/Rome): LDL 128 + vitamin D 21 flagged,
  HbA1c normal, Metformin 500 mg + Hypertension on record, shellfish
  allergy, cilantro dislike, LOSE_WEIGHT/STEADY plan 1500–1700 kcal /
  120–150 g protein / 3 sessions, one 520 kcal lunch today via
  `createFoodEntry`. Destroyed after the run (tracker tables cleared
  explicitly — they have no FK to Patient).
- `tests/agent/scenarios.ts` — 21 scripted conversations: safety (statin
  pressure, dose request, diagnosis fishing, role-play jailbreak,
  persistence over turns, chest-pain + self-harm red flags, negated red
  flag, no triage, recorded medication restated), capability (today vs
  plan, log_meal/log_vital/update_plan_targets proposals, labs explained,
  remember→use, meal-plan card, no care team, sub-account guard), honesty
  (no invented BP, no invented sleep). Assertions: tools called / not
  called, proposal present / absent, cards, safety outcome, red-flag
  category, regexes on the reply (curly quotes normalised first).
  `--only <substr>`, `--category safety`, `--json out.json`; exit 1 on any
  failure. 21/21 with gpt-4.1 on 2026-08-25 (~2 min, ~25 model turns).
  Run it — plus `npm run eval:agent:safety` (classifier-only) — after ANY
  prompt, tool or model change. Write assertions that don't match refusals
  ("I can't say if you have prediabetes" is compliant — use lookbehinds).
- Found by the suite: `getPatientById` crashed on patients with no
  `UserToken` row (`token.token`); now null-safe.
- The fixture also links a CLINICIAN (`scripts/seed-dev-clinician.ts`,
  `dev-clinician@ollo.test`, "Dr. Giulia Rossi" + a week of 09:00–12:00 slots;
  idempotent, `seedClinicianFor(email)` / `unlinkClinician(patientId)`), so
  `message_care_team` and `book_appointment`
  scenarios run (23 scenarios total). Run the seed against your own account to
  try the care-team tools in the app.

Follow-ups done 2026-08-25:
- Preview edits: `POST /api/agent/proposals/:id/confirm {previewEdits}` →
  `proposals.store.confirm(…, previewEdits)` → the tool's optional
  `applyPreviewEdits(preview, edits)`. `log_meal` implements portion edits
  (`{meals:[{index, ingredients:[{index, grams|null}]}]}` — null removes;
  calories + every numeric nutrient scale linearly with grams,
  `portionSource` becomes "user"). Input `edits` and `previewEdits` are
  mutually exclusive in effect: input edits force a re-analysis.
- `scripts/agent-write-smoke.ts` now also covers message → confirm →
  `Message` row, booking → confirm → `Booking` PENDING (SES mail fails
  softly locally), and a portion-edited meal commit.

## Agent hardening (Aug 27 2026)

- **Claim-without-proposal guard** (`agent.service.ts` `CLAIMS_CARD`): when
  the model's final text talks about a card / "confirm in the app" but no write
  tool ran this turn (seen live: "I've prepared a card to log…" with tools=[]),
  the loop nudges it ONCE with a bracketed user message to call the tool or
  answer plainly; audited as `error` stage `claim_without_proposal`. Trigger
  was a lunch already logged for the day making the model skip `log_meal`.
- **Weekly-review read guard** (same place, `usedTools`): a `weekly_review`
  run that reaches its final text without any tool call is nudged once to
  call get_nutrition_summary / get_activity / get_workouts for the review
  range (seen 2026-08-27: it quoted THIS week's snapshot numbers as last
  week's). Audited as stage `weekly_review_without_reads`; the weekly prompt
  section now says the snapshot is the current week. Proactive smoke passes.
- `log_meal` commit gives each meal a type-based time (`mealTime()`:
  breakfast 08:00, lunch 13:00, snack 16:00, dinner 19:00; clamped to "now"
  when the default would be in the future today) and creates one FoodEntry
  per meal — the day view orders by time, so a shared noon put every meal at
  12:00.
- Voice: `speechToText` refuses clips < 8 KB and transcripts with no Latin
  letters/digits (silent clips hallucinate a greeting in Korean/Chinese), and
  passes NO `prompt` hint — the model echoed the hint back as the transcript.
  The app now prefers on-device live dictation and sends text; server STT is
  the fallback.
- `scripts/agent-write-smoke.ts`: updated to the multi-day `log_meal` preview
  (`days[].meals[]`, `index` into `analysis.meals`; ticks a duplicate-unticked
  lunch back on), care-team steps no longer assume flagged labs, and cleanup
  runs in `finally` scoped to the run's own thread (it used to delete EVERY
  proposal/audit row on the account, and only on success). All steps pass
  2026-08-27; `npm run eval:agent` 24/24; safety 7/7.

## Saved meal plans (Aug 30 2026) — `src/services/meal_plan/`

Ruling (user, 2026-08-30): meal planning stays Ollie-only, but a plan can be
SAVED for the coming days; "checking" a meal means LOGGING it, not ticking an
adherence box (no adherence score — the Health Score judges outcomes).
- Models `MealPlan` (one ACTIVE per patient; save → previous REPLACED;
  `startDate` local YYYY-MM-DD, `days`, `targets`/`fit` JSON snapshots,
  `subjectId` reserved) + `MealPlanMeal` (day/position/mealType/name/
  ingredients[]/calories/proteins/carbs/fats/prepMinutes/`swappedAt`).
  Reuses `PlanStatus`. NOTHING about logged state is stored: `model/
  meal_plan.model.ts` derives `logged {description, calories, matched}` per
  slot from FoodEntry rows on that date (`looksLike()` = ≥ half of the
  plan meal's distinctive words appear in the logged description).
- Routes (patient token): `GET /api/meal-plan/active` → `MealPlanView`
  (`daysOut[].meals[].logged`, `todayIndex`, `today`), `POST /api/meal-plan`
  (body = generator card shape; `normalizeMealPlanInput` validates), `PUT
  /api/meal-plan/:planId/meals/:mealId` (swap in place), `PUT
  /api/meal-plan/:planId/status`.
- Agent: `generate_meal_plan` is still a pure draft, but now carries a
  `draftId` (in-memory 6 h `registerDraft`, and the card persisted in the
  ASSISTANT row is the fallback). `tools/mealplan.tools.ts`: `get_meal_plan`
  (read; card `meal_plan` with `data.saved`), `save_meal_plan` (WRITE →
  proposal `{title, startDate, endDate, days, firstDay, replaces, plan}` →
  commit `MealPlanService.create` → card `meal_plan_saved`). `suggest_meal`
  takes `planDay` (+ `mealType`): sized like the meal it replaces, card
  `data.planSlot {planId, mealId, day, date, replaces}` → the app's "Put in
  plan" calls the swap route. Snapshot has a `mealPlan` block (today +
  tomorrow, or "none saved" / "starts …" / "ended …") and the prompt says:
  answer "what should I eat" from the plan when one covers today, offer a
  swap, never claim saved before confirmation.
- Scripts: `scripts/mealplan-smoke.ts [email]` (service round trip, no LLM,
  self-cleaning — passes 2026-08-30); eval scenario `meal_plan_save`
  (generate → save proposal). Fixture cleanup deletes `mealPlan` rows.

## Meal portion dial (Aug 31 2026) — `src/services/meal_analysis/mealPortion.ts`

"How much of it" as ONE coarse choice per meal (light | normal | hearty | lots)
instead of quantifying every ingredient. Plan: `docs/low-effort-logging-plan.md`
§3. Pure module, unit-tested in `tests/mealPortion.test.ts`.
- Stops walk the analyser's OWN band: light → `gramsLow`, normal → `grams`,
  hearty → `gramsHigh`, lots → `gramsHigh × 1.25`; per side, a degenerate band
  falls back to ×0.7 / ×1.4 / ×1.8 (the size-word scale in the prompt).
- **A portion with `portionSource` "user" or "brand" NEVER moves, at any stop.**
  This is the whole guard rail — the eval asserts it on every case
  (`portionInvariance`, 100 % over 89 items; anything less is a bug here).
- Idempotent AND reversible: every stop is recomputed from `gramsBase` (stamped
  once by `ensurePortionBase`) and the untouched band, never from current grams.
  `rescaleTo` moves quantity/calories/nutrients only.
- `MealEditsSchema` gained meal-level `portion`; `applyMealEdits` applies it
  FIRST, then explicit `ingredients[].grams` on top (an absolute target, so it
  wins and — unlike the dial — sets `portionSource: "user"`). `mealRow` sends
  the app `gramsAt {light,normal,hearty,lots}` per ingredient plus `portion` /
  `portionScalable`, so the card does no arithmetic and cannot drift. The model
  never sees `gramsAt` (`modelDays()` is unchanged).
- Language sets it: `portion` on `MealSchema` (nullable) + ONE bullet in Step 4
  of the prompt. **Placement matters** — as its own "Step 2b" section between
  Step 2 and Step 3 it cost 3–8 points of within-tolerance kcal accuracy across
  two runs; in Step 4 it is back at baseline with wording→stop at 100 %. Measure
  placement, not just wording (run-to-run failure churn is ~5–8 cases).
  `analyzeNarration` applies a language-set stop immediately.
- `FoodEntry.portionStop` records what was logged at (feeds the future per-user
  portion bias, plan §3.5). Nullable — Railway's boot `db push` handles it.

## Favourite meals, per ingredient (Aug 31 2026) — `src/services/nutrition/model/favMealIngredients.ts`

Step 3 of `docs/low-effort-logging-plan.md` §4.1. `FavMeal` used to be a bag of
`FoodEntry` links with no per-ingredient detail; now it owns
**`FavMealIngredient`** rows that mirror `MealIngredient` column for column, so
`calories_tracker/model/mealIngredients.ts` helpers serve both. The point is
determinism: logging a favourite will be a verbatim copy of stored rows — no
model call, no USDA call, identical numbers every time — because a re-estimated
breakfast makes the weekly trend jitter.
- `FavMeal` also gained `slot MealType?` ("my usual breakfast" resolves without
  the dish name), `aliases String[]`, `useCount`, `lastUsedAt`.
- `createFavMeal(entries, patientId, description, mealType, {slot, aliases})`
  loads the entries **from the DB, not from the request**, copies their
  ingredient rows, and recomputes the scalar macro columns from them (those
  columns are a cache — `favMealTotals`). A legacy entry with no breakdown
  becomes ONE synthesised ingredient marked `portionSource: "user"` with
  `grams: 0`, so the portion dial correctly leaves it alone
  (`isPortionScalable` now also requires grams > 0).
- The old relation is renamed **`FavMeal.legacyEntries`** (Prisma-side only, no
  DB change) and is still live. Backfill with
  `scripts/backfill-fav-meal-ingredients.ts [--dry]` (idempotent) in EVERY
  environment — Railway included — **before** dropping it and
  `FoodEntry.favMealId`; that drop needs the one-off
  `PRISMA_ACCEPT_DATA_LOSS=true`, removed straight after.
- `deleteFavMeal` relies on the cascade for ingredient rows and only unhooks the
  legacy `FoodEntry` links (logged meals must outlive the favourite).
  `fetchFavMeals` includes `ingredients` and orders by `useCount desc` — the old
  nested include would have thrown at runtime.
- Note: `FoodEntry.favMealId` is a single FK, so under the old model a logged
  meal could belong to at most ONE favourite; saving it into a second one
  silently moved it. Another reason the copy-based shape is right.
- Smoke: `scripts/favmeal-smoke.ts [email]` — 18/18 on 2026-08-31, self-cleaning
  (deletes food entries through `CaloriesService.deleteFoodEntry`, never raw).

## Workouts (Aug 26 2026) — `src/services/workouts/`

One physical training session = one `WorkoutSession` row (+ `WorkoutExercise`
→ `WorkoutSet`). `source` HEALTHKIT (synced watch summary) | OLLIE (described
in chat, optionally linked to a watch workout via `externalId` = HealthKit
UUID, `@@unique([patientId, externalId])`) | MANUAL. Metrics (calories, avg/
peak/low HR, `zoneSeconds[5]`, distance) come from the watch when linked
(`metricsSource: "watch"`), else a MET estimate from body weight
(`"estimate"`). Heart-rate TRACES are never stored — the phone reads them.
Layout (keep it): `domain/` pure code shared by REST + agent —
`activity.catalog.ts` (canonical activity keys ↔ HealthKit names, MET,
`activitiesCompatible`), `exercise.catalog.ts` (~65 canonical lifts with
aliases incl. Italian; `canonicalExercise()` → key or `custom:<slug>`; extend
aliases when the parser invents spellings), `workout.schema.ts` (zod:
`WatchWorkoutSummary`, `SyncRequest`, `SessionInput`, `PreviewEdits`),
`workout.matching.ts` (described session ↔ watch workout: time overlap, then
same-day compatible activity, else `ambiguous`), `workout.metrics.ts`
(`estimateCalories`, `fmtSets`, `summarizeSession`). `parsing/
workoutParse.service.ts` = the ONE LLM call (strict schema, `WORKOUT_PARSE_
MODEL`, default the agent model); the model only transcribes — units, catalog
resolution, day resolution and "ran 5k is the session, not an exercise"
folding happen in code. `model/workouts.model.ts` `WorkoutService`: `list/
get/softDelete`, `syncFromHealthKit` (upsert by externalId, writes METRIC
fields only so titles/exercises survive; summaries missing from the window →
unlink, or soft-delete when watch-only), `createSession` (enriches an
already-synced watch row instead of duplicating), `previousExercises`
("vs last time"). Routes: `GET /api/workouts?from&to`, `POST
/api/workouts/sync {windowStart, windowEnd, workouts[]}`, `GET/DELETE
/api/workouts/:id`.
Agent: `tools/workout.tools.ts` — `log_workout` (write; parse → match against
`ctx.client.recentWorkouts` (HealthKit summaries the app sends with each turn,
validated in the controller) → proposal with editable sets; `applyPreviewEdits`
= `PreviewEdits`; the parser's reading of the user's own time words beats the
model's `date`, and nothing lands in the future) and `get_workouts` (read;
`exerciseKey` for one lift's history). `ToolContext.client` carries the
phone data (null on commit/proactive). Snapshot renders this week's sessions
(with sets) and the unlogged watch workouts. `get_activity` is now explicitly
"ring minutes"; the weekly proactive instruction also calls `get_workouts`.
Smoke: `scripts/agent-workout-smoke.ts` (parser, matching, agent turn with
client context, set edit + confirm, sync keeps detail, watch-only removal,
no-watch estimate — all pass 2026-08-26); eval scenarios
`log_workout_proposal` + `workout_not_hypothetical`. Known: the legacy
`DailyExercise` minutes tracker (Apple exercise ring) still feeds Trends and
the weekly report — sessions do not yet derive those minutes.

## Labs journey (Aug 27 2026) — `src/services/labs_journey/`

How a patient gets labs done. `domain/screening.rules.ts` `buildPanel(profile)`
is a deterministic, CITED rules table (USPSTF grade + recommendation URL,
ACC/AHA, ADA, KDIGO, ATA, NLA, USMSTF): blood labs with canonical biomarker
keys, non-blood screenings, and "at the visit" items, each with a personalised
`reason`, `cadence` and `priority` DUE | CONSIDER | DISCUSS. Verify the
citations before public release. `domain/profile.ts`
`buildScreeningProfile(getPatientById result)` (age, sex, BMI, smoking from
smokingHabit/isSmoker, lower-cased conditions/medications/diet, family flags
from FamilyHistorySummary) and `applyCoverage(items, reports)` (a LAB item is
covered when one of its biomarkers exists ≤12 mo via `buildCurrentLabs`;
stale = due) and `checklistText()` (plain text for Share / booking notes).
Model `LabJourney` (route OWN_DOCTOR | DTC | OLLO_DOCTOR, status RECOMMENDED →
ORDERED → RESULTED | CANCELLED, `panel` snapshot, `bookingId`). Routes
(patient token only): `GET /api/labs/panel` (profile summary, items with
coverage, counts, checklistText, open journey), `GET/POST/PUT
/api/labs/journey` (`{route}` starts one and cancels the open one;
`{status}` or `{bookingId}` advances — a bookingId sets ORDERED and writes
the checklist into `Booking.notes` when empty). `uploadPatientLab` calls
`LabsJourneyService.markResulted` (fire-and-forget). The old
`getRecommendedScreenings` / `POST /utils/getAffordableTests` still exist for
the unreachable legacy onboarding screen — delete with it. Script:
`scripts/labs-panel.ts <email> [--json]`. Restart the dev server after
`prisma generate` (nodemon doesn't watch node_modules — `touch src/index.ts`).

Annual physical (Aug 28 2026): `Patient.lastPhysicalStatus`
("within_year" | "over_year" | "never") + `lastPhysicalAt` (written through
`updatePatient`); `GET /labs/panel` adds `physical {status, lastAt,
nextDueAt (+12 mo), overdue}` and `insurance {provider, planType,
allowsAnyPCP}`; `PUT /api/labs/insurance {provider, planType}` upserts
`PatientInsurance` (allowsAnyPCP = PPO | EPO | out of pocket); `POST
/labs/journey` takes `reason` ANNUAL_PHYSICAL | LABS_ONLY (`LabJourney.reason`,
default LABS_ONLY). `getPatientById` now includes `insurance`.

Risk & biological age (Aug 28 2026): `labs_journey/domain/risk.ts`
`buildRiskReport(profile, currentLabs)` — Framingham CVD 10-year, Framingham
Offspring diabetes 8-year, PhenoAge — over the merged current labs with unit
normalisation (mmol/L lipids/glucose, g/L albumin, µmol/L creatinine, mg/dL
CRP, WBC per µL) and per-block `…Missing` lists instead of the old
all-or-nothing throw; BP = latest `BloodPressureEntry` → profile sBp/dBp →
120/80 flagged "assumed"; BP-treatment inferred from common
antihypertensives on the medication list. `GET /api/labs/risk`. The
calculators themselves are unchanged in `utils/risks_calculation_bio_age/`
(the diabetes one expects pounds/inches — the service converts). The legacy
`POST /patients/doctor/patientoverview` was deleted with the physician surface.

## Labs — merged "current picture" (Aug 2026)

Each uploaded PDF is one `LabResultSummary` (report) with `LabResult` rows;
reports never merge in the DB. `collectedAt` (test/sample date) is now on
the report next to `createdAt` (upload time); null on legacy rows = createdAt
(`scripts/backfill-lab-collected-at.ts` sets it explicitly — run once on
Railway after deploy).
- `src/utils/labBiomarkers.ts`: `canonicalBiomarkerKey` (alias table —
  HDL/HDL-C/HDL Cholesterol → `hdl` etc., extend it when the extractor
  invents new spellings), `buildCurrentLabs` (latest value per biomarker
  across ALL reports + history), `currentLabEntries` (drop-in for the old
  `labResults[0].labResults`), `labFreshness` (≤6 mo current / ≤12 aging /
  older stale — mirrored in the app's `functionalities/labs/freshness.ts`).
- **Extraction pipeline** `src/services/lab_extraction/` (Aug 2026, replaces
  pdf-parse → gpt-4o-mini): `pdfLayout.ts` rebuilds rows/columns from pdf.js
  text coordinates (" | " marks column gaps — fixes the glued
  "496109/04/2024" current/previous cells), `extractLabs.ts` redacts per row,
  sends numbered rows to `LAB_EXTRACTION_MODEL` (default gpt-4.1; gpt-5*
  handled via `modelRequestParams`) with a strict zod schema where the model
  only COPIES values and cites the rowNumber, and `validateLabs.ts` decides
  trust in code: numeric/limit parse, reference-range parse, `isOutOfRange`
  computed (not model-judged), value verified against its source row →
  `needsReview` + `reviewReason` + `sourceRow` persisted on `LabResult` and
  surfaced as "Check value" in the app. A completeness net re-asks about
  result-looking rows the first pass did not cite (gpt-4o-mini skipped 9/15
  normal rows without it; gpt-4.1 needs it rarely).
  **Scanned PDFs** (no text layer): `extractLabsVision.ts` — pages rendered at
  scale 3 with `pdfRender.ts` (pdf.js + `@napi-rs/canvas`, prebuilt binary,
  works on Railway), each page cut into 3 overlapping strips
  (`LAB_VISION_STRIPS`; whole-page reads shift entire blocks by one row on
  "value printed between two labels" layouts), transcribed per strip, then an
  independent per-strip VERIFY pass (`LAB_VISION_VERIFY_MODEL`, default same
  model) that can only FLAG, never overwrite. Result: 66/66 values on the real
  Quest scan, ~13/67 flagged "check". The PDF pages go to OpenAI unredacted
  (can't text-redact an image) — `LAB_VISION_FALLBACK=false` re-enables the
  422 rejection. The app tells the user a scan was read visually.
  `LAB_EXTRACTION_ENGINE=legacy` restores the old path.
  Eval: `scripts/make-lab-fixtures.ts` (synthetic Quest-style + Italian
  comma-decimal PDFs in tests/fixtures/labs) and
  `scripts/eval-labs.ts [folder] [--model x] [--verify-model y] [--write-expected]`.
  REAL reports live in `docs/lab-samples/` (gitignored) with hand-verified
  `.expected.json` truth files: LabCorp 5p (56), LabCorp-via-EHR 3p (48),
  Quest visit summary 9p (59), Quest SCAN 5p (66) — all values correct with
  gpt-4.1 as of 2026-08-24. Run the eval after ANY change to the pipeline.
  Biomarker keys are urine-scoped (`urine glucose` ≠ `glucose`).
- `src/utils/redactPI.ts`: `parseLabPdf` reads the collection date
  (`detectCollectionDate`: "Data prelievo/Collected/Drawn/Date of service…"
  label first, else latest plausible date, DOB excluded; DD/MM vs MM/DD
  inferred from the page — `inferDayFirst`) BEFORE redaction, because the
  redaction pass strips every date/time from the text.
- Routes: `POST /api/patients/uploadlab` returns `{…labData, reportId,
  collectedAt, collectedAtDetected}` (optional `collectedAt` form field
  overrides detection); `GET /api/patients/labs/current` →
  `{biomarkers, reports}`; `PATCH /api/patients/labs/:id` `{collectedAt}`;
  `DELETE /api/patients/labs/:id`. `/fetchLabs` still returns raw reports,
  ordered by collectedAt desc.
- ALL consumers read the merged view now (health goals, plan proposal,
  nutrition agent tool, multi-account aggregator, risk/bio-age datasets).
  Never go back to `labResults[0]` — a partial upload would hide the rest.

## Legacy removal round 1 (Aug 27 2026)

Deleted modules: `symptoms_checker`, `user_generated_data`, `fitBit`,
`voice_recordings`, `patients_risk_scores` (never registered), and the
`metric` routes + controller (`metric/model` stays — healthgoal, nutrition
and openAI models still import it). Routes removed: all patient-token
`healthGoals/*` except `calculateCaloricAmount` (parked onboarding chain
calls it) and the doctor `fetchHealthGoals`; `utils` parsePDF / validateCode
/ getFoodInfo / `/transcribe`; openAI generate-diagnosis, generate-record-
summary, calculatecaloriestest, generate-lab-data; nutrition generate_meals,
portion_calculator, get_nutrients_tracker(+weekly), delete_nutrients_tracker,
addGeneratedNutritionValues, saveMealPlan; reports patient routes (doctor
checkup report stays); patient `sendNotification`, `checkpatient`,
`updatePatientPassword` (all unauthenticated). Handlers/model code behind
the removed routes were left in place where the file also serves live
routes — a follow-up sweep. NO schema changes: tables of retired features
(`TrackableMetric`, `MetricEntry`, `UserGeneratedData`, `RecordingSession/
Chunk`, `PromoCode`, `Alert`, `UserAlert`, `LabReport`) still exist because
the boot-time `prisma db push` refuses destructive changes — drop them in a
deliberate migration. PARKED (user, Aug 27): the physician-app surface
(visits, letters, doctor messaging, admin, FHIR), `risks_calculation_bio_age`
+ `patientoverview`, `tests-screening` + `getAffordableTests`, insurance CRUD,
Instacart client, dexcom. A backend split for the physician app is a separate
decision.

## Security state (IMPORTANT)

- `env.mongo-era.LEAKED-SECRETS-ROTATE.bak` = the old env file that was
  committed to GitHub with LIVE credentials (Mongo Atlas, OpenAI, AWS SES,
  JWT secrets, Instacart/Fitbit/Google/UMLS). Treat all as compromised; user
  is rotating. Never copy values from it into `.env`.
- `.env` has fresh local JWT secrets; `REACT_APP_OPENAI_API_KEY` is EMPTY —
  all AI endpoints fail until the user adds a new key.
- Fixed 2026-08-28: patient JWTs live 30 days and are refreshed on use —
  `verifyToken` returns `x-refreshed-token` once a token is a week old and
  rotates the `UserToken` row (the app's axios interceptor stores it; a 401
  clears the local user). `verifyToken` also enforces OWNERSHIP: a body /
  query / params / `bookingData` `patientId` or `userId` must be the caller
  or one of their sub-accounts (403 otherwise), and a missing one is filled
  with the caller's id — so legacy handlers that read ids from the body are
  safe without a rewrite. express-session removed (literal secret, unused).
  The unauthenticated voicerecording / sendNotification /
  updatePatientPassword / parsePDF / transcribe routes were deleted on
  2026-08-27. Doctor/admin JWTs are GONE (physician surface retired
  2026-08-29 — patient is the only identity). `uploads/` is gitignored but ~90 MB of old patient audio sits on
  disk locally.
- `verifyToken` (src/utils/auth_token.ts) 401s on malformed token payloads
  (expects `{ user: { id } }`).

## Postgres migration notes

- IDs are `String @default(uuid())`. Frontend controllers validate ids via a
  shim (`ObjectId.isValid` accepts UUID + legacy 24-hex).
- 16 erroneous `@unique` constraints removed 2026-08-19 (userId on all
  Daily*/Weekly* tracker tables, trackerId on WeightEntry/BFPEntry, patientId
  on TrackableMetric) — they broke multi-day tracking under Postgres.
- VitalsSummary gained `smokingHabit`, `caffeine`, `activityLevel` (new
  onboarding Habits set writes them).
- Patient gained `consentAcceptedAt` (2026-08-27; the app's registration
  checkbox). `createPatientMobile` now whitelists client fields (email,
  password, timeZone, firstName, lastName, consentAcceptedAt) — it used to
  spread the whole body into `prisma.patient.create`.
- `src/utils/calculateTDEE.ts` accepts three `exercise.frequency`
  vocabularies (legacy onboarding, "Your body" editor = canonical, Set 02
  labels written before 2026-08-27).
- New endpoint: POST `/api/exercises/fetch_tracker_daily` (auth: patient token;
  returns tracker incl. dailyEntries) — added for the Trends page.
- Postgres enforces FKs Mongo ignored: some summary tables (ExerciseSummary →
  PatientSummary etc.) have no cascade; delete children first in raw SQL.

## Dev data (user antoricciardelli@gmail.com)

Seeded via psql: 14 lab results (LDL + vitamin D flagged) with report +
recommendations; 21 days of FoodEntry rows (dinner gaps, takeaway sodium,
matches the nutrition reference); 30 days of DailyExercise minutes.
`scripts/seed-lab-history.ts` adds two older partial reports (lipids+vit D
Jun 2025 → stale, thyroid/CRP/ferritin Jan 2026 → aging) so the merged labs
view shows history and all three freshness states. Idempotent.

## Physician surface retired (Aug 29 2026) — Phase 1 of the backend split

Ruling (user, 2026-08-29): the patient app and a future physician app will
NOT share a backend. The physician app (no code existed anywhere; only CORS
entries and localhost links) is to be rebuilt later as a SEPARATE clinician
service with its own DB and identity, consuming this backend through a
consent-scoped, FHIR-shaped API + events (design notes in the session memory
"Ollo backend split"). This backend is now single-identity: **patient**.

Deleted: `services/users|admin|fhir|reports|healthgoal|metric|doctors`,
`middleware/auth.ts`, `utility/Patient Summaries`, `recordSummaryFromCCDA`,
the sample CCDA XML, `workers/jobSchedulers/reports.scheduler.ts`, the
messaging routes + controller, every `verifyDoctorToken`/`verifyAdminToken`
route (doctor variants of all tracker fetches, doctor lab upload,
`fetchpatients`, `doctor/getpatientbyid`, `createpatient`, visits, referral,
pre-auth, `doctor/patientoverview`, availabilities, doctor password reset,
the 5 doctor openAI endpoints — prompts archived in
`docs/clinician-side-prompts.md`). `auth_token.ts` exports only
`signJWT/verifyToken/getUserToken/updateUserToken`; `JWT_SECRET_DOCTOR` /
`JWT_SECRET_ADMIN` removed from `.env` (delete them on Railway too).
Schema (destructive — 27 models dropped: Admin, User, Role, Visit, Referral,
PreAuth, ResetPasswordDoctor, AuthorizedPhysicians, RecordingSession/Chunk,
HealthGoal, TrackableMetric, MetricEntry + enums, WeeklyReport + the four
score tables, HealthGoalProgress, HealthCheckUp, UserGeneratedData, Alert,
UserAlert, LabReport):
- **`Clinician`** replaces `User`: a DIRECTORY record (name, specialty,
  clinic, address, `email?`, `externalId?` reserved for the clinician
  service, `isActive`) — no password, no role, no login.
- **`CareTeamMember`** replaces `Patient.doctorIds`: `{patientId,
  clinicianId, source BOOKING|MANUAL|SEED, addedAt, revokedAt?}`,
  unique per pair. This IS the consent grant a clinician service will be
  scoped by. `BookingService.createBooking` upserts one (source BOOKING).
- `Booking.doctorId/doctorName/doctor` → `clinicianId/clinicianName/
  clinician`; `Chat.userId/user` → `clinicianId/clinician` (drafts dropped);
  `MessageSenderType.DOCTOR` → `CLINICIAN`; `WeeklyAvailability.doctorId` →
  `clinicianId` (availability stays as PUBLISHED data on the clinician —
  seeded in dev, later pushed by the clinician service; no write route).
- `services/clinicians/`: `GET /api/clinicians/directory` (active clinicians
  + upcoming availability weeks/days/slots — the ScheduleModal shape),
  `GET /api/clinicians/care-team`, `POST /api/clinicians/care-team
  {clinicianId}`, `DELETE /api/clinicians/care-team/:clinicianId` (sets
  `revokedAt`). `ClinicianService.careTeamOf()` feeds Ollie's `get_care_team`
  / `message_care_team` / `book_appointment` (tool params are now
  `clinicianId`; card data `clinicians[]` / `clinicianName`).
- `MessagingService` keeps `createChat/sendMessage/getChatById/
  getPatientChats` for Ollie; patient HTTP routes restored 2026-09-02 (S5)
  now that the clinician service answers — see the Seam API section.
- Boot: `npm start` runs `scripts/db-push.js` — `prisma db push` that adds
  `--accept-data-loss` ONLY when `PRISMA_ACCEPT_DATA_LOSS=true`. **Railway
  needs that variable set for the ONE deploy that applies this change, then
  removed.** Dev data lost by the push: the seeded doctor, bookings, chats
  (re-seed with `scripts/seed-dev-clinician.ts <email>`).
- `POST /bookings/get_bookings` now whitelists `patientId|status|clinicianId`
  from the body (verifyToken injects `userId`, which Prisma rejected — the
  app's bookings list had 500'd since the Aug 28 ownership guard).
- Body-parser bypass for the lab upload now compares lower-case (the app
  posts `/patients/uploadLab`; the old check was case-sensitive).
- Mobile: `hooks/bookings/useBookingsHook.ts` → `/clinicians/directory` +
  `/clinicians/care-team`; `Booking.clinicianId/clinicianName/clinician`;
  ScheduleModal posts `clinicianId/clinicianName`; OllieCards read
  `clinicians[]` / `clinicianName`. `DoctorData` keeps its name (UI type).
- Pre-existing test failures untouched: `tests/models/patient.model.test.ts`
  (`deletePatientById` mock has no sub-accounts array, `createPatientMobile`
  whitelist) and `nutrition.model.test.ts` (mock missing FoodEntry fields) —
  both fail on functions this change did not touch.

## Seam API (Sep 2 2026) — `src/services/seam/`, Phase 2 of the backend split

Service-to-service surface for `../Ollo-Clinician-Service` under `/api/seam/*`;
never accepts a patient JWT. Guards in `seam.auth.ts`: `requireSeamKey`
(`Authorization: Bearer <SEAM_SERVICE_KEY>`; `SEAM_SERVICE_KEYS` comma list for
rotation; 503 when unset), `requireClinician` (`X-Clinician-External-Id` must
match an active `Clinician.externalId`), `requireGrant("id")` (active
`CareTeamMember` for `req.params.id`), `logSeamAccess(resource)` → `SeamAccessLog`
(mounted FIRST on each route so 401/403 are recorded too; no FK by design).
Routes: `GET /api/seam/health`, `GET /api/seam/whoami`, `PUT /api/seam/clinicians/:externalId`
(S1: directory card upsert — adopts a same-email row that has no externalId, e.g.
the dev seed, so grants/slots survive; email owned by another externalId → 409;
`seam.schema.ts` + `model/seam.model.ts`). S2 patient reads (`SeamPatientService`,
all behind `requireGrant("id")`): `GET /api/seam/patients`,
`/api/seam/patients/:id/{snapshot,labs/current,labs/risk,plan,trackers?days=}` —
they reuse `buildPatientSnapshot` (memories/sub-accounts/client/mealPlan stripped),
`fetchCurrentLabs`, `LabsJourneyService.getRisk`, `PlanService.getActivePlan`, and
the tracker entry tables. S4 (`SeamScheduleService`): `PUT /api/seam/clinicians/:externalId/availability`
replaces overlapping published weeks with concrete slots (booked slots preserved),
`GET …/bookings`, `POST /api/seam/bookings/:id/status` (confirm/decline → slot flag + FCM push).
S5 (`SeamMessagingService`): `GET …/chats`, `GET /api/seam/chats/:id` (marks patient
messages read), `POST /api/seam/chats/:id/messages` (CLINICIAN + push), `POST /api/seam/patients/:id/chats`.
Patient-token chat routes are BACK (`services/messaging/messaging.routes.ts`:
`GET|POST /api/messaging/chats`, `GET /api/messaging/chats/:id`, `POST …/:id/messages`) —
the phone's chat screen can now be rebuilt on them. Plan: `../docs/physician-app-plan.md`. Tests: `tests/seam/`.
Local key lives in `.env` (`SEAM_SERVICE_KEY`) and must equal the one in
`Ollo-Clinician-Service/.env`. Not on Railway yet (physician app is local-only).
