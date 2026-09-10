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
  with an `emergency` card, ~10 ms; emergency numbers come from
  `safety/policy.ts` via `regionFromTimeZone(Patient.timeZone)`, falling back
  to the "911 in the US, 112 in Europe" line when the zone says nothing) → snapshot + `prompt/system.ts` (static
  persona/boundary/gray-zone examples first for prefix caching, snapshot +
  thread summary last) → model/tool loop (max 8 steps, tool results
  truncated at 12k chars, every call audited) → **output guard**
  (`safety/outputCheck.ts` runs TWO passes and either can flag: the
  deterministic linter `safety/lint.ts`, then the fast-model classifier —
  strict JSON with `analysis` FIRST so it reasons before judging;
  booleans-first flagged answers its own analysis called safe) → on flag:
  one rewrite + re-check, else `SAFE_FALLBACK` +
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
  remember, memory-aware follow-up), `scripts/agent-safety-check.ts` (10 canned
  answers the output guard must pass/flag; 7/7 on the original set as of
  2026-08-24, the 3 triage/prognosis cases added 2026-09-09 are unrun — no key
  in that session). Run both after ANY prompt, tool or model change.

### Check-in / encounter domain (2026-09-09) — Phase 1 core

`src/services/encounter/domain/` replaces the symptoms checker deleted in the
app's 23bff38. It is the pure half of the feature: no LLM, no Prisma, no I/O.
The model's job is to fill slots and phrase questions; every DECISION — next
question, red flag, completion, handout text — is made here so it can be
unit-tested and read by a human. Rulings 2026-09-09: **US only** at launch,
**stepped flow** with Ollie chat as the entry point only.

- `types.ts` — `Slot` / `Protocol` / `EncounterState` / `TrippedFlag`. Reuses
  `PanelSource` from labs_journey so protocols and flags cite their basis the
  way panel items already do.
- `protocols.ts` — 12 complaint protocols on the OLDCARTS frame as DATA
  (11 named + `general_unwell` fallback). Option values are slugged from their
  LABELS via the exported `slug()`, so redflags.ts can reference a rule by the
  words the user saw. Bump `version` when slots change — an old encounter's
  answers meant something different.
- `redflags.ts` — 16 rules, `EMERGENCY` / `SEEK_CARE_NOW`, each with a
  criterion and a source. Two keys: a raw-text prescan REUSING the agent's
  `detectRedFlag`, plus structured rules over answered slots. Additive and
  sticky — `evaluate()` never drops a flag, so an answer can never clear one.
  Tuned for recall.
  ⚠ **The criteria are drafted, not quoted.** Each must be verified against
  the body named in its `source` and reworded to match before launch — the
  compliance argument rests on them being the guideline's criteria, not ours.
- `stateMachine.ts` — safety slot ALWAYS first, then required, then optional,
  then RECAP. `MAX_TURNS` 15. Asked-and-skipped is settled (no badgering).
  `shouldHalt()` ends the interview on self-harm: crisis route, not question 4
  of 7.
- `summary.ts` — recap lines, clinician handout (complaint verbatim + history
  + matched criteria + a provenance line saying it is a self-report captured by
  software), booking reason. Deliberately NOT model-generated: a summary is
  exactly where a fluent model adds "which suggests…".
- `tests/encounter/domain.test.ts` — 21 cases. Two worth keeping: one asserts
  every red-flag rule points at a slot and option that still exists (reword a
  label without the rule and it silently stops firing — the worst failure this
  feature has), and one runs every prompt, criterion and handout through Phase
  0's `lintOutput` so Phase 1 cannot emit what Phase 0 forbids.

### Check-in API and LLM layer (2026-09-09)

- Models: `Encounter` (slots + askedKeys + redFlags stored as Json/String[] on
  the row, the way LabJourney stores `panel`), `EncounterEvent`
  (**append-only** audit: seq derived from the row count, never updated) and
  `EncounterCheckIn`. DEVIATION from the design doc, which specified a separate
  `EncounterSlot` table: the Json column plus the event log already carry the
  values and their timeline, and it is one write per turn instead of two.
- `llm/classify.ts` — free text → ONE key from `COMPLAINT_KEYS` (closed enum in
  the schema). An unknown key or a thrown call becomes `general_unwell`, which
  asks the safe questions too, so a classifier outage never blocks a check-in.
  Also returns `askingForDiagnosis` → fixed `DIAGNOSIS_DECLINE` copy.
- `llm/slotFill.ts` — free text → a value for ONE named slot. The model can
  only pick options that exist, and `sanitize()` re-checks its answer against
  the slot anyway (unknown option dropped, scale clamped and rounded, multi
  filtered). Unplaceable → null, and a required question simply stays up:
  guessing puts words in the patient's mouth.
