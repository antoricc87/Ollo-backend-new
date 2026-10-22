import type { PlannedSessionInput } from "../domain/workout.schema";

/**
 * EDITING ONE DRAFTED SESSION (Oct 12 2026). "Add pull-ups" used to call the
 * designer again from the description, and five of seven exercises came back
 * different. The designer now gets the session as `previous` (CHANGE_RULES);
 * this file is the code half: what the request did not mention is put back
 * exactly, and the difference is stated as fact so the reply cannot claim
 * more — or less — than what changed. Pure.
 */

type Exercise = NonNullable<PlannedSessionInput["exercises"]>[number];

const keyOf = (e: Exercise) => (e.exerciseKey && !e.exerciseKey.startsWith("custom:") ? e.exerciseKey : `name:${(e.name ?? "").toLowerCase().trim()}`);
const prescription = (e: Exercise) => JSON.stringify((e.sets ?? []).map((s: any) => [s.targetReps ?? null, s.targetRepsMax ?? null, s.targetKg ?? null, s.durationSec ?? null, s.restSec ?? null]));

/** Words in the request that mean the whole session's dose is being changed, not one exercise. */
const WHOLE_SESSION = /\b(short|shorter|long|longer|quick|quicker|minutes?|mins?|hour|easier|harder|lighter|heavier|intens|less|more sets|fewer|reduce|increase|everything|all of|whole)\b/i;
const words = (text: string) => text.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2).map((w) => w.replace(/s$/, ""));

/**
 * Does the request speak of this exercise? Its whole name, or its head word
 * ("the row", "the curls") — unless that word belongs to an exercise being
 * ADDED: "add pull-ups" names the pull-up, not the face pull already there.
 */
const namesIt = (request: string, e: Exercise, addedWords: Set<string>) => {
  const said = new Set(words(request));
  const name = words(e.name ?? "");
  if (!name.length) return false;
  if (name.every((w) => said.has(w))) return true;
  const head = name[name.length - 1];
  return said.has(head) && !addedWords.has(head);
};

/**
 * The edited session with everything the request did not touch restored:
 * - an exercise that is in both and is not named in the request keeps its
 *   previous sets, reps, rest and load — unless the request changes the whole
 *   session's dose (shorter, lighter, an hour…);
 * - the warm-up and cool-down stay unless the request speaks of them;
 * - the title stays unless the focus changed.
 */
export const keepUntouched = (previous: PlannedSessionInput, next: PlannedSessionInput, request: string): PlannedSessionInput => {
  const before = new Map((previous.exercises ?? []).map((e) => [keyOf(e), e]));
  const whole = WHOLE_SESSION.test(request);
  const addedWords = new Set((next.exercises ?? []).filter((e) => !before.has(keyOf(e))).flatMap((e) => words(e.name ?? "")));
  const exercises = (next.exercises ?? []).map((e) => {
    const was = before.get(keyOf(e));
    return was && !whole && !namesIt(request, e, addedWords) ? { ...e, sets: was.sets, loadNote: was.loadNote ?? e.loadNote, alternatives: was.alternatives ?? e.alternatives } : e;
  });
  const touchesWarm = /warm|cool|stretch/i.test(request);
  return {
    ...next,
    exercises,
    warmup: touchesWarm ? next.warmup : previous.warmup ?? next.warmup,
    cooldown: touchesWarm ? next.cooldown : previous.cooldown ?? next.cooldown,
    title: next.focus === previous.focus ? previous.title ?? next.title : next.title,
  };
};

/**
 * A session length said in the request — "make it 45 minutes", "45-min",
 * "an hour", "1.5 hours", "hour and a half". Null when none is said. The
 * length is read here in code because the model passed "make it 45 minutes"
 * as words only (Oct 18 2026) and every session came back at the old 35 min.
 */
export const lengthAsked = (request: string, previousMin?: number | null): number | null => {
  const t = request.toLowerCase();
  const ok = (m: number) => (m >= 10 && m <= 180 ? Math.round(m) : null);
  // "15 minutes longer", "add 10 minutes", "10 min shorter" — relative to the session as it is.
  const rel = t.match(/\b(add|another|extra|by)?\s*(\d{1,3})\s*-?\s*(?:min|mins|minute|minutes)\b\s*(longer|shorter|more|less|extra)?/);
  if (rel && (rel[1] || rel[3])) {
    if (!previousMin) return null;
    const sign = rel[3] === "shorter" || rel[3] === "less" ? -1 : 1;
    return ok(previousMin + sign * Number(rel[2]));
  }
  if (/\b(an?|one) hour and a half\b|\bhour and a half\b/.test(t)) return 90;
  const min = t.match(/\b(\d{2,3})\s*-?\s*(?:min|mins|minute|minutes)\b(.{0,15})/);
  if (min) return /warm|cool/.test(min[2]) ? null : ok(Number(min[1]));
  const hrs = t.match(/\b(\d(?:[.,]\d)?)\s*-?\s*(?:h|hr|hrs|hour|hours)\b/);
  if (hrs) return ok(Number(hrs[1].replace(",", ".")) * 60);
  if (/\b(an|one) hour\b/.test(t)) return 60;
  return null;
};

export type SessionChanges = { added: string[]; removed: string[]; moreSets: string[]; fewerSets: string[]; changed: string[]; kept: number; minutes: { from: number; to: number } | null };

/** What differs between two versions of a session, by exercise, plus its length. */
export const sessionChanges = (previous: PlannedSessionInput, next: PlannedSessionInput): SessionChanges => {
  const before = new Map((previous.exercises ?? []).map((e) => [keyOf(e), e]));
  const after = new Map((next.exercises ?? []).map((e) => [keyOf(e), e]));
  const out: SessionChanges = { added: [], removed: [], moreSets: [], fewerSets: [], changed: [], kept: 0, minutes: null };
  for (const [k, e] of after) {
    const was = before.get(k);
    const name = e.name ?? k;
    if (!was) out.added.push(name);
    else if (prescription(was) === prescription(e)) out.kept += 1;
    else if ((e.sets ?? []).length > (was.sets ?? []).length) out.moreSets.push(name);
    else if ((e.sets ?? []).length < (was.sets ?? []).length) out.fewerSets.push(name);
    else out.changed.push(name);
  }
  for (const [k, e] of before) if (!after.has(k)) out.removed.push(e.name ?? k);
  if (previous.durationMin && next.durationMin && previous.durationMin !== next.durationMin) out.minutes = { from: previous.durationMin, to: next.durationMin };
  return out;
};

/**
 * One factual sentence for the model to relay. Fewer sets are named as fewer:
 * "make it longer" once came back with a set cut, and the reply said "more
 * volume" (Oct 18 2026).
 */
export const changesLine = (c: SessionChanges): string => {
  const parts = [
    c.minutes ? `${c.minutes.from} → ${c.minutes.to} min` : null,
    c.added.length ? `added ${c.added.join(", ")}` : null,
    c.removed.length ? `removed ${c.removed.join(", ")}` : null,
    c.moreSets.length ? `more sets of ${c.moreSets.join(", ")}` : null,
    c.fewerSets.length ? `FEWER sets of ${c.fewerSets.join(", ")}` : null,
    c.changed.length ? `changed reps, rest or load of ${c.changed.join(", ")}` : null,
  ].filter(Boolean);
  return parts.length ? `${parts.join("; ")}; ${c.kept} other exercise${c.kept === 1 ? "" : "s"} unchanged` : "nothing changed";
};
