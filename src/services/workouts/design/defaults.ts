import { EXPERIENCE, FOCUS, PLACE, WEEKDAYS } from "../domain/workout.schema";

/**
 * WHAT A DESIGN FALLS BACK ON (user ruling Oct 12 2026): everything the person
 * did not say has a default, and the default comes from THEM where it can —
 * what they said in this request, then their training profile, then the last
 * training week they saved (its length and days — Oct 18 2026: a week asked
 * for at 60 min came back at 35, "your usual length", from the median of
 * logged sessions), then what their own sessions show, then their plan — and
 * only then a fixed value. Nothing
 * here asks a question: a design is never held up for one. Whatever was
 * assumed is said on the card, so a wrong guess is one sentence to correct
 * (and the correction is saved to the profile).
 *
 * Fixed values (ruling): a gym when nothing says where they train; a general
 * mixed session when no plan steers it. Pure.
 */

export type Place = (typeof PLACE)[number];
export type Focus = (typeof FOCUS)[number];
export type Experience = (typeof EXPERIENCE)[number];
export type Weekday = (typeof WEEKDAYS)[number];

export type HistorySession = {
  /** Local day, YYYY-MM-DD. */
  date: string;
  durationMin: number | null;
  place: string | null;
  /** activity.catalog shape: strength · endurance · sport · mindbody · other. */
  shape: string;
  /** It has logged lifts (exercises with sets). */
  hasLifts: boolean;
};

export type DefaultsInput = {
  stated: { place?: Place | null; durationMin?: number | null; focus?: Focus | null; describesSession?: boolean };
  profile: { place?: string | null; experience?: string | null; sessionMinutes?: number | null; preferredDays?: string[] | null } | null;
  plan: { outcome?: string | null } | null;
  /** Completed sessions of the last eight weeks, any order. */
  history: HistorySession[];
  /** The most recent training week they saved (any status): the length it was asked at and the weekdays it trained. */
  lastWeek?: { sessionMinutes?: number | null; days?: string[] } | null;
};

type From = "stated" | "profile" | "last_week" | "history" | "plan" | "default";

export type Defaults = {
  place: Place;
  durationMin: number;
  /** Null when the person described the session themselves ("a recovery session") — the designer reads their words. */
  focus: Focus | null;
  experience: Experience;
  preferredDays: Weekday[];
  from: { place: From; durationMin: From; focus: From; experience: From; preferredDays: From };
  /** One short line per value that was assumed rather than said or on the profile. */
  assumed: string[];
};

export const DEFAULT_PLACE: Place = "gym";
export const DEFAULT_MINUTES = 45;
export const DEFAULT_FOCUS: Focus = "mixed";
const PLAN_FOCUS: Record<string, Focus> = { LOSE_WEIGHT: "mixed", RECOMPOSITION: "hypertrophy", GENERAL_HEALTH: "mixed", FIX_LAB: "mixed" };

const isPlace = (p: unknown): p is Place => (PLACE as readonly string[]).indexOf(String(p)) >= 0;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const weekdayOf = (date: string): Weekday => WEEKDAYS[(new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7];

export const deriveDefaults = ({ stated, profile, plan, history, lastWeek = null }: DefaultsInput): Defaults => {
  const assumed: string[] = [];
  const from = {} as Defaults["from"];
  const own = history.filter((h) => h.shape !== "sport" && h.shape !== "endurance"); // sessions like the one being designed
  const newestFirst = [...history].sort((a, b) => b.date.localeCompare(a.date));

  // Where
  let place: Place;
  const lastPlace = newestFirst.map((h) => h.place).find((p) => isPlace(p) && p !== "anywhere") as Place | undefined;
  if (stated.place) [place, from.place] = [stated.place, "stated"];
  else if (isPlace(profile?.place)) [place, from.place] = [profile!.place as Place, "profile"];
  else if (lastPlace) {
    [place, from.place] = [lastPlace, "history"];
    assumed.push(`Planned for ${lastPlace === "gym" ? "the gym" : lastPlace}, where you last trained`);
  } else {
    [place, from.place] = [DEFAULT_PLACE, "default"];
    assumed.push("Assumed a gym — say if you train somewhere else");
  }

  // How long
  let durationMin: number;
  const lengths = own.map((h) => h.durationMin).filter((m): m is number => !!m && m >= 10 && m <= 180);
  if (stated.durationMin) [durationMin, from.durationMin] = [stated.durationMin, "stated"];
  else if (profile?.sessionMinutes) [durationMin, from.durationMin] = [profile.sessionMinutes, "profile"];
  else if (lastWeek?.sessionMinutes && lastWeek.sessionMinutes >= 10 && lastWeek.sessionMinutes <= 180) {
    [durationMin, from.durationMin] = [lastWeek.sessionMinutes, "last_week"];
    assumed.push(`${durationMin} min, like your last training week`);
  } else if (lengths.length >= 3) {
    [durationMin, from.durationMin] = [Math.max(15, Math.round(median(lengths) / 5) * 5), "history"];
    assumed.push(`${durationMin} min, your usual length`);
  } else {
    [durationMin, from.durationMin] = [DEFAULT_MINUTES, "default"];
    assumed.push(`${DEFAULT_MINUTES} min — say if you want it shorter or longer`);
  }

  // What kind
  let focus: Focus | null;
  if (stated.focus) [focus, from.focus] = [stated.focus, "stated"];
  else if (stated.describesSession) [focus, from.focus] = [null, "stated"];
  else if (plan?.outcome && PLAN_FOCUS[plan.outcome]) {
    [focus, from.focus] = [PLAN_FOCUS[plan.outcome], "plan"];
    assumed.push(focus === "mixed" ? "A general mixed session, to fit your plan" : `A ${focus} session, to fit your plan`);
  } else {
    [focus, from.focus] = [DEFAULT_FOCUS, "default"];
    assumed.push("A general mixed session");
  }

  // How experienced — never printed: it shapes the choice of exercises, it is not something to tell them
  let experience: Experience;
  const lifting = history.filter((h) => h.hasLifts).length;
  if ((EXPERIENCE as readonly string[]).indexOf(String(profile?.experience)) >= 0) [experience, from.experience] = [profile!.experience as Experience, "profile"];
  else if (lifting >= 20) [experience, from.experience] = ["experienced", "history"];
  else if (lifting >= 4) [experience, from.experience] = ["some", "history"];
  else [experience, from.experience] = ["some", "default"];

  // Which days
  let preferredDays: Weekday[];
  const fromProfile = (profile?.preferredDays ?? []).filter((d): d is Weekday => (WEEKDAYS as readonly string[]).indexOf(d) >= 0);
  const counts = new Map<Weekday, number>();
  for (const h of own) counts.set(weekdayOf(h.date), (counts.get(weekdayOf(h.date)) ?? 0) + 1);
  const usual = WEEKDAYS.filter((d) => (counts.get(d) ?? 0) >= 2);
  const lastWeekDays = WEEKDAYS.filter((d) => (lastWeek?.days ?? []).indexOf(d) >= 0);
  if (fromProfile.length) [preferredDays, from.preferredDays] = [fromProfile, "profile"];
  else if (lastWeekDays.length) [preferredDays, from.preferredDays] = [[...lastWeekDays], "last_week"];
  else if (usual.length) [preferredDays, from.preferredDays] = [[...usual], "history"];
  else [preferredDays, from.preferredDays] = [[], "default"];

  return { place, durationMin, focus, experience, preferredDays, from, assumed };
};
