import { EncounterRoute, EncounterStatus, EncounterTrend } from "@prisma/client";
import prisma from "../../../utility/prismaClient";
import { getLLM } from "../../agent/llm/openai.client";
import { regionFromTimeZone } from "../../agent/safety/policy";
import { classify, DIAGNOSIS_DECLINE, PROMPT_VERSION as CLASSIFY_VERSION } from "../llm/classify";
import { fillSlot, sanitize, PROMPT_VERSION as SLOTFILL_VERSION } from "../llm/slotFill";
import { escalationFor, NEUTRAL_CLOSE } from "../domain/escalation";
import { ownDataBlocks } from "../domain/context";
import { followUpFor, FollowUp, CheckInRecord } from "../domain/followUp";
import { buildPatientSnapshot } from "../../agent/context/snapshot";
import { resolveProtocol } from "../domain/protocols";
import { applyAnswer, historyComplete, isSafetySlot, markAsked, nextStep, open, questionFor, shouldHalt } from "../domain/stateMachine";
import { bookingReason, handout, recapLines } from "../domain/summary";
import { EncounterState, emptyState, Protocol, Slot, SlotValue, TrippedFlag } from "../domain/types";
import { calculateAgeFromDob } from "../../../utils/calculateAgefromDob";
import { checkinModeFor } from "../domain/mode";
import { CHECKIN_DISCLAIMER } from "../domain/assessment";
import { GATE_DAYS, strictestGate, TrainingGate, trainingGateFor } from "../domain/trainingGate";

/**
 * Persistence and orchestration for the check-in.
 *
 * The domain layer decides; this file stores the result and returns a view.
 * Two things it must never do: write a self-reported symptom into
 * PatientSummary, and let a model's answer through without `sanitize`.
 */

const CONSENT_VERSION = "checkin.v1";

/* ------------------------------- row ⇄ state ------------------------------- */

const toState = (row: any): EncounterState => ({
  complaintKey: row.complaintKey,
  protocolVersion: row.protocolVersion,
  phase: row.phase,
  complaintText: row.complaintText,
  slots: (row.slots ?? {}) as Record<string, SlotValue>,
  askedKeys: row.askedKeys ?? [],
  redFlags: (row.redFlags ?? []) as TrippedFlag[],
  turns: row.turns ?? 0,
});

const persist = (id: string, state: EncounterState) =>
  prisma.encounter.update({
    where: { id },
    data: {
      phase: state.phase,
      slots: state.slots as any,
      askedKeys: state.askedKeys,
      redFlags: state.redFlags as any,
      turns: state.turns,
    },
  });

/** Append-only. Sequence is derived from the count so events cannot be reordered. */
const logEvent = async (encounterId: string, kind: string, payload?: any, slotKey?: string, model?: string, promptVersion?: string) => {
  const seq = await prisma.encounterEvent.count({ where: { encounterId } });
  return prisma.encounterEvent
    .create({ data: { encounterId, seq, kind, slotKey: slotKey ?? null, payload: payload ?? undefined, model: model ?? null, promptVersion: promptVersion ?? null } })
    .catch((e) => console.error("encounter event write failed", e));
};

/* --------------------------------- views ---------------------------------- */

export type QuestionView = { slot: Slot; phase: string; progress: { asked: number; total: number } };

export type EncounterView = {
  id: string;
  status: EncounterStatus;
  complaintKey: string;
  complaintTitle: string;
  complaintText: string;
  phase: string;
  opener: string;
  question: QuestionView | null;
  escalation: ReturnType<typeof escalationFor>;
  recap: { question: string; answer: string }[];
  neutralClose: string | null;
  route: EncounterRoute;
  bookingId: string | null;
  createdAt: Date;
  /** Phase 2: the episode's trajectory and whether it needs checking on. */
  followUp: FollowUp | null;
};

const view = (
  row: any,
  state: EncounterState,
  protocol: Protocol,
  region: ReturnType<typeof regionFromTimeZone>,
  checkIns: CheckInRecord[] | null = null
): EncounterView => {
  const step = nextStep(state, protocol);
  const total = protocol.slots.filter((s) => s.required).length;
  const asked = protocol.slots.filter((s) => s.required && state.askedKeys.indexOf(s.key) >= 0).length;
  const done = step.kind === "done";
  return {
    id: row.id,
    status: row.status,
    complaintKey: state.complaintKey,
    complaintTitle: protocol.title,
    complaintText: state.complaintText,
    phase: step.phase,
    opener: protocol.opener,
    question: step.kind === "ask" ? { slot: step.slot, phase: step.phase, progress: { asked, total } } : null,
    escalation: escalationFor(state.redFlags, region),
    recap: done ? recapLines(state, protocol) : [],
    // The close is withheld when the interview halted on a crisis — that screen is the escalation, not a recap.
    neutralClose: done && !shouldHalt(state.redFlags) ? NEUTRAL_CLOSE : null,
    route: row.route,
    bookingId: row.bookingId,
    createdAt: row.createdAt,
    // Only once the interview is finished — mid-interview there is nothing to follow up on yet.
    followUp: done && checkIns ? followUpFor(row.createdAt, checkIns) : null,
  };
};

