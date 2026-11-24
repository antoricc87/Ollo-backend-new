import moment from "moment-timezone";

/**
 * What a designed session or week still misses, in words for the person (Nov 22 2026, his ruling: plain
 * sentences, one per line). The checks in workoutDesign.service.ts are written for the designer model ("add a
 * set or an exercise", "day 7: …") and stay that way — it revises from them. The card shows these instead.
 * Pure.
 */

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
/** The designer's instruction after the dash ("— cut sets/exercises or rest") is not for the person. */
const stripInstruction = (s: string) => s.replace(/\s+—\s+.*$/, "").trim();

const plainOne = (issue: string): string => {
  let m: RegExpMatchArray | null;
  if ((m = issue.match(/^asked for (.+?), no exercise (?:mainly )?(?:targets it|works them)$/))) return `you asked for ${m[1].replace(/_/g, " ")}, but no exercise works ${/s$/.test(m[1]) ? "them" : "it"}`;
  if ((m = issue.match(/^estimated (\d+) min of work vs (\d+) min asked/))) return `about ${m[1]} minutes of work for a ${m[2]}-minute session`;
  if ((m = issue.match(/^(.+?) needs (.+?), not available \((.+?):/))) return `${m[1]} needs ${m[2]}, which you don't have at ${m[3] === "gym" ? "the gym" : m[3]}`;
  if ((m = issue.match(/^(.+?) has a single working set/))) return `${m[1]} has only one working set`;
  return stripInstruction(issue);
};

/**
 * `startDate` turns "day 7" into its weekday ("Sun 29"). A wish the week does not meet yet reads as the wish in
 * their own words. At most `max` lines.
 */
export const plainIssues = (issues: string[], startDate?: string | null, max = 3): string[] => {
  const dayName = (n: number) => (startDate ? moment.utc(startDate, "YYYY-MM-DD").add(n - 1, "days").format("ddd D") : `Day ${n}`);
  const out = issues.map((i) => {
    let m: RegExpMatchArray | null;
    if ((m = i.match(/^not yet in the week: (.+)$/))) return `Not in the week yet: "${m[1].replace(/[.;\s]+$/, "")}"`;
    if ((m = i.match(/^day (\d+) and day (\d+) both load (.+?) on consecutive days$/))) return `${dayName(+m[1])} and ${dayName(+m[2])} both work ${m[3].replace(/_/g, " ")}, back to back`;
    if ((m = i.match(/^day (\d+): (.+)$/))) return `${dayName(+m[1])}: ${plainOne(m[2])}`;
    return cap(plainOne(i));
  });
  return Array.from(new Set(out.map((s) => s.replace(/[.;\s]+$/, "")))).slice(0, max);
};

/**
 * A length wish ("keep each session to 60 minutes") checked against the real durations — the model reviewer
 * called it unmet on a week of 60-minute sessions (Nov 22 2026). Null when the wish is not about length.
 */
export const lengthWishMet = (wish: string, minutes: (number | null | undefined)[]): boolean | null => {
  const m = wish.match(/(\d{2,3})\s*(?:-|\s)?(?:min|minutes?)\b/i);
  if (!m || !/\b(each|every|all|per|sessions?|workouts?)\b/i.test(wish)) return null;
  const n = Number(m[1]);
  const known = minutes.filter((x): x is number => typeof x === "number");
  if (!known.length) return null;
  const atMost = /\b(under|at most|no more than|max(imum)?|up to|within|keep)\b/i.test(wish);
  return known.every((x) => (atMost ? x <= n + 5 : Math.abs(x - n) <= 5));
};
