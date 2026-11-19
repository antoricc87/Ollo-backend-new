import { OPTIONAL } from "./optional";
import { OptionalItem, PlanItem, PreventivePlan, ServiceType, TYPE_LABEL, TYPE_ORDER } from "./types";

/**
 * THE SAVED PLAN (P1, pure). The rules are re-run every time the plan is
 * read — cheap and always current (a result that arrived, a birthday, a new
 * condition) — and reconciled with what is stored:
 *  - rule items take the rules' status (planned / coming / up_to_date);
 *  - an optional test the person ADDED stays, shown in its type's group,
 *    until they remove it — unless the rules now include it (then the rules'
 *    version wins and the "added" row goes);
 *  - a rule item the rules no longer produce is dropped.
 * The words (headline, group lines) are rewritten only when the set of items
 * or their statuses change (`wordsKey`).
 */

export type StoredItem = { key: string; type: string; status: string; addedBy: string; snapshot: any };

export type Reconciled = {
  /** Every row the plan should hold now. */
  rows: { key: string; type: ServiceType; status: string; addedBy: string; snapshot: PlanItem | AddedItem }[];
};

/** An optional test the person added, as a plan row. */
export type AddedItem = OptionalItem & { status: "added" };

export const reconcile = (computed: PreventivePlan, stored: StoredItem[]): Reconciled => {
  const rules = [...computed.groups.flatMap((g) => g.items), ...computed.upToDate];
  const ruleKeys = new Set(rules.map((i) => i.key));
  const rows: Reconciled["rows"] = rules.map((i) => ({ key: i.key, type: i.type, status: i.status, addedBy: stored.find((s) => s.key === i.key)?.addedBy === "clinician" ? "clinician" : "rules", snapshot: i }));
  for (const s of stored) {
    if (s.status !== "added" || ruleKeys.has(s.key)) continue;
    const entry = computed.optional.find((o) => o.key === s.key) ?? OPTIONAL.find((o) => o.key === s.key);
    if (!entry) continue; // a test no longer offered
    const { applies, relevant, ...plain } = entry as any;
    rows.push({ key: s.key, type: entry.type, status: "added", addedBy: s.addedBy, snapshot: { ...plain, tags: (entry as OptionalItem).tags ?? [], status: "added" } });
  }
  return { rows };
};

/** The words are for this exact set: keys and statuses, sorted. */
export const wordsKey = (rows: Reconciled["rows"]) =>
  rows
    .filter((r) => r.status !== "up_to_date")
    .map((r) => `${r.key}:${r.status}`)
    .sort()
    .join(",");

/* -------------------------------- The words -------------------------------- */

export type PlanWords = { headline: string; groups: Partial<Record<ServiceType, string>> };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What each group does as a whole, when no model wrote it (or it failed its checks). */
export const GROUP_ABOUT: Record<ServiceType, string> = {
  lab: "One blood draw covers all of these; you get the results together.",
  diagnostic: "Each is its own short appointment at an imaging center or clinic.",
  procedure: "Booked as its own appointment with a specialist.",
  vaccine: "At a pharmacy or your clinic, several in one visit if you like.",
  check: "Done by a clinician at any visit, in a few minutes.",
};

/** The headline and group lines built in code: correct, plain, never empty. */
export const fallbackWords = (rows: Reconciled["rows"]): PlanWords => {
  const now = rows.filter((r) => r.status === "planned" || r.status === "added");
  const labs = now.filter((r) => r.type === "lab").length;
  const coming = rows.filter((r) => r.status === "coming");
  const parts = [`${plural(now.length, "item")} in your plan`];
  if (labs) parts.push(`${plural(labs, "lab test")} in one blood draw`);
  const headline = `${parts.join(", ")}.${coming.length ? ` Coming up: ${coming.map((c) => (c.snapshot as PlanItem).name.toLowerCase()).join(", ")}.` : ""}`;
  const groups: PlanWords["groups"] = {};
  for (const t of TYPE_ORDER) if (rows.some((r) => r.type === t && r.status !== "up_to_date")) groups[t] = GROUP_ABOUT[t];
  return { headline, groups };
};

const FORBIDDEN = /\b(due|overdue|you need|you must|you should|diagnos|abnormal|at risk of|disease you have)\b/i;

/** The model's words, checked: plain, short, no verdicts; false + reason otherwise. */
export const checkWords = (w: any, types: ServiceType[]): true | string => {
  if (!w || typeof w.headline !== "string") return "no headline";
  if (w.headline.length < 20 || w.headline.length > 220) return "headline length";
  if (FORBIDDEN.test(w.headline)) return "headline wording";
  for (const t of types) {
    const line = w.groups?.[t];
    if (typeof line !== "string" || line.length < 10 || line.length > 220) return `group ${t}`;
    if (FORBIDDEN.test(line)) return `group ${t} wording`;
  }
  return true;
};

export const WORDS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "groups"],
  properties: {
    headline: { type: "string" },
    groups: {
      type: "object",
      additionalProperties: false,
      required: ["lab", "diagnostic", "procedure", "vaccine", "check"],
      properties: Object.fromEntries(TYPE_ORDER.map((t) => [t, { type: "string" }])),
    },
  },
} as const;

export const wordsPrompt = (healthId: string | null, rows: Reconciled["rows"]) => {
  const byType = TYPE_ORDER.map((t) => {
    const items = rows.filter((r) => r.type === t && r.status !== "up_to_date");
    return items.length ? `${TYPE_LABEL[t]}: ${items.map((r) => `${(r.snapshot as any).name}${r.status === "coming" ? " (later)" : r.status === "added" ? " (added by them)" : ""} — ${(r.snapshot as any).why ?? (r.snapshot as any).checks}`).join("; ")}` : `${TYPE_LABEL[t]}: (none)`;
  }).join("\n");
  return {
    system: [
      "You write the words around a person's preventive plan in a health app. The items are decided by clinical guidelines; you never add, remove or rank them.",
      "Write: (1) a headline — ONE sentence, second person, that sums up this plan for this person (who they are in a few words, how many things, the most important one or two); (2) for each group that has items, one sentence on what the group does as a whole, concrete to their items. For a group with no items, write an empty string.",
      "Rules: plain words, no medical verdicts, never 'due', 'you need', 'you should', no diagnosis, no reassurance, no numbers you were not given. Under 30 words each.",
    ].join("\n"),
    user: `Who they are (Health ID):\n${healthId ?? "(not known)"}\n\nThe plan:\n${byType}`,
  };
};
