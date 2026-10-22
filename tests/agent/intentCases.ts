/**
 * The cross-area intent requests and the grading rubric (R0 of docs/ollie-request-handling-plan.md), shared
 * by scripts/agent-intent-eval.ts (runs them) and scripts/intent-regrade.ts (grades saved replies, so two
 * runs can be graded by the same grader the same way).
 */
import { seedFinishedCheckin } from "./fixture";

export type Ask = "must" | "never" | "either";
export type Case = { key: string; area: string; turns: string[]; ask: Ask; setup?: (patientId: string) => Promise<unknown>; note?: string };

/** What the fixture holds — the grader needs it to judge "did it use what it knows". */
export const RECORD = `Fixture person (Europe/Rome): 84 kg, 180 cm, hypertension, metformin 500 mg, penicillin allergy, shellfish allergy, dislikes cilantro, mediterranean diet, runs; plan: lose weight, 1500–1700 kcal, 120–150 g protein, 3 training sessions a week; labs: LDL 128 and vitamin D 21 flagged, HbA1c normal; today a 520 kcal lunch is logged; training profile: gym, barbell/dumbbell/cable/machine, 45 min, Mon/Wed/Fri, "left knee — no deep squats"; one completed bench/pulldown session on record; a clinician (Dr. Giulia Rossi) is on the care team. No insurance on file.`;

export const CASES: Case[] = [
  // food logging
  { key: "log_clear", area: "food_log", turns: ["Log my breakfast: two eggs, a slice of whole wheat toast and a black coffee."], ask: "never" },
  { key: "log_vague_portion", area: "food_log", turns: ["I had some pasta for dinner."], ask: "either", note: "a default portion with the assumption said is fine; one question about the portion is fine too" },
  { key: "log_two_meals_two_days", area: "food_log", turns: ["Yesterday dinner was salmon with rice, and this morning I had greek yogurt with honey."], ask: "never" },
  { key: "log_correction_followup", area: "food_log", turns: ["Log a chicken caesar salad for lunch.", "Actually it was a big one, and no croutons."], ask: "never" },
  { key: "log_that_ambiguous", area: "food_log", turns: ["Log the same as last time."], ask: "either", note: "nothing says which meal 'last time' is" },
  { key: "log_catchup", area: "food_log", turns: ["I haven't logged anything since Thursday — the days were normal, just fill them in."], ask: "either" },
  // food questions
  { key: "suggest_dinner", area: "food_advice", turns: ["What should I have for dinner tonight?"], ask: "never" },
  { key: "suggest_with_food", area: "food_advice", turns: ["I have lentils, feta and cherry tomatoes — what can I make for lunch that fits my day?"], ask: "never" },
  { key: "portion_question", area: "food_advice", turns: ["I'm having a pizza tonight, how much of it should I eat?"], ask: "never" },
  { key: "meal_plan_week", area: "food_advice", turns: ["Plan my dinners for the next 5 days."], ask: "never" },
  { key: "protein_today", area: "food_advice", turns: ["Am I on track with protein today?"], ask: "never" },
  { key: "grocery", area: "food_advice", turns: ["Make me a grocery list for a few healthy lunches this week."], ask: "either" },
  // workouts
  { key: "workout_simple", area: "training", turns: ["Give me a 40-minute upper body workout for today."], ask: "never" },
  { key: "workout_tired", area: "training", turns: ["I'm wiped out after a bad night — what should I do at the gym today?"], ask: "never" },
  { key: "workout_after_sport", area: "training", turns: ["I played a 90-minute football match yesterday. Plan my training for the rest of the week, three sessions."], ask: "never" },
  { key: "workout_two_ways", area: "training", turns: ["Do upper body first and then legs."], ask: "must", note: "with no week or session on the table, it is unclear if this is one session's order or which days" },
  { key: "workout_edit", area: "training", turns: ["Give me a 45-minute full body workout.", "Swap the squats for something easier on my knee and make it 30 minutes."], ask: "never" },
  { key: "workout_log_done", area: "training", turns: ["I did 3x8 bench at 60 kg and 3x10 lat pulldown at 50 kg this morning."], ask: "never" },
  { key: "week_hotel", area: "training", turns: ["I'm travelling Tuesday to Thursday with only a hotel gym — dumbbells up to 20 kg. Plan my week, 3 sessions."], ask: "never" },
  { key: "workout_harder", area: "training", turns: ["Make my training harder."], ask: "either", note: "no week saved; asking what to make harder or designing a harder session are both fair" },
  // labs
  { key: "labs_explain", area: "labs", turns: ["Explain my latest lab results."], ask: "never" },
  { key: "labs_one", area: "labs", turns: ["What's my vitamin D level and when was it measured?"], ask: "never" },
  { key: "labs_food", area: "labs", turns: ["What foods relate to my LDL?"], ask: "never" },
  { key: "labs_trend", area: "labs", turns: ["Has my cholesterol gone up?"], ask: "never" },
  { key: "labs_screening", area: "labs", turns: ["Which screenings am I due for?"], ask: "never" },
  // check-ins and symptoms
  { key: "symptom_new", area: "symptoms", turns: ["I've had a headache for three days."], ask: "never", note: "should open a check-in and ask its first question — that is the flow, not a clarifying question" },
  { key: "symptom_plus_request", area: "symptoms", turns: ["My knee hurts since yesterday. Also, log a banana as a snack."], ask: "never" },
  { key: "symptom_followup", area: "symptoms", turns: ["My back is a bit better today."], ask: "never", setup: (id) => seedFinishedCheckin(id, 3) },
  { key: "symptom_train", area: "symptoms", turns: ["My lower back is a bit sore from deadlifts yesterday — can I train today?"], ask: "either" },
  // vitals and body
  { key: "vital_bp", area: "vitals", turns: ["Log my blood pressure, 132 over 85."], ask: "never" },
  { key: "vital_weight", area: "vitals", turns: ["I weighed 83.2 this morning."], ask: "never" },
  { key: "vital_bp_question", area: "vitals", turns: ["Is 132 over 85 high?"], ask: "never" },
  { key: "sleep_question", area: "vitals", turns: ["How did I sleep last week?"], ask: "never" },
  // plan and progress
  { key: "plan_status", area: "plan", turns: ["How am I doing against my plan this week?"], ask: "never" },
  { key: "plan_change", area: "plan", turns: ["Lower my calorie target to 1400."], ask: "never" },
  { key: "plan_vague", area: "plan", turns: ["I want to change my goals."], ask: "must", note: "nothing says which goal or how" },
  { key: "weekly_review", area: "plan", turns: ["Review my last week."], ask: "never" },
  // care team, booking, insurance
  { key: "message_doctor", area: "care", turns: ["Tell Dr. Rossi my blood pressure has been higher this week."], ask: "never" },
  { key: "book_visit", area: "care", turns: ["Book me a visit with my doctor next week."], ask: "either" },
  { key: "insurance_cost", area: "care", turns: ["How much would a specialist visit cost me?"], ask: "never", note: "no insurance on file: say so and offer to add it" },
  // memory and preferences
  { key: "remember_pref", area: "memory", turns: ["Remember that I don't eat pork."], ask: "never" },
  { key: "use_memory", area: "memory", turns: ["Remember that I don't eat pork.", "Suggest a dinner for tonight."], ask: "never" },
  // multi-request and references
  { key: "two_requests", area: "mixed", turns: ["Log a coffee with milk and tell me how much protein I have left today."], ask: "never" },
  { key: "reference_back", area: "mixed", turns: ["What did I have for lunch today?", "Log the same for dinner."], ask: "never" },
  { key: "vague_help", area: "mixed", turns: ["Help me feel better this week."], ask: "either" },
  // general questions
  { key: "general_q", area: "general", turns: ["Is it better to train in the morning or the evening?"], ask: "never" },
  { key: "general_med", area: "general", turns: ["Should I take a vitamin D supplement?"], ask: "never", note: "must not recommend or dose; explaining and pointing to the clinician is right" },
  { key: "app_help", area: "general", turns: ["How do I upload a lab report?"], ask: "never" },
];

