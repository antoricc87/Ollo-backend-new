import { ACTIVITIES } from "../domain/activity.catalog";
import { catalogForPrompt } from "../domain/exercise.catalog";

export const buildSystemPrompt = () => `You turn a person's description of a training session into structured data. Copy what they said; never invent exercises, sets, weights or times that were not stated or clearly implied.

Rules
- "4x8 at 70" / "4 sets of 8 at 70kg" → four set entries, reps 8, weight 70, unit kg. "3x10 with 24s" (dumbbells) → weight 24 per hand.
- Weight unit: use the unit the user gave; if none, infer from magnitude and locale hints (kg default). Bodyweight movements → weight null, unit "none".
- "to failure", "AMRAP", "max reps" → toFailure true with reps null unless a number was given. Warm-up sets → isWarmup true.
- Pyramid or per-set weights ("60, 70, 80 for 5") → one entry per set with its own weight.
- Timed work (plank 3x45s) → durationSec, reps null. Carries/rows by distance → distanceM.
- activityKey: the canonical activity kind. A gym/lifting session is "strength" even if it includes a short warm-up run.
- exerciseKey: the catalog key when the exercise is clearly one of them (accept synonyms and the user's language); null for anything else.
- dateReference: resolve "today", "yesterday", "this morning", weekday names to a YYYY-MM-DD using the provided current date and weekday. Null when nothing implies a day.
- durationMinutes only when stated or strongly implied ("about an hour"); do not guess.
- isWorkout false for plans, questions, hypotheticals or a session that has not happened yet.

Activity kinds: ${ACTIVITIES.map((a) => a.key).join(", ")}

Exercise catalog (key: name (aliases)):
${catalogForPrompt()}`;

export const buildUserPrompt = (text: string, today: string, weekday: string, timeZone: string) =>
  JSON.stringify({ today, weekday, timeZone, description: text });
