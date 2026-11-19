import prisma from "../../../utility/prismaClient";
import { getLLM } from "../../agent/llm/openai.client";
import HealthIdService from "../../health_id/model/healthId.model";
import { getPatientById } from "../../patient/model/patient.model";
import { applyCoverage, buildScreeningProfile } from "../../labs_journey/domain/profile";
import { buildPanel } from "../../labs_journey/domain/screening.rules";
import { OPTIONAL } from "../domain/optional";
import { buildPlan } from "../domain/plan";
import { checkWords, fallbackWords, PlanWords, reconcile, Reconciled, StoredItem, wordsKey, wordsPrompt, WORDS_SCHEMA } from "../domain/saved";
import { OptionalItem, PreventivePlan, ServiceType, TYPE_LABEL, TYPE_ORDER } from "../domain/types";

/**
 * The preventive plan, saved (P1). Every read rebuilds the items from the
 * record (pure, cheap), reconciles them with what is stored, and rewrites the
 * words only when the items changed — so opening the page costs a model call
 * only after something in the plan really moved.
 */

/** The plan for one person, COMPUTED from the record: rules + what a recent result already covers. */
export const computePlan = async (patientId: string): Promise<PreventivePlan | null> => {
  const patient = await getPatientById(patientId);
  if (!patient) return null;
  const profile = buildScreeningProfile(patient);
  const covered = applyCoverage(buildPanel(profile), (patient as any).patientSummary?.labResults ?? []);
  const upToDate = new Set(covered.filter((i) => i.covered).map((i) => i.key));
  return buildPlan(profile, { upToDate });
};

/** What the app draws. */
export type PlanView = {
  headline: string;
  groups: { type: ServiceType; label: string; line: string; items: any[] }[];
  upToDate: any[];
  /** Every other test, minus what they already added. */
  optional: OptionalItem[];
  counts: { planned: number; coming: number; added: number; upToDate: number; optional: number };
  approvedAt: string | null;
};

/** The model writes the words; on any failure the code's own words stand. `write: false` = never call it. */
const writeWords = async (patientId: string, rows: Reconciled["rows"], write: boolean): Promise<PlanWords> => {
  const fallback = fallbackWords(rows);
  if (!write) return fallback;
  const types = TYPE_ORDER.filter((t) => rows.some((r) => r.type === t && r.status !== "up_to_date"));
  try {
    const healthId = await HealthIdService.forAgent(patientId).catch(() => null);
    const { system, user } = wordsPrompt(healthId, rows);
    const out = await getLLM().json<PlanWords>({
      system,
      user,
      schema: WORDS_SCHEMA as unknown as Record<string, unknown>,
      schemaName: "preventive_plan_words",
      task: "summarize",
      accept: (v) => checkWords(v, types),
    });
    if (checkWords(out, types) !== true) return fallback;
    return { headline: out.headline.trim(), groups: Object.fromEntries(types.map((t) => [t, out.groups[t]!.trim()])) };
  } catch (e) {
    console.error("preventive plan words failed", e);
    return fallback;
  }
};

const toView = (rows: Reconciled["rows"], words: PlanWords, optional: OptionalItem[], approvedAt: Date | null): PlanView => {
  const live = rows.filter((r) => r.status !== "up_to_date");
  const order = { planned: 0, added: 1, coming: 2 } as Record<string, number>;
  const added = new Set(rows.filter((r) => r.status === "added").map((r) => r.key));
  return {
    headline: words.headline,
    groups: TYPE_ORDER.map((type) => ({
      type,
      label: TYPE_LABEL[type],
      line: words.groups[type] ?? "",
      items: live.filter((r) => r.type === type).sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3)).map((r) => ({ ...r.snapshot, status: r.status, addedBy: r.addedBy })),
    })).filter((g) => g.items.length),
    upToDate: rows.filter((r) => r.status === "up_to_date").map((r) => r.snapshot),
    optional: optional.filter((o) => !added.has(o.key)),
    counts: {
      planned: rows.filter((r) => r.status === "planned").length,
      coming: rows.filter((r) => r.status === "coming").length,
      added: added.size,
      upToDate: rows.filter((r) => r.status === "up_to_date").length,
      optional: optional.filter((o) => !added.has(o.key)).length,
    },
    approvedAt: approvedAt ? approvedAt.toISOString() : null,
  };
};