export const GRADE_SYSTEM = `You grade one conversation with Ollie, a health app's assistant, against what the person MEANT.
You get the person's record, their message(s), and for the last turn: the tools Ollie called (with short results), the cards it showed, any change it prepared for confirmation, and its reply.
Score 1–5 how well the last turn serves the INTENT of the request (5 = exactly what a thoughtful assistant who knows their record would do; 3 = partly right, generic, or misses part of it; 1 = misunderstood or ignored it). Judge what was asked, using what the record holds; do not reward length.
asked = true only if the reply's main move is a clarifying question back to the person INSTEAD of doing the request (a check-in's interview question or a question offered after doing the work does not count).
wrongAction = true if it did or prepared something the person did not ask for, or did it wrongly (wrong meal, day, value, saved something without asking).
misses = each concrete thing the request asked that the turn missed or got wrong (empty if none). Medical boundary: the assistant may not diagnose, prescribe, dose or reassure about symptoms — respecting that is correct, not a miss.`;
export const GRADE_OUT = {
  type: "object",
  properties: { analysis: { type: "string" }, score: { type: "integer" }, asked: { type: "boolean" }, wrongAction: { type: "boolean" }, misses: { type: "array", items: { type: "string" } } },
  required: ["analysis", "score", "asked", "wrongAction", "misses"],
  additionalProperties: false,
} as const;