- `domain/escalation.ts` — ESCALATE scripts assembled from the region table in
  `safety/policy.ts`. Self-harm gets the crisis script with no criteria list;
  otherwise the matched criteria are shown with their source and NO verdict
  ("I can't tell you how serious this is" is the body copy).
- Routes (`/api/encounters`, patient-scoped, identity from the token):
  `POST /` start · `GET /` list · `GET /:id` · `POST /:id/answer` ·
  `GET /:id/handout` · `POST /:id/close` · `POST /:id/checkin` ·
  `GET /:id/checkins`. Wired in `server.ts`.
- `tests/encounter/guards.test.ts` — 12 more cases on the sanitiser and the
  escalation copy, including linting every escalation string through Phase 0.
  33 encounter tests in total.

### The Ollie handoff (2026-09-10)

`agent/tools/checkin.tools.ts` — symptoms LEAVE the chat instead of being
answered in it. This is the highest-value half of the feature: the output
guard can only stop a wrong answer, while the handoff produces the right one.

- `start_encounter` (risk `read`) deliberately CREATES NOTHING. It emits a
  `checkin_offer` card carrying the user's own words; tapping it opens
  `/checkin?complaint=…` and the encounter is created there. The tap is the
  opt-in, so a confirm-gated proposal would ask twice, and an ignored offer
  leaves no half-finished encounter. (Deviates from the design doc §7.3, which
  sketched a proposal — proposals here are for writes to the patient's record;
  this is navigation.)
- `get_encounters` — past/open check-ins with matched criteria and follow-ups,
  for "how's that headache?" and for an accurate booking reason.
- `prompt/system.ts` gained a "Symptoms leave the chat" section: call the tool,
  then ONE line, no causes, no history questions of its own, no softening. It
  explicitly does NOT apply to a condition already on record, to plan questions
  ("should I train today?"), or to food/sleep/training coaching — otherwise
  every conversation turns into a form. The IBS gray-zone example was rewritten
  to teach the new behaviour (it taught the old one).
- The red-flag input gate still runs FIRST: an emergency message bypasses the
  model entirely, so `start_encounter` never sees it. Correct precedence.
- `tests/agent/scenarios.ts` — `no_triage` now expects the tool and the card;
  new `symptom_handoff` (a symptom must hand off and must not name causes) and
  `symptom_handoff_not_for_coaching` (soreness + "should I train?" must NOT
  hand off). 29 scenarios, 12 safety. NOT RUN — needs an API key.

Not built yet: the Phase 2 follow-up loop (episode trajectory, dashboard
surfacing, persistence escalation).

### Output guard, second key (2026-09-09)

`safety/policy.ts` is the boundary AS DATA — the six forbidden acts
(DIAGNOSE, TREAT_OR_DOSE, REASSURE, TRIAGE_VERDICT, PROGNOSE,
CLAIM_ACCURACY) with the reason each is forbidden, the eight allowed speech
acts, region → emergency-number table, and the `AGENT_SAFETY_LINT=report`
rollout switch. The prompt, the classifier rubric and the linter are meant to
agree with it; it is the thing to edit when the boundary moves.

`safety/lint.ts` is a deterministic pass under the classifier. Rationale: the
classifier is itself a model and fails OPEN on a bad judgement (the pipeline
only fails closed when the call throws). Regexes cannot be argued with, cost
nothing and run offline. It may only RAISE a concern, never clear one.

False positives are the expensive failure here — a finding sends a good
answer through a rewrite — so every rule needs a FRAME plus a SUBJECT (a
diagnosis frame beside a condition name; a recommendation frame beside a drug
or a dose), never a bare keyword. Three exemptions do the heavy lifting:
refusals ("I can't recommend a statin" contains every word "take a statin"
does — an exemption marker before the match skips the sentence), conditions
already on the patient's record, and the DRUG/NUTRIENT split (naming food
sources is allowed, so "add iron-rich foods" must not read as a
prescription — nutrients need an explicit supplement form). Doses exclude
grams (this app talks about grams of protein all day) and mg/dL (a lab unit).

The classifier gained a `reassurance` boolean. Its rubric already forbade
triaging severity but there was no field to report it in, so that half of the
boundary could not actually be flagged.

`tests/safety/lint.test.ts` — 31 cases, runs under `npm test` with NO API
key, so a boundary regression is caught on every push instead of at the next
manual eval. The CLEAN half of the corpus is the point: it holds the
gray-zone examples from `prompt/system.ts` and every `expectOk:true` answer
from `agent-safety-check.ts`. If a new rule flags one of those, the rule is
wrong.
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
  getPatientChats` for Ollie; no HTTP routes until the clinician service
  exists to answer.
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
