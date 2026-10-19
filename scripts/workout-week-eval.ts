/**
 * Does the week designer UNDERSTAND a request? (Oct 19 2026)
 *
 * Fifteen made-up people with different requests — a runner after a race, a
 * shift worker, a stiff knee, two free days, a swimmer, his own soccer week —
 * each designed by `designWeek` and graded by a separate model against the
 * request's intent. The point is to measure reasoning in general, not to fix
 * one person's routine: nothing in the designer knows about any of these.
 * Some requests are deliberately ambiguous: there a question is the right
 * answer; for the clear ones a question is a miss.
 *
 *   npx ts-node --transpile-only scripts/workout-week-eval.ts [--model m] [--only key] [--json out.json] [--old]
 *
 * --old   the pre-Oct-19 call shape (no words, no mayAsk; the request carries
 *         their words) — run it from a worktree of an older commit for a baseline.
 * Needs OPENAI keys; no database (the brief is built here).
 */
import "dotenv/config";
import fs from "fs";
import { designWeek, type DesignBrief } from "../src/services/workouts/design/workoutDesign.service";
import { getLLM } from "../src/services/agent/llm/openai.client";

const args = process.argv.slice(2);
const arg = (k: string) => (args.indexOf(k) >= 0 ? args[args.indexOf(k) + 1] : undefined);
const OLD = args.includes("--old");
const JUDGE = process.env.WORKOUT_EVAL_JUDGE ?? "gpt-5.5";
const TODAY = "2026-10-19"; // a Monday

type Case = {
  key: string;
  words: string[];
  sessionsPerWeek: number;
  minutes?: number; // said by them
  days?: number;
  startDate?: string;
  /** The day they said it, when not TODAY (their "today" in the words). */
  today?: string;
  training?: Partial<NonNullable<DesignBrief["training"]>>;
  recent?: DesignBrief["recent"];
  /** must = only a question is right; never = a question is a miss; either = both fine. */
  question: "must" | "never" | "either";
};

const CASES: Case[] = [
  {
    key: "soccer_week",
    words: ["I create a workout plan for the week starting tomorrow that it's focused on lower back recovery because I played soccer today as well as always together with lower back recovery there's always going to be like a session you know a strength session starting only with upper body at the beginning but also like then with lower body aiming at long-term lower back recovery and and improvement days that I want to work out are Monday, Wednesday, and Thursday"],
    sessionsPerWeek: 3,
    minutes: 45,
    today: "2026-10-18",
    question: "either",
  },
  { key: "half_marathon", words: ["Ran a half marathon yesterday, my legs are toast. Plan 4 sessions this week — keep my upper body strength going and I want to be running again by the weekend."], sessionsPerWeek: 4, question: "never" },
  { key: "two_free_days", words: ["I only have Tuesday and Saturday free this week, about an hour each. I want to get stronger overall."], sessionsPerWeek: 2, minutes: 60, question: "never" },
  { key: "stiff_knee", words: ["My right knee is stiff after climbing on Saturday — nothing serious, just stiff. Three gym sessions this week, go easy on it early in the week."], sessionsPerWeek: 3, question: "never" },
  { key: "night_shifts", words: ["I'm on night shifts Monday to Wednesday and off Thursday to Sunday. Three sessions this week — if any land on a work day keep it short."], sessionsPerWeek: 3, question: "never" },
  { key: "new_parent", words: ["Baby is three months old and I sleep badly. Twenty-minute home workouts, three times this week, nothing too intense."], sessionsPerWeek: 3, minutes: 20, training: { place: "home", equipment: ["dumbbell", "mat"] }, question: "never" },
  { key: "wedding", words: ["My wedding is on Saturday! I want to look good in the suit. Train Monday to Thursday, but nothing that leaves me sore on Saturday."], sessionsPerWeek: 4, question: "never" },
  { key: "beginner", words: ["I've never been to a gym. I want to start, three days a week, and I'm nervous about doing things wrong."], sessionsPerWeek: 3, training: { experience: "beginner" }, question: "never" },
  { key: "tennis_saturday", words: ["Tennis tournament on Saturday. Two gym sessions early in the week, then give my shoulder a rest before the matches."], sessionsPerWeek: 2, question: "never" },
  { key: "hiking_trip", words: ["I'm hiking Thursday to Sunday in the mountains. Get my legs ready this week, but don't wreck them before Thursday."], sessionsPerWeek: 2, days: 3, question: "never" },
  { key: "hotel", words: ["I'm in a hotel Tuesday to Thursday with only dumbbells up to 20 kg, and at my home gym the rest of the week. Four sessions."], sessionsPerWeek: 4, training: { equipment: ["barbell", "dumbbell", "rack", "bench"] }, question: "never" },
  { key: "swim_club", words: ["I swim Monday and Thursday mornings with my club. Add two gym sessions that don't ruin my swims."], sessionsPerWeek: 2, question: "never" },
  { key: "same_but_harder", words: ["Same as last week but harder."], sessionsPerWeek: 3, question: "must" },
  { key: "match_weekend", words: ["Legs twice this week, I have a match at the weekend."], sessionsPerWeek: 3, question: "either" },
  { key: "sore_back_limit", words: ["Plan my week, three sessions, the usual."], sessionsPerWeek: 3, training: { limitations: "lower back gets sore with heavy deadlifts" }, question: "never" },
];