/**
 * A check-in as the app draws it inside the Ollie chat (Sep 16 2026): its
 * state, how far the history has got, and the question being asked — with its
 * options, so the answer can be tapped instead of typed.
 */
export type CheckinThreadView = {
  id: string;
  about: string;
  /** active = interview in progress · paused = End tapped (answers kept) · assessed = ended with an assessment · halted = crisis stop · closed = finished elsewhere. */
  state: "active" | "paused" | "assessed" | "halted" | "closed";
  progress: { covered: number; total: number };
  historyComplete: boolean;
  question: { slotKey: string; prompt: string; kind: string; options: { value: string; label: string }[] | null; range: [number, number] | null } | null;
  disclaimer: string;
};

const patientContext = async (patientId: string) => {
  const p = await prisma.patient.findUnique({ where: { id: patientId }, select: { firstName: true, dob: true, gender: true, timeZone: true } });
  return {
    firstName: p?.firstName ?? null,
    age: p?.dob ? calculateAgeFromDob(p.dob as any) : null,
    sex: p?.gender ?? null,
    region: regionFromTimeZone(p?.timeZone ?? null),
  };
};

/* -------------------------------- commands -------------------------------- */

class EncounterService {
  /** Opens a check-in from the patient's own words. The text prescan runs before any question. */
  async start(patientId: string, complaintText: string, opts: { threadId?: string | null } = {}) {
    const ctx = await patientContext(patientId);
    const { complaintKey, askingForDiagnosis } = await classify(getLLM(), complaintText);
    const protocol = resolveProtocol(complaintKey);
    const state = open(emptyState(protocol.key, complaintText.trim(), protocol.version), protocol);

    const row = await prisma.encounter.create({
      data: {
        patientId,
        complaintKey: protocol.key,
        protocolVersion: protocol.version,
        complaintText: state.complaintText,
        phase: state.phase,
        slots: state.slots as any,
        askedKeys: state.askedKeys,
        redFlags: state.redFlags as any,
        turns: 0,
        consentVersion: CONSENT_VERSION,
        region: ctx.region,
        // Set when the check-in runs as a conversation, so the agent loop can
        // find it again from the thread alone (Sep 16 2026).
        threadId: opts.threadId ?? null,
      },
    });

    await logEvent(row.id, "open", { complaintKey: protocol.key, askingForDiagnosis }, undefined, undefined, CLASSIFY_VERSION);
    if (state.redFlags.length) await logEvent(row.id, "red_flag", { flags: state.redFlags });

    return { ...view(row, state, protocol, ctx.region), decline: askingForDiagnosis ? DIAGNOSIS_DECLINE : null };
  }

  async get(patientId: string, id: string) {
    const row = await prisma.encounter.findFirst({
      where: { id, patientId },
      include: { checkIns: { orderBy: { createdAt: "desc" } } },
    });
    if (!row) return null;
    const state = toState(row);
    const ctx = await patientContext(patientId);
    return view(row, state, resolveProtocol(state.complaintKey), ctx.region, row.checkIns as any);
  }

  async list(patientId: string, status?: EncounterStatus) {
    const rows = await prisma.encounter.findMany({
      where: { patientId, ...(status ? { status } : {}) },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { checkIns: { orderBy: { createdAt: "desc" } } },
    });
    return rows.map((row) => {
      const state = toState(row);
      const protocol = resolveProtocol(state.complaintKey);
      return {
        id: row.id,
        status: row.status,
        complaintTitle: protocol.title,
        complaintText: row.complaintText,
        redFlagLevel: state.redFlags.some((f) => f.level === "EMERGENCY") ? "EMERGENCY" : state.redFlags.length ? "SEEK_CARE_NOW" : null,
        createdAt: row.createdAt,
        closedAt: row.closedAt,
        followUp: followUpFor(row.createdAt, row.checkIns as any),
      };
    });
  }