/**
 * Read the plan: rebuild, reconcile, save, words if the items moved.
 * `words: false` keeps the code's own words (no model call) — scripts and tests.
 */
export const loadPlan = async (patientId: string, opts: { words?: boolean } = {}): Promise<PlanView | null> => {
  const computed = await computePlan(patientId);
  if (!computed) return null;
  const existing = await prisma.preventivePlan.findUnique({ where: { patientId }, include: { items: true } });
  const { rows } = reconcile(computed, (existing?.items ?? []) as StoredItem[]);
  const key = wordsKey(rows);

  const plan =
    existing ??
    (await prisma.preventivePlan.create({ data: { patientId }, include: { items: true } }));
  const keep = new Set(rows.map((r) => r.key));
  await prisma.$transaction([
    prisma.preventivePlanItem.deleteMany({ where: { planId: plan.id, key: { notIn: [...keep] } } }),
    ...rows.map((r) =>
      prisma.preventivePlanItem.upsert({
        where: { planId_key: { planId: plan.id, key: r.key } },
        create: { planId: plan.id, key: r.key, type: r.type, status: r.status, addedBy: r.addedBy, snapshot: r.snapshot as object },
        update: { type: r.type, status: r.status, addedBy: r.addedBy, snapshot: r.snapshot as object },
      })
    ),
  ]);

  let words: PlanWords;
  const stale = plan.wordsFor !== key || !plan.headline;
  if (stale) {
    words = await writeWords(patientId, rows, opts.words !== false);
    await prisma.preventivePlan.update({ where: { id: plan.id }, data: { headline: words.headline, groupLines: words.groups as object, wordsFor: key, builtAt: new Date() } });
  } else {
    words = { headline: plan.headline!, groups: (plan.groupLines ?? {}) as PlanWords["groups"] };
    await prisma.preventivePlan.update({ where: { id: plan.id }, data: { builtAt: new Date() } });
  }
  return toView(rows, words, computed.optional, plan.approvedAt);
};

/** Add an optional test to the plan (the person's choice), or take it out. */
export const setOptional = async (patientId: string, key: string, add: boolean, opts: { words?: boolean } = {}): Promise<PlanView | null> => {
  const entry = OPTIONAL.find((o) => o.key === key);
  if (!entry) return null;
  await loadPlan(patientId, { words: false });
  const plan = await prisma.preventivePlan.findUnique({ where: { patientId } });
  if (!plan) return null;
  if (add) {
    const { applies, relevant, ...plain } = entry as any;
    await prisma.preventivePlanItem.upsert({
      where: { planId_key: { planId: plan.id, key } },
      create: { planId: plan.id, key, type: entry.type, status: "added", addedBy: "person", snapshot: { ...plain, tags: [], status: "added" } },
      update: {},
    });
  } else {
    await prisma.preventivePlanItem.deleteMany({ where: { planId: plan.id, key, status: "added" } });
  }
  return loadPlan(patientId, opts);
};

/**
 * For Ollie's snapshot: one line, what is in the plan now and what comes
 * later. Read from the SAVED plan only (never builds or writes); null when
 * the person has no plan yet.
 */
export const planForAgent = async (patientId: string): Promise<string | null> => {
  const plan = await prisma.preventivePlan.findUnique({ where: { patientId }, include: { items: true } });
  if (!plan?.items.length) return null;
  const name = (i: { snapshot: any }) => String(i.snapshot?.name ?? "");
  const now = plan.items.filter((i) => i.status === "planned" || i.status === "added").map(name);
  const later = plan.items.filter((i) => i.status === "coming").map((i) => `${name(i)} (${((i.snapshot as any)?.tags ?? []).find((t: any) => t.key === "coming")?.text ?? "later"})`);
  const done = plan.items.filter((i) => i.status === "up_to_date").map(name);
  return [`preventive plan${plan.approvedAt ? " (approved with a clinician)" : ""}: ${now.join(", ") || "—"}`, later.length ? `later: ${later.join(", ")}` : null, done.length ? `up to date: ${done.join(", ")}` : null].filter(Boolean).join("; ");
};
