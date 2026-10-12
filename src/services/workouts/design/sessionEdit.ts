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

export type SessionChanges = { added: string[]; removed: string[]; changed: string[]; kept: number };

/** What differs between two versions of a session, by exercise. */
export const sessionChanges = (previous: PlannedSessionInput, next: PlannedSessionInput): SessionChanges => {
  const before = new Map((previous.exercises ?? []).map((e) => [keyOf(e), e]));
  const after = new Map((next.exercises ?? []).map((e) => [keyOf(e), e]));
  const out: SessionChanges = { added: [], removed: [], changed: [], kept: 0 };
  for (const [k, e] of after) {
    const was = before.get(k);
    if (!was) out.added.push(e.name ?? k);
    else if (prescription(was) !== prescription(e)) out.changed.push(e.name ?? k);
    else out.kept += 1;
  }
  for (const [k, e] of before) if (!after.has(k)) out.removed.push(e.name ?? k);
  return out;
};

/** One factual sentence for the model to relay. */
export const changesLine = (c: SessionChanges): string => {
  const parts = [
    c.added.length ? `added ${c.added.join(", ")}` : null,
    c.removed.length ? `removed ${c.removed.join(", ")}` : null,
    c.changed.length ? `changed sets or reps of ${c.changed.join(", ")}` : null,
  ].filter(Boolean);
  return parts.length ? `${parts.join("; ")}; ${c.kept} other exercise${c.kept === 1 ? "" : "s"} unchanged` : "nothing changed";
};
