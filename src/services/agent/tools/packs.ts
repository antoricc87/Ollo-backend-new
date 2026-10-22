/**
 * AREA PACKS — the tools (and their rules) a request can need (R1 token cut, Oct 19 2026).
 *
 * Every model call used to carry all 48 tool schemas (~12,400 tokens, 72% of a call) whatever the request
 * was about. Now a turn carries the CORE tools plus the packs a small routing step picked from the person's
 * message (agent/router.ts); anything else is one `load_tools` call away, so a request that turns out to
 * need another area still gets it. The same mechanism for every area — no request is special-cased.
 *
 * What is ALWAYS loaded (core) and why:
 *  - plan + memory + family members + undo: used across every topic;
 *  - opening a check-in and following one up: a symptom can arrive inside ANY request ("my back hurts,
 *    plan my week") and must open a check-in — safety routing never depends on the router;
 *  - load_tools itself.
 * The safety boundary and the core rules are in the system prompt for every turn, whatever the packs.
 */

export const PACK_KEYS = ["food", "training", "labs", "symptoms", "body", "care"] as const;
export type PackKey = (typeof PACK_KEYS)[number];

export const CORE_TOOLS = ["get_plan", "remember", "recall_memory", "forget_memory", "list_subaccounts", "undo_last_log", "start_checkin", "ask_followup", "record_followup", "load_tools"];

export const PACKS: Record<PackKey, { title: string; covers: string; tools: string[] }> = {
  food: {
    title: "Food",
    covers: "anything they ate or drank — also said in passing ('I had pasta', 'just a coffee') — logging meals, what or how much to eat, saved meals, meal plans, recipes, grocery lists, calories and macros eaten",
    tools: ["get_meals", "get_nutrition_summary", "get_logging_gaps", "get_favorites", "suggest_meal", "portion_check", "generate_meal_plan", "get_meal_plan", "save_meal_plan", "generate_recipe", "build_grocery_list", "log_meal", "save_favorite", "delete_favorite"],
  },
  training: {
    title: "Training",
    covers: "any physical activity they did or plan — also said in passing ('played soccer', 'went for a run') — workouts, designing a session or a training week, changing or moving sessions, sport, activity minutes, the training profile",
    tools: ["get_activity", "get_workouts", "log_workout", "generate_workout", "generate_workout_plan", "edit_workout", "edit_workout_plan", "save_workout_plan", "update_training_profile", "move_workout"],
  },
  labs: {
    title: "Labs and records",
    covers: "lab results and reports, biomarkers, screenings, medical records on file",
    tools: ["get_labs", "get_records"],
  },
  symptoms: {
    title: "Symptoms and check-ins",
    covers: "a symptom being discussed, an ongoing or past check-in, how a symptom is going",
    tools: ["record_checkin", "resume_checkin", "end_checkin", "assess_checkin", "get_checkins"],
  },
  body: {
    title: "Body and plan",
    covers: "weight, blood pressure, glucose and other vitals, sleep and recovery, plan targets, how the week went",
    tools: ["get_vitals", "log_vital", "update_plan_targets", "get_week_review"],
  },
  care: {
    title: "Care team and insurance",
    covers: "messaging the clinician, booking a visit, the care team, insurance and costs",
    tools: ["get_care_team", "message_care_team", "book_appointment", "get_insurance"],
  },
};

export const toolsForPacks = (packs: readonly PackKey[]): Set<string> => new Set([...CORE_TOOLS, ...packs.flatMap((k) => PACKS[k].tools)]);

export const isPackKey = (k: unknown): k is PackKey => (PACK_KEYS as readonly string[]).includes(String(k));