  /**
   * Records one answer. `value` is a structured choice; `text` is the patient's
   * own words, which the model maps onto the slot's existing options.
   */
  async answer(patientId: string, id: string, slotKey: string, value?: SlotValue, text?: string) {
    const row = await prisma.encounter.findFirst({ where: { id, patientId } });
    if (!row) return null;
    if (row.status !== "OPEN") throw new Error("This check-in is closed");

    const state = toState(row);
    const protocol = resolveProtocol(state.complaintKey);
    const slot = protocol.slots.find((s) => s.key === slotKey);
    if (!slot) throw new Error(`No question "${slotKey}" in this check-in`);

    let resolved: SlotValue = value !== undefined && value !== null ? sanitize(slot, value) : null;
    let usedModel = false;
    if (resolved === null && text) {
      resolved = await fillSlot(getLLM(), slot, text);
      usedModel = true;
    }

    const ctx = await patientContext(patientId);

    /**
     * They answered, but not with one of the listed options ("it comes back
     * after every match" to "when did this start?"). Keep their words AS the
     * answer and move on — the question used to stay open, so the tool told
     * the model to ask it again (Oct 4 2026). Never for the warning-sign
     * question (only its own options can settle it) or a 0–10 scale.
     */
    const ownWords = resolved === null && !!text?.trim() && !isSafetySlot(slot) && (slot.kind === "single" || slot.kind === "multi");
    if (ownWords) resolved = text!.trim().slice(0, 300);

    // Unplaceable answer: mark asked only if it was optional, else keep the question up.
    if (resolved === null) {
      const next = slot.required ? state : markAsked(state, slotKey);
      await persist(id, next);
      await logEvent(id, "answer", { slotKey, unplaced: true, text: text?.slice(0, 500) }, slotKey, undefined, usedModel ? SLOTFILL_VERSION : undefined);
      return { ...view(row, next, protocol, ctx.region), unplaced: true };
    }

    const before = state.redFlags.length;
    const next = applyAnswer(state, protocol, slotKey, resolved, text);
    await persist(id, next);
    await logEvent(id, "answer", { slotKey, value: resolved, ...(ownWords ? { ownWords: true } : {}) }, slotKey, undefined, usedModel ? SLOTFILL_VERSION : undefined);
    if (next.redFlags.length > before) await logEvent(id, "red_flag", { flags: next.redFlags.slice(before) });

    return { ...view({ ...row, phase: next.phase }, next, protocol, ctx.region), unplaced: false };
  }

  /** The clinician handout. Built from the record, never model-generated. */
  async handout(patientId: string, id: string) {
    const row = await prisma.encounter.findFirst({ where: { id, patientId } });
    if (!row) return null;
    const state = toState(row);
    const protocol = resolveProtocol(state.complaintKey);
    const ctx = await patientContext(patientId);
    const snapshot = await buildPatientSnapshot(patientId).catch(() => null);
    const ownData = snapshot
      ? ownDataBlocks({
          flaggedLabs: snapshot.labs.flagged.map((l) => ({
            testType: l.testType,
            result: l.result,
            units: l.units,
            referenceRange: l.referenceRange,
            collectedAt: l.collectedAt,
          })),
          conditions: snapshot.records.conditions,
          medications: snapshot.records.medications,
          allergies: snapshot.records.allergies,
          bloodPressure: snapshot.vitals.bloodPressure
            ? { systolic: snapshot.vitals.bloodPressure.systolic, diastolic: snapshot.vitals.bloodPressure.diastolic, at: snapshot.vitals.bloodPressure.at }
            : null,
        })
      : [];
    const text = handout(state, protocol, { firstName: ctx.firstName, age: ctx.age, sex: ctx.sex }, ownData);
    await logEvent(id, "recap", { chars: text.length });
    return { text, bookingReason: bookingReason(protocol) };
  }

  async close(patientId: string, id: string, route: EncounterRoute, bookingId?: string) {
    const row = await prisma.encounter.findFirst({ where: { id, patientId } });
    if (!row) return null;
    const updated = await prisma.encounter.update({
      where: { id },
      data: { status: "CLOSED", closedAt: new Date(), route, bookingId: bookingId ?? row.bookingId, phase: "CLOSED" },
    });
    await logEvent(id, "close", { route, bookingId: bookingId ?? null });
    const state = toState(updated);
    const ctx = await patientContext(patientId);
    return view(updated, state, resolveProtocol(state.complaintKey), ctx.region);
  }

