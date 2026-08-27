/** Strict JSON schema the parser model must satisfy (OpenAI structured output). */
import { ACTIVITY_KEYS } from "../domain/activity.catalog";

export const PARSED_SET = {
  type: "object",
  properties: {
    reps: { type: ["integer", "null"] },
    weight: { type: ["number", "null"], description: "Load per rep in the unit given; null for bodyweight" },
    weightUnit: { type: "string", enum: ["kg", "lb", "none"] },
    durationSec: { type: ["integer", "null"], description: "Timed sets (plank, carries)" },
    distanceM: { type: ["number", "null"] },
    toFailure: { type: "boolean" },
    isWarmup: { type: "boolean" },
  },
  required: ["reps", "weight", "weightUnit", "durationSec", "distanceM", "toFailure", "isWarmup"],
  additionalProperties: false,
} as const;

export const PARSED_EXERCISE = {
  type: "object",
  properties: {
    name: { type: "string", description: "As the user said it" },
    exerciseKey: { type: ["string", "null"], description: "Catalog key when one fits, else null" },
    sets: { type: "array", items: PARSED_SET, description: "One entry per set. '4x8 at 70' → four entries." },
    notes: { type: ["string", "null"] },
  },
  required: ["name", "exerciseKey", "sets", "notes"],
  additionalProperties: false,
} as const;

export const PARSED_SESSION_SCHEMA = {
  type: "object",
  properties: {
    isWorkout: { type: "boolean", description: "false when the text does not describe a training session that happened" },
    activityKey: { type: "string", enum: ACTIVITY_KEYS },
    title: { type: ["string", "null"], description: "Short name if the user gave one ('push day'); else null" },
    dateReference: { type: ["string", "null"], description: "YYYY-MM-DD when the user said or implied a day (today/yesterday/Monday); null if unknown" },
    startTime: { type: ["string", "null"], description: "HH:mm local if stated; null otherwise" },
    durationMinutes: { type: ["integer", "null"] },
    rpe: { type: ["integer", "null"], description: "1–10 if the user rated effort" },
    notes: { type: ["string", "null"], description: "How it felt, anything not captured in sets" },
    exercises: { type: "array", items: PARSED_EXERCISE },
  },
  required: ["isWorkout", "activityKey", "title", "dateReference", "startTime", "durationMinutes", "rpe", "notes", "exercises"],
  additionalProperties: false,
} as const;

export type ParsedSet = { reps: number | null; weight: number | null; weightUnit: "kg" | "lb" | "none"; durationSec: number | null; distanceM: number | null; toFailure: boolean; isWarmup: boolean };
export type ParsedExercise = { name: string; exerciseKey: string | null; sets: ParsedSet[]; notes: string | null };
export type ParsedSession = {
  isWorkout: boolean;
  activityKey: string;
  title: string | null;
  dateReference: string | null;
  startTime: string | null;
  durationMinutes: number | null;
  rpe: number | null;
  notes: string | null;
  exercises: ParsedExercise[];
};
