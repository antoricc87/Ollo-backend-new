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
import { applyAnswer, markAsked, nextStep, open, shouldHalt } from "../domain/stateMachine";
import { bookingReason, handout, recapLines } from "../domain/summary";
import { EncounterState, emptyState, Protocol, Slot, SlotValue, TrippedFlag } from "../domain/types";
import { calculateAgeFromDob } from "../../../utils/calculateAgefromDob";

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
  async start(patientId: string, complaintText: string) {
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
    await logEvent(id, "answer", { slotKey, value: resolved }, slotKey, undefined, usedModel ? SLOTFILL_VERSION : undefined);
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
}

export default new EncounterService();
