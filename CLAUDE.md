# Ollo Health — Backend (Express + Prisma + PostgreSQL)

Node/TypeScript, Express 4, ~183 endpoints across 27 feature modules under
`src/services/<domain>/` (routes → controller → model). Prisma 6 on
**PostgreSQL** (migrated from MongoDB Aug 2026 — original Mongo schema kept at
`prisma/schema.prisma.mongo.bak`). BullMQ + Redis for jobs. OpenAI
(gpt-4o-mini) + LangChain/LangGraph for AI agents. Mobile app lives in
`../healtcare-mobile-app-main`.

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
