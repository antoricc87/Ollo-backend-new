import moment from "moment-timezone";

/**
 * Turns the analyser's free-text `mealDate` ("yesterday", "Monday", "2 days
 * ago", "2026-08-24") into a local calendar day — deterministically, in code,
 * so the model never has to do date arithmetic. Anything it cannot pin to one
 * day (future dates, "the other day", "last week", "the weekend") comes back
 * `unresolved`; the caller holds those meals back and asks.
 */
export type ResolvedMealDate =
  | { date: string; unresolved: false; phrase: string }
  | { date: null; unresolved: true; phrase: string };

const DAY_RE = /^\d{4}-\d{2}-\d{2}/;
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const WEEKDAY_ABBR: Record<string, number> = { sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, weds: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6 };
const NUMBER_WORDS: Record<string, number> = { one: 1, a: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, couple: 2 };

// Time-of-day words carry no date information: "yesterday morning" == "yesterday".
const TIME_WORDS = /\b(morning|noon|midday|afternoon|evening|night|breakfast|lunch|dinner|snack|brunch|at|for|on|in|the|this|past|'s|s)\b/g;

const clean = (phrase: string) =>
  phrase
    .toLowerCase()
    .replace(/[’']s\b/g, "")
    .replace(/[.,;:!?()]/g, " ")
    .replace(TIME_WORDS, " ")
    .replace(/\s+/g, " ")
    .trim();

export function resolveMealDate(phrase: string | null | undefined, today: string, timeZone: string): ResolvedMealDate {
  const raw = (phrase ?? "").trim();
  const t = moment.tz(today, "YYYY-MM-DD", timeZone);
  const ok = (m: moment.Moment): ResolvedMealDate => {
    const date = m.format("YYYY-MM-DD");
    return date <= today ? { date, unresolved: false, phrase: raw } : { date: null, unresolved: true, phrase: raw };
  };
  const bad = (): ResolvedMealDate => ({ date: null, unresolved: true, phrase: raw });

  if (!raw) return ok(t);

  // ISO first — the analyser may emit one when the user gave an explicit date.
  const iso = raw.match(DAY_RE)?.[0];
  if (iso) {
    const m = moment.tz(iso, "YYYY-MM-DD", true, timeZone);
    return m.isValid() ? ok(m) : bad();
  }

  const s = clean(raw);
  if (!s || s === "today" || s === "tonight" || s === "earlier" || s === "just now" || s === "now") return ok(t);
  if (s === "yesterday" || s === "last" || s === "yesterday last") return ok(t.clone().subtract(1, "day")); // "last night" cleans to "last"
  if (/^(day before yesterday|before yesterday)$/.test(s)) return ok(t.clone().subtract(2, "day"));

  // "2 days ago", "three days ago", "a couple of days ago"
  const ago = s.match(/^(?:a )?(?:(\d+)|([a-z]+)(?: of)?) days? ago$/);
  if (ago) {
    const n = ago[1] ? Number(ago[1]) : NUMBER_WORDS[ago[2]];
    if (n && n <= 14) return ok(t.clone().subtract(n, "day"));
    return bad();
  }

  // Weekday names: the most recent occurrence, today if it is that weekday.
  // "last monday" reads the same way — for meals it never means the week before.
  const wd = s.match(/^(?:last |this )?([a-z]+)$/);
  if (wd) {
    const name = wd[1];
    const idx = WEEKDAYS.indexOf(name) >= 0 ? WEEKDAYS.indexOf(name) : WEEKDAY_ABBR[name];
    if (idx !== undefined && idx >= 0) {
      const diff = (t.day() - idx + 7) % 7;
      return ok(t.clone().subtract(diff, "day"));
    }
  }

  return bad();
}

/** Short label for a day relative to today: "Today", "Yesterday", "Tue 25 Aug". */
export function dayLabel(date: string, today: string, timeZone: string): string {
  if (date === today) return "Today";
  const t = moment.tz(today, "YYYY-MM-DD", timeZone);
  const d = moment.tz(date, "YYYY-MM-DD", timeZone);
  if (t.diff(d, "days") === 1) return "Yesterday";
  return d.format("ddd D MMM");
}