  /** Episode follow-up. Trend only — the patient's own judgement, never ours. */
  async checkIn(patientId: string, id: string, trend: EncounterTrend, note?: string) {
    const row = await prisma.encounter.findFirst({ where: { id, patientId } });
    if (!row) return null;
    const day = Math.max(1, Math.round((Date.now() - new Date(row.createdAt).getTime()) / 86400000));
    const checkIn = await prisma.encounterCheckIn.create({ data: { encounterId: id, day, trend, note: note?.slice(0, 1000) ?? null } });
    await logEvent(id, "checkin", { day, trend });
    return checkIn;
  }

  /**
   * Open episodes that need checking on — what the dashboard row reads.
   * Only finished interviews with a due follow-up, newest first.
   */
  async openEpisodes(patientId: string) {
    const rows = await prisma.encounter.findMany({
      where: { patientId, status: "OPEN" },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { checkIns: { orderBy: { createdAt: "desc" } } },
    });
    return rows
      .map((row) => {
        const state = toState(row);
        return {
          id: row.id,
          complaintTitle: resolveProtocol(state.complaintKey).title,
          complaintText: row.complaintText,
          startedAt: row.createdAt,
          followUp: followUpFor(row.createdAt, row.checkIns as any),
        };
      })
      .filter((e) => e.followUp.due || e.followUp.persistence);
  }

  async history(patientId: string, id: string) {
    const row = await prisma.encounter.findFirst({ where: { id, patientId }, include: { checkIns: { orderBy: { createdAt: "asc" } } } });
    return row ? row.checkIns : null;
  }

  /**
   * What training help the check-ins on record allow (domain/trainingGate.ts).
   * Patient-wide for a FINISHED check-in: a workout asked for in a new
   * conversation the next day is shaped by it. Null = nothing recent on record.
   * The workout tools and the prompt both read THIS, so they cannot disagree.
   */
  async trainingGate(patientId: string, threadId: string | null = null): Promise<TrainingGate | null> {
    const since = new Date(Date.now() - GATE_DAYS * 86400000);
    const rows = await prisma.encounter.findMany({
      where: { patientId, status: { in: ["OPEN", "ABANDONED"] }, updatedAt: { gte: since } },
      orderBy: { updatedAt: "desc" },
      take: 5,
    });
    if (!rows.length) return null;
    const assessments = await prisma.encounterEvent.findMany({
      where: { encounterId: { in: rows.map((r) => r.id) }, kind: "assessment" },
      orderBy: { seq: "desc" },
      select: { encounterId: true, payload: true },
    });
    return strictestGate(
      rows
        .map((row) => {
          const state = toState(row);
          const last = assessments.find((a) => a.encounterId === row.id);
          const gate = trainingGateFor({ id: row.id, status: row.status, state, protocol: resolveProtocol(state.complaintKey) }, (last?.payload as any) ?? null);
          // An unfinished interview established nothing: it holds training only in the conversation it is running in.
          return gate.pending && row.threadId !== threadId ? null : gate;
        })
        .filter((g): g is TrainingGate => !!g)
    );
  }

  /* ------------------------ the conversational path ------------------------ */

  /** The open check-in running in this chat thread, if any. */
  async activeForThread(patientId: string, threadId: string | null) {
    if (!threadId) return null;
    const row = await prisma.encounter.findFirst({ where: { patientId, threadId, status: "OPEN" }, orderBy: { createdAt: "desc" } });
    if (!row) return null;
    const state = toState(row);
    return { row, state, protocol: resolveProtocol(state.complaintKey) };
  }

  /** State + protocol for one check-in, for the tools that build on the domain. */
  async stateFor(patientId: string, id: string) {
    const row = await prisma.encounter.findFirst({ where: { id, patientId } });
    if (!row) return null;
    const state = toState(row);
    const ctx = await patientContext(patientId);
    return { row, state, protocol: resolveProtocol(state.complaintKey), region: ctx.region };
  }

  /**
   * Records what the conversation established, one slot at a time. Same path as
   * the stepped flow's `answer` — sanitised, persisted, red-flagged, audited —
   * so a history taken in chat is the same record as one taken on screens.
   */
  async recordAnswers(patientId: string, id: string, answers: { slotKey: string; value?: SlotValue; text?: string }[]) {
    const unplaced: string[] = [];
    let last: (EncounterView & { unplaced?: boolean }) | null = null;
    for (const a of answers) {
      const out = await this.answer(patientId, id, a.slotKey, a.value, a.text).catch((e) => {
        // An invented slot key is the model's mistake to fix, not a 500.
        unplaced.push(`${a.slotKey} (${e?.message ?? "could not be recorded"})`);
        return null;
      });
      if (!out) continue;
      if ((out as any).unplaced) unplaced.push(a.slotKey);
      last = out as any;
    }
    return { view: last, unplaced };
  }