const briefFor = (c: Case): DesignBrief =>
  ({
    today: c.today ?? TODAY,
    timeZone: "America/New_York",
    person: { age: 34, sex: "male", weightKg: 78, activityLevel: "moderate", conditions: [], medications: [], exercisePrefs: null },
    training: { place: "gym", equipment: [], experience: "some", sessionMinutes: 45, preferredDays: [], preferredTime: null, limitations: null, ...(c.training ?? {}) },
    plan: null,
    recent: c.recent ?? [],
    lastLoads: {},
    remembered: [],
    recovery: null,
  }) as any;

const JUDGE_SYSTEM = `You grade a training week an AI coach designed from a person's request. You see their words and the week (days, sessions, exercises), or a question the coach asked instead.
If it is a week: score 1–5 how well it follows the INTENT of their words (5 = a thoughtful coach would sign it; 3 = generic, misses part of what they said; 1 = ignores or contradicts it). List each thing their words asked that the week misses or contradicts (empty if none). Judge what they asked, not your taste.
If it is a question: score 1–5 how good that question is (5 = the request genuinely needed it and it settles the ambiguity; 1 = needless — the words already answer it).`;
const JUDGE_OUT = {
  type: "object",
  properties: { analysis: { type: "string" }, score: { type: "integer" }, misses: { type: "array", items: { type: "string" } } },
  required: ["analysis", "score", "misses"],
  additionalProperties: false,
} as const;

const dayName = (start: string, day: number) => new Date(Date.parse(`${start}T12:00:00Z`) + (day - 1) * 86400000).toUTCString().slice(0, 3);

async function runCase(c: Case) {
  const startDate = c.startDate ?? TODAY;
  const t0 = Date.now();
  const ask: any = {
    startDate,
    days: c.days ?? 7,
    sessionsPerWeek: c.sessionsPerWeek,
    sessionMinutes: c.minutes ?? 45,
    minutesFixed: !!c.minutes,
    focus: null,
    place: null,
    caution: null,
    ...(OLD ? { request: c.words.join(" ") } : { request: null, words: c.words, mayAsk: true }),
  };
  const week: any = await designWeek(ask, briefFor(c), { model: arg("--model") });
  const ms = Date.now() - t0;
  const shown = week.question
    ? { question: week.question }
    : {
        reading: week.reading?.purpose,
        days: week.sessions.map((s: any) => ({
          day: dayName(startDate, s.day),
          title: s.session.title,
          minutes: s.session.durationMin,
          exercises: (s.session.exercises ?? []).map((e: any) => `${e.name} ${(e.sets ?? []).length}×${e.sets?.[0]?.targetReps ?? (e.sets?.[0]?.durationSec ? `${e.sets[0].durationSec}s` : "")}`),
        })),
        unmet: week.fit?.issues ?? [],
      };
  const verdict = await getLLM().json<{ analysis: string; score: number; misses: string[] }>({
    task: "review",
    system: JUDGE_SYSTEM,
    user: JSON.stringify({ today: c.today ?? `${TODAY} (Monday)`, weekStarts: startDate, theirWords: c.words, sessionsAsked: c.sessionsPerWeek, profile: briefFor(c).training, result: shown }),
    schema: JUDGE_OUT,
    schemaName: "week_grade",
    model: JUDGE,
    reasoningEffort: "medium",
  });
  const asked = !!week.question;
  const questionOk = c.question === "either" || (c.question === "must") === asked;
  return { key: c.key, asked, questionOk, score: verdict.score, misses: verdict.misses, ms, shown, analysis: verdict.analysis };
}

(async () => {
  const only = arg("--only");
  const cases = CASES.filter((c) => !only || c.key.includes(only));
  const results: any[] = [];
  const queue = [...cases];
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      for (let c = queue.shift(); c; c = queue.shift()) {
        try {
          // A dropped connection is the network, not the designer: one retry.
          const r = await runCase(c).catch((e) => (/connection|ECONNRESET|socket/i.test(e?.message ?? "") ? runCase(c) : Promise.reject(e)));
          results.push(r);
          console.log(`${r.questionOk ? "ok " : "Q! "} ${r.score}/5  ${c.key.padEnd(18)} ${(r.ms / 1000).toFixed(0).padStart(3)} s  ${r.asked ? `asked: ${r.shown.question}` : r.misses.slice(0, 2).join(" | ")}`);
        } catch (e: any) {
          results.push({ key: c.key, error: e?.message ?? String(e) });
          console.log(`ERR ${c.key}: ${e?.message ?? e}`);
        }
      }
    })
  );
  const ok = results.filter((r) => !r.error);
  const weeks = ok.filter((r) => !r.asked);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  console.log(`\n${OLD ? "OLD pipeline" : "NEW pipeline"} · model ${arg("--model") ?? "llm/policy.ts (plan, design, review)"} · judge ${JUDGE}`);
  console.log(`weeks: avg ${avg(weeks.map((r) => r.score)).toFixed(2)}/5 over ${weeks.length} · questions right ${ok.filter((r) => r.questionOk).length}/${ok.length} · median ${(([...ok].map((r) => r.ms).sort((a, b) => a - b)[Math.floor(ok.length / 2)] ?? 0) / 1000).toFixed(0)} s · errors ${results.length - ok.length}`);
  const out = arg("--json");
  if (out) fs.writeFileSync(out, JSON.stringify(results, null, 2));
  process.exit(0);
})();
