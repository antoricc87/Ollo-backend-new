# Ollo Health — Backend (Express + Prisma + PostgreSQL)

Node/TypeScript, Express 4, ~183 endpoints across 27 feature modules under
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
- Full `tsc` has pre-existing errors (langchain TS2589 depth, dead
  `src/middleware/auth.ts`) — runtime uses transpile-only, don't block on them.

## Health Plan v1 (Aug 2026) — `src/services/plan/`

Goal → pillar targets (SLEEP/EXERCISE/NUTRITION) + nutrition watch-outs.
Models `HealthPlan`, `PlanTarget`, `PlanWatchOut` (legacy HealthGoal/
TrackableMetric tables untouched, still used by the doctor portal).
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
- The fixture also links a DOCTOR (`scripts/seed-dev-doctor.ts`,
  `dev-doctor@ollo.test`, "Dr. Giulia Rossi"; idempotent, `seedDoctorFor(email)`
  / `unlinkDoctor(patientId)`), so `message_care_team` and `book_appointment`
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

## Security state (IMPORTANT)

- `env.mongo-era.LEAKED-SECRETS-ROTATE.bak` = the old env file that was
  committed to GitHub with LIVE credentials (Mongo Atlas, OpenAI, AWS SES,
  JWT secrets, Instacart/Fitbit/Google/UMLS). Treat all as compromised; user
  is rotating. Never copy values from it into `.env`.
- `.env` has fresh local JWT secrets; `REACT_APP_OPENAI_API_KEY` is EMPTY —
  all AI endpoints fail until the user adds a new key.
- Known unfixed issues: JWTs sign with `expiresIn: "9999y"`; several endpoints
  lack auth (voicerecording chunk, sendNotification, updatePatientPassword);
  `uploads/` contains committed patient audio (purge before any git push).
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