  /**
   * Which question the reply is about to ask (null = the next one in order).
   * Logged on every record so a stale choice never outlives its turn; the app's
   * choices and the tool's `askNext` both read it through `questionFor`.
   */
  async setAsking(id: string, slotKey: string | null) {
    await logEvent(id, "asking", { slotKey }, slotKey ?? undefined);
  }

  async askingFor(id: string): Promise<string | null> {
    const last = await prisma.encounterEvent.findFirst({ where: { encounterId: id, kind: "asking" }, orderBy: { seq: "desc" }, select: { payload: true } });
    return ((last?.payload as any)?.slotKey as string | null) ?? null;
  }

  /**
   * Stores the assessment on the append-only event log. The encounter stays
   * OPEN: the follow-up loop is what happens after an assessment, not before.
   */
  async saveAssessment(patientId: string, id: string, assessment: unknown) {
    const row = await prisma.encounter.findFirst({ where: { id, patientId } });
    if (!row) return null;
    await prisma.encounter.update({ where: { id }, data: { phase: "ROUTE" } });
    await logEvent(id, "assessment", assessment as any);
    return true;
  }

  /**
   * End tapped. Ruling 2026-09-16: End means PAUSE, not close — someone who
   * ends a check-in and keeps describing the symptom should be one tap from
   * the answer, not locked out of it. ABANDONED is the paused state: answers
   * stay on the row, `resume` reopens it where it stopped.
   */
  async pause(patientId: string, id: string) {
    const row = await prisma.encounter.findFirst({ where: { id, patientId } });
    if (!row) return null;
    if (row.status !== "OPEN") return row;
    const updated = await prisma.encounter.update({ where: { id }, data: { status: "ABANDONED" } });
    await logEvent(id, "pause");
    return updated;
  }

  /** The paused check-in in this thread, if the latest one is paused. */
  async pausedForThread(patientId: string, threadId: string | null) {
    if (!threadId) return null;
    const row = await prisma.encounter.findFirst({ where: { patientId, threadId }, orderBy: { createdAt: "desc" } });
    if (!row || row.status !== "ABANDONED") return null;
    const state = toState(row);
    return { row, state, protocol: resolveProtocol(state.complaintKey) };
  }

  /** Picks a paused check-in back up where it stopped. Nothing already answered is lost. */
  async resume(patientId: string, id: string) {
    const row = await prisma.encounter.findFirst({ where: { id, patientId } });
    if (!row || row.status !== "ABANDONED") return null;
    const state = toState(row);
    const protocol = resolveProtocol(state.complaintKey);
    const phase = nextStep(state, protocol).phase;
    await prisma.encounter.update({ where: { id }, data: { status: "OPEN", phase } });
    await logEvent(id, "resume");
    return { state: { ...state, phase }, protocol };
  }

  /** The check-in in this chat thread, for the app's check-in mode. Null when there has never been one. */
  async threadView(patientId: string, threadId: string | null): Promise<CheckinThreadView | null> {
    if (!threadId) return null;
    const row = await prisma.encounter.findFirst({ where: { patientId, threadId }, orderBy: { createdAt: "desc" } });
    if (!row) return null;
    const state = toState(row);
    const protocol = resolveProtocol(state.complaintKey);
    const active = checkinModeFor(row).active;
    const assessed = active
      ? null
      : await prisma.encounterEvent.findFirst({ where: { encounterId: row.id, kind: "assessment" }, select: { id: true } });

    const answered = (key: string) => {
      const v = state.slots[key];
      if (v === undefined || v === null) return false;
      if (Array.isArray(v)) return v.length > 0;
      return typeof v !== "string" || v.trim().length > 0;
    };
    const required = protocol.slots.filter((s) => s.required);
    const step = active ? questionFor(state, protocol, await this.askingFor(row.id)) : null;

    return {
      id: row.id,
      about: protocol.title,
      state: row.status === "CLOSED" ? "closed" : row.status === "ABANDONED" ? "paused" : active ? "active" : assessed ? "assessed" : "halted",
      progress: { covered: required.filter((s) => answered(s.key) || state.askedKeys.indexOf(s.key) >= 0).length, total: required.length },
      historyComplete: historyComplete(state, protocol),
      question:
        step && step.kind === "ask"
          ? { slotKey: step.slot.key, prompt: step.slot.prompt, kind: step.slot.kind, options: step.slot.options ?? null, range: step.slot.range ?? null }
          : null,
      disclaimer: CHECKIN_DISCLAIMER,
    };
  }
}

export default new EncounterService();
