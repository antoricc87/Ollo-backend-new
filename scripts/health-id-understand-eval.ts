/**
 * Spoken onboarding: does the model hear what was said, and only that?
 * 16 short stories → `readWords` (the production path: shared policy task
 * "extract", the code checks, the last guard), every check in code — no
 * grader model. No database.
 *
 *   npx ts-node --transpile-only scripts/health-id-understand-eval.ts [--only <id>] [--model <m>] [--json out.json]
 *
 * PAID (one extract call per case, ~16 calls on gpt-6-luna fast, a Sol call
 * only when a story check fails): a few cents a run. Ask before running.
 */
import "dotenv/config";
import fs from "fs";
import { readWords } from "../src/services/health_id/model/understand.service";
import { emptyFacts, missingFacts, type HeardFacts, type StoryDraft } from "../src/services/health_id/domain/understand";

const TODAY = "2026-11-11";
type Check = [string, (f: HeardFacts, s: StoryDraft) => boolean];
type Case = { id: string; words: string; currentFacts?: HeardFacts; currentStory?: StoryDraft; checks: Check[] };

const has = (xs: string[], re: RegExp) => xs.some((x) => re.test(x));
const anyStory = (s: StoryDraft, re: RegExp) => Object.values(s).some((t) => t && re.test(t));
const FIRST_PERSON = /\b(I|I'm|I've|my|me)\b/;
const NO_INFERENCE = /\b(likely|probably|suggests|indicates|at risk of|diagnos)/i;
const storyClean: Check[] = [
  ["story third person", (_f, s) => !anyStory(s, FIRST_PERSON)],
  ["story adds no inference", (_f, s) => !anyStory(s, NO_INFERENCE)],
];

const CASES: Case[] = [
  {
    id: "full_intro",
    words:
      "Hi, I'm Marco, I was born May 1st 1987, male, five eleven, about 185 pounds. I have high cholesterol and I'm on atorvastatin 20 milligrams. Allergic to penicillin. Never smoked, a couple of beers on weekends, three coffees a day, and I run twice a week. My last physical was in March. My dad has type 2 diabetes and he had a heart attack at 55. I want to get my LDL down without more medication, honestly I'm scared of ending up like my dad. Two kids and a busy job, so I can only train early mornings. Success would be getting off the statin within a year. Keep it short, no lectures.",
    checks: [
      ["name", (f) => f.firstName === "Marco"],
      ["birth date", (f) => f.birthDate === "1987-05-01"],
      ["sex", (f) => f.sex === "Male"],
      ["height 71 in", (f) => f.height?.unit === "in" && f.height.value === 71],
      ["weight 185 lb", (f) => f.weight?.unit === "lb" && f.weight.value === 185],
      ["condition cholesterol", (f) => has(f.conditions, /cholesterol|hyperlipid/i)],
      ["med atorvastatin 20", (f) => f.medications.some((m) => /atorvastatin/i.test(m.name) && /20/.test(m.dosage ?? m.name))],
      ["allergy penicillin", (f) => has(f.allergies, /penicillin/i)],
      ["smoking never", (f) => f.smoking === "Never"],
      ["alcohol light", (f) => f.alcohol === "Occasionally" || f.alcohol === "Moderate"],
      ["caffeine 3/day", (f) => f.caffeine === "Moderate" || f.caffeine === "Heavy"],
      ["activity 2x/wk", (f) => f.activity === "Light exercise 1-2 times/week" || f.activity === "Moderate exercise 2-3 times/week"],
      ["physical March", (f) => f.lastPhysical?.status === "within_year" && f.lastPhysical.month === "2026-03"],
      ["family diabetes + heart", (f) => f.familyHistory.includes("diabetes") && f.familyHistory.includes("earlyHeartDisease")],
      ["story: 6 sections", (_f, s) => ["focus", "wants", "worries", "constraints", "success", "coaching"].every((k) => (s as any)[k])],
      ["story keeps specifics", (_f, s) => /mornings?/i.test(s.constraints ?? "") && /statin|year/i.test(s.success ?? "")],
      ...storyClean,
    ],
  },
  {
    id: "age_only",
    words: "I'm 52, a woman, 165 centimeters and about 70 kilos.",
    checks: [
      ["age 52, no invented date", (f) => f.age === 52 && f.birthDate === null],
      ["birth date still missing", (f) => missingFacts(f).join() === "birthDate"],
      ["165 cm / 70 kg", (f) => f.height?.value === 165 && f.height.unit === "cm" && f.weight?.value === 70 && f.weight.unit === "kg"],
    ],
  },
  {
    id: "suspicion_not_condition",
    words: "No diagnoses that I know of. I think I might have sleep apnea though, my wife says I snore really loud and I'm always tired.",
    checks: [
      ["no condition recorded", (f) => f.conditions.length === 0],
      ["worry noted", (_f, s) => /apnea|snor|tired/i.test(s.worries ?? "")],
      ...storyClean,
    ],
  },
  {
    id: "mixed_units",
    words: "I'm 6 foot 2 and 95 kilos.",
    checks: [["74 in / 95 kg", (f) => f.height?.value === 74 && f.height.unit === "in" && f.weight?.value === 95 && f.weight.unit === "kg"]],
  },
  { id: "never_physical", words: "Honestly I've never had a physical, I only go to urgent care when something's wrong.", checks: [["never", (f) => f.lastPhysical?.status === "never"]] },
  { id: "old_physical", words: "My last checkup was like three years ago.", checks: [["over a year", (f) => f.lastPhysical?.status === "over_year" && f.lastPhysical.month === null]] },
  { id: "former_smoker", words: "I quit smoking five years ago, I drink maybe once a month.", checks: [["former smoker", (f) => f.smoking === "Former smoker"], ["alcohol occasionally", (f) => f.alcohol === "Occasionally"]] },
  {
    id: "meds_and_supplements",
    words: "I take metformin 500 twice a day, lisinopril 10 in the morning, and vitamin D. I have type 2 diabetes and high blood pressure.",
    checks: [
      ["3 medications", (f) => f.medications.length === 3 && f.medications.some((m) => /metformin/i.test(m.name)) && f.medications.some((m) => /vitamin d/i.test(m.name))],
      ["2 conditions", (f) => has(f.conditions, /diabetes/i) && has(f.conditions, /blood pressure|hypertension/i)],
    ],
  },
  {
    id: "family_relatives_only",
    words: "My mom had breast cancer and my grandfather had colon cancer. My neighbor has diabetes but that's not family obviously.",
    checks: [
      ["breast + colorectal", (f) => f.familyHistory.includes("breastOrOvarianCancer") && f.familyHistory.includes("colorectalCancer")],
      ["no diabetes from the neighbor", (f) => !f.familyHistory.includes("diabetes")],
    ],
  },
  {
    id: "goals_only",
    words: "Just want more energy and to sleep better, that's it really.",
    checks: [
      ["no facts invented", (f) => JSON.stringify(f) === JSON.stringify(emptyFacts())],
      ["story has the goal", (_f, s) => anyStory(s, /energy/i) && anyStory(s, /sleep/i)],
      ...storyClean,
    ],
  },
  {
    id: "adding_keeps_story",
    words: "Oh and I hurt my knee last month, so no running for now.",
    currentStory: { constraints: "Busy weekdays and travels for work twice a month.", wants: "Wants to lose 10 pounds before summer." },
    checks: [
      ["constraints keep travel", (_f, s) => /travel/i.test(s.constraints ?? "") && /busy/i.test(s.constraints ?? "")],
      ["constraints add knee", (_f, s) => /knee/i.test(s.constraints ?? "")],
      ["wants kept", (_f, s) => /10 pounds/i.test(s.wants ?? "")],
      ...storyClean,
    ],
  },
  {
    id: "adding_corrects_fact",
    words: "Actually I weigh 78 kilos now, I lost a bit.",
    currentFacts: { ...emptyFacts(), sex: "Female", weight: { value: 80, unit: "kg" }, conditions: ["Asthma"] },
    checks: [
      ["weight corrected", (f) => f.weight?.value === 78 && f.weight.unit === "kg"],
      ["rest kept", (f) => f.sex === "Female" && has(f.conditions, /asthma/i)],
    ],
  },
  { id: "spoken_date", words: "I'm thirty four, born the 3rd of July 1992, height 170 centimeters.", checks: [["1992-07-03", (f) => f.birthDate === "1992-07-03"], ["170 cm", (f) => f.height?.value === 170]] },
  {
    id: "readings_not_diagnosis",
    words: "My blood pressure at home is usually around 145 over 95. Nobody has told me anything about it.",
    checks: [
      ["no hypertension invented", (f) => !has(f.conditions, /hypertension|blood pressure/i)],
      ["story names no condition", (_f, s) => !anyStory(s, /hypertension|high blood pressure/i)],
      ...storyClean,
    ],
  },
  { id: "prefer_not", words: "I'd rather not talk about alcohol. I don't smoke.", checks: [["alcohol empty", (f) => f.alcohol === null], ["smoking never", (f) => f.smoking === "Never"]] },
  {
    id: "coaching_style",
    words: "I like detailed explanations with the science behind them, and I'd love a check-in every day.",
    checks: [["coaching captured", (_f, s) => /detail|science/i.test(s.coaching ?? "") && /day/i.test(s.coaching ?? "")], ...storyClean],
  },
];

