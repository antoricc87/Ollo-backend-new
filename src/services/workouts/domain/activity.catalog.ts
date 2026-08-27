/**
 * Canonical activity kinds. Everything upstream (HealthKit activity names,
 * what a user says to Ollie, manual entries) is normalised to one of these
 * keys so sessions from different sources compare like for like.
 * MET values are Compendium-of-Physical-Activities midpoints, used only for
 * the calorie ESTIMATE when no watch data exists.
 */
export type ActivityKind = {
  key: string;
  label: string;
  met: number;
  /** HealthKit `activityName` values that map to this kind. */
  healthKit: string[];
  /** Words people use; matched case-insensitively as whole words. */
  aliases: string[];
  /** Strength-type sessions carry exercises/sets; endurance ones carry distance. */
  shape: "strength" | "endurance" | "sport" | "mindbody" | "other";
};

export const ACTIVITIES: ActivityKind[] = [
  { key: "strength", label: "Strength training", met: 5, shape: "strength", healthKit: ["TraditionalStrengthTraining", "FunctionalStrengthTraining"], aliases: ["strength", "weights", "lifting", "gym", "push day", "pull day", "leg day", "upper body", "lower body", "resistance", "bodybuilding", "powerlifting", "weightlifting", "calisthenics"] },
  { key: "hiit", label: "HIIT", met: 8, shape: "strength", healthKit: ["HighIntensityIntervalTraining", "CrossTraining", "MixedCardio"], aliases: ["hiit", "intervals", "crossfit", "circuit", "metcon", "wod", "bootcamp", "tabata"] },
  { key: "core", label: "Core", met: 3.8, shape: "strength", healthKit: ["CoreTraining"], aliases: ["core", "abs"] },
  { key: "running", label: "Running", met: 9.8, shape: "endurance", healthKit: ["Running", "TrackAndField"], aliases: ["run", "running", "jog", "jogging", "treadmill", "5k", "10k", "tempo run"] },
  { key: "walking", label: "Walking", met: 3.5, shape: "endurance", healthKit: ["Walking"], aliases: ["walk", "walking", "stroll"] },
  { key: "hiking", label: "Hiking", met: 6, shape: "endurance", healthKit: ["Hiking"], aliases: ["hike", "hiking", "trek", "trekking"] },
  { key: "cycling", label: "Cycling", met: 7.5, shape: "endurance", healthKit: ["Cycling", "Handcycling"], aliases: ["cycling", "bike", "biking", "ride", "spin", "spinning", "peloton", "indoor cycling"] },
  { key: "swimming", label: "Swimming", met: 7, shape: "endurance", healthKit: ["Swimming", "WaterFitness"], aliases: ["swim", "swimming", "laps", "pool"] },
  { key: "rowing", label: "Rowing", met: 7, shape: "endurance", healthKit: ["Rowing"], aliases: ["row", "rowing", "erg", "rower"] },
  { key: "elliptical", label: "Elliptical", met: 5, shape: "endurance", healthKit: ["Elliptical", "StairClimbing", "Stairs"], aliases: ["elliptical", "stairmaster", "stair climber", "stairs"] },
  { key: "soccer", label: "Soccer", met: 7, shape: "sport", healthKit: ["Soccer"], aliases: ["soccer", "football", "calcio", "five-a-side", "futsal", "match"] },
  { key: "basketball", label: "Basketball", met: 6.5, shape: "sport", healthKit: ["Basketball"], aliases: ["basketball", "hoops"] },
  { key: "tennis", label: "Tennis", met: 7.3, shape: "sport", healthKit: ["Tennis", "TableTennis", "Badminton", "Squash", "Racquetball"], aliases: ["tennis", "padel", "squash", "badminton", "ping pong", "table tennis", "pickleball"] },
  { key: "golf", label: "Golf", met: 4.8, shape: "sport", healthKit: ["Golf"], aliases: ["golf"] },
  { key: "martial_arts", label: "Martial arts", met: 10, shape: "sport", healthKit: ["MartialArts", "Kickboxing", "Boxing", "Wrestling"], aliases: ["boxing", "kickboxing", "martial arts", "bjj", "jiu jitsu", "judo", "karate", "muay thai", "mma", "sparring"] },
  { key: "dance", label: "Dance", met: 5.5, shape: "sport", healthKit: ["Dance", "SocialDance", "Cardio Dance"], aliases: ["dance", "dancing", "zumba"] },
  { key: "yoga", label: "Yoga", met: 2.5, shape: "mindbody", healthKit: ["Yoga", "MindAndBody", "Flexibility"], aliases: ["yoga", "stretching", "stretch", "mobility"] },
  { key: "pilates", label: "Pilates", met: 3, shape: "mindbody", healthKit: ["Pilates"], aliases: ["pilates", "barre"] },
  { key: "other", label: "Workout", met: 4.5, shape: "other", healthKit: ["Other"], aliases: [] },
];

export const ACTIVITY_KEYS = ACTIVITIES.map((a) => a.key) as [string, ...string[]];

const byKey = new Map(ACTIVITIES.map((a) => [a.key, a]));
const byHealthKit = new Map(ACTIVITIES.flatMap((a) => a.healthKit.map((h) => [h, a] as const)));

export const activityByKey = (key: string | null | undefined): ActivityKind => byKey.get(key ?? "") ?? byKey.get("other")!;

/** HealthKit `activityName` → canonical key. Unknown names → "other". */
export const activityKeyFromHealthKit = (activityName: string | null | undefined) =>
  (activityName && byHealthKit.get(activityName)?.key) ?? "other";

/** Best-effort key from free text (used as a fallback when the parser is unsure). */
export const activityKeyFromText = (text: string): string | null => {
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9à-ú ]+/g, " ")} `;
  let best: { key: string; len: number } | null = null;
  for (const a of ACTIVITIES)
    for (const alias of a.aliases)
      if (t.includes(` ${alias} `) && (!best || alias.length > best.len)) best = { key: a.key, len: alias.length };
  return best?.key ?? null;
};

/** Two kinds are "compatible" for watch matching when one is a plausible watch
 *  label for the other (people log strength as "Other", HIIT as strength…). */
export const activitiesCompatible = (a: string, b: string) => {
  if (a === b || a === "other" || b === "other") return true;
  const A = activityByKey(a), Bk = activityByKey(b);
  return A.shape === Bk.shape && A.shape !== "endurance";
};