(async () => {
  const args = process.argv.slice(2);
  const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
  const model = args.includes("--model") ? args[args.indexOf("--model") + 1] : undefined;
  const out = args.includes("--json") ? args[args.indexOf("--json") + 1] : null;
  const results: any[] = [];
  let pass = 0, total = 0;
  for (const c of CASES.filter((c) => !only || c.id.includes(only))) {
    const t = Date.now();
    try {
      const { facts, story } = await readWords({ words: c.words, today: TODAY, currentFacts: c.currentFacts, currentStory: c.currentStory, model });
      const checks = c.checks.map(([name, fn]) => ({ name, ok: (() => { try { return fn(facts, story); } catch { return false; } })() }));
      pass += checks.filter((x) => x.ok).length;
      total += checks.length;
      const failed = checks.filter((x) => !x.ok).map((x) => x.name);
      console.log(`${failed.length ? "✗" : "✓"} ${c.id.padEnd(26)} ${checks.length - failed.length}/${checks.length}  ${((Date.now() - t) / 1000).toFixed(1)}s${failed.length ? "  FAILED: " + failed.join("; ") : ""}`);
      if (failed.length) console.log("    facts:", JSON.stringify(facts), "\n    story:", JSON.stringify(story));
      results.push({ id: c.id, facts, story, checks, ms: Date.now() - t });
    } catch (e) {
      total += c.checks.length;
      console.log(`✗ ${c.id.padEnd(26)} ERROR ${(e as Error).message.slice(0, 160)}`);
      results.push({ id: c.id, error: (e as Error).message });
    }
  }
  console.log(`\n${pass}/${total} checks`);
  if (out) fs.writeFileSync(out, JSON.stringify(results, null, 2));
  process.exit(pass === total ? 0 : 1);
})();
