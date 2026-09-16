import { z } from "zod";
import prisma from "../../../utility/prismaClient";
import { defineTool } from "./registry";
import encounterService from "../../encounter/model/encounter.model";
import { AssessmentRejected, buildAssessment, NEXT_STEP_KINDS } from "../../encounter/domain/assessment";
import { resolveProtocol } from "../../encounter/domain/protocols";
import { historyComplete, nextStep } from "../../encounter/domain/stateMachine";
import { escalationFor } from "../../encounter/domain/escalation";
import { Protocol, SlotValue, TrippedFlag } from "../../encounter/domain/types";

/**
 * The check-in, as a conversation (ruling 2026-09-16).
 *
 * It used to be a handoff: the chat offered a card, the interview happened on
 * stepped screens, and nothing was ever named. The user's verdict on that build
 * was that it had no value over a form. The shape now follows Doctronic's — a
 * real conversation that ends with what this could be, disclaimed, with a
 * clinician as the next step.
 *
 * What did NOT change, and is the reason this is not just a chatbot:
 *   - the protocol decides which questions get covered (protocols.ts);
 *   - the red-flag rules run over the recorded answers on every turn, and a
 *     tripped rule cannot be talked down (redflags.ts, escalation one-way);
 *   - every question and answer lands on the append-only event log;
 *   - the clinician handout stays code-built from the record (summary.ts).
 *
 * The model runs the conversation and writes the assessment; code decides what
 * it is allowed to contain (assessment.ts).
 */

const SLOT_VALUE = z.union([z.string(), z.array(z.string()), z.number()]);

/** What the model needs to keep the interview covering the protocol. */
const protocolPlan = (protocol: Protocol, state: { slots: Record<string, unknown>; askedKeys: string[] }) => {
  const step = nextStep(state as any, protocol);
  return {
    covers: protocol.slots.map((s) => ({
      slotKey: s.key,
      ask: s.prompt,
      required: s.required,
      kind: s.kind,
      ...(s.options ? { options: s.options.map((o) => ({ value: o.value, label: o.label })) } : {}),
      ...(s.range ? { range: s.range } : {}),
      answered: state.slots[s.key] !== undefined && state.slots[s.key] !== null,
    })),
    askNext: step.kind === "ask" ? { slotKey: step.slot.key, ask: step.slot.prompt } : null,
    historyComplete: historyComplete(state as any, protocol),
  };
};

const flagView = (flags: TrippedFlag[]) => flags.map((f) => ({ level: f.level, criterion: f.criterion, source: `${f.source.org}, ${f.source.year}` }));

export const startCheckin = defineTool({
  name: "start_checkin",
  description:
    "Open a check-in when the user describes a symptom they are having (pain, breathlessness, a rash, dizziness, exhaustion, low mood…). Pass their own words as `complaint`. This CREATES the check-in and returns the questions to cover — you then take the history yourself, in conversation, one or two questions at a time. Do not call it for a condition already on their record, or for food, training or sleep coaching.",
  schema: z.object({
    complaint: z.string().min(2).max(1000).describe("The user's own description of the symptom, in their words. Do not summarise or rename it."),
  }),
  risk: "read",
  async run(ctx, input) {
    const started = await encounterService.start(ctx.patientId, input.complaint.trim(), { threadId: ctx.threadId });
    const active = await encounterService.stateFor(ctx.patientId, started.id);
    const protocol = resolveProtocol(started.complaintKey);
    const plan = active ? protocolPlan(protocol, active.state) : null;

    return {
      result: {
        checkinId: started.id,
        about: started.complaintTitle,
        ...(plan ?? {}),
        trippedNow: flagView(active?.state.redFlags ?? []),
        escalation: started.escalation,
        note:
          "Take the history in conversation — one or two questions at a time, in your own words, in whatever order their answers suggest. Ask the safety questions early. Use what you already know (record, medications, labs) instead of asking again. Call record_checkin as you learn each answer, then assess_checkin when you have enough.",
      },
    };
  },
});

export const recordCheckin = defineTool({
  name: "record_checkin",
  description:
    "Record what the user just told you, onto the check-in running in this conversation. Map their answer to the slotKey and option value from start_checkin's list; use `text` when nothing fits. Call it as you go, not all at the end — the red-flag rules run on what is recorded. Returns what is still uncovered and anything their answers matched.",
  schema: z.object({
    answers: z
      .array(
        z.object({
          slotKey: z.string().describe("A slotKey from start_checkin's `covers` list."),
          value: SLOT_VALUE.optional().describe("The option value (or values for a multi, or a 0-10 number for a scale)."),
          text: z.string().max(1000).optional().describe("Their own words, when no option fits."),
        })
      )
      .min(1)
      .max(8),
  }),
  risk: "read",
  async run(ctx, input) {
    const active = await encounterService.activeForThread(ctx.patientId, ctx.threadId);
    if (!active) return { result: { error: "No check-in is open in this conversation. Call start_checkin first with their own words." } };

    const before = active.state.redFlags.length;
    // `z.infer` leaves every field optional in this project (no strictNullChecks) — zod already validated it.
    const answers = input.answers as { slotKey: string; value?: SlotValue; text?: string }[];
    const { unplaced } = await encounterService.recordAnswers(ctx.patientId, active.row.id, answers);
    const after = await encounterService.stateFor(ctx.patientId, active.row.id);
    if (!after) return { result: { error: "That check-in could not be read back." } };

    const newFlags = after.state.redFlags.slice(before);
    const escalation = escalationFor(after.state.redFlags, after.region);

    return {
      result: {
        recorded: input.answers.length - unplaced.length,
        unplaced: unplaced.length ? unplaced : undefined,
        ...protocolPlan(after.protocol, after.state),
        matchedNow: flagView(newFlags),
        escalation: newFlags.length ? escalation : null,
        note: newFlags.length
          ? "They matched a published criterion. Say so plainly THIS TURN, with the criterion and who publishes it, and give the action from the escalation. Do not soften it, do not wait for the assessment."
          : historyComplete(after.state as any, after.protocol)
          ? "The history is covered — call assess_checkin now rather than asking anything else. Anything still unanswered is optional and will not change what you say."
          : "Ask only what is still uncovered, one or two at a time, and never repeat a question they have answered.",
      },
      cards: newFlags.length && escalation ? [{ type: "checkin_escalation", title: escalation.title, data: escalation }] : [],
    };
  },
});

export const assessCheckin = defineTool({
  name: "assess_checkin",
  description:
    "Close the check-in with what it could be. Give 2-4 possibilities, MOST CONSISTENT FIRST, each with what fits (their own answers), what doesn't fit, and what would change it. The card adds the warning signs, the route and the disclaimer — you do not write those. Forbidden here: any dose or medication advice, reassurance, a prediction of how it will go, a verdict on how urgent it is, and any confidence claim. Call it only once the history is covered.",
  schema: z.object({
    possibilities: z
      .array(
        z.object({
          condition: z.string().min(2).max(120).describe("In plain language — 'tension-type headache', not 'cephalalgia'."),
          fits: z.array(z.string().max(300)).min(1).max(4).describe("Their OWN answers that point at it."),
          doesNotFit: z.array(z.string().max(300)).max(4).optional().describe("What argues against it. Worth more than another `fits` line."),
          wouldChange: z.string().max(300).optional().describe("The answer or test that would move it up or down."),
        })
      )
      .min(2)
      .max(4),
    nextStep: z
      .object({
        kind: z.enum(NEXT_STEP_KINDS as [string, ...string[]]).describe("BOOK_OLLO_DOCTOR unless they already have someone (OWN_DOCTOR). A tripped criterion overrides this."),
        why: z.string().max(300).optional().describe("One line on what the clinician would sort out. No urgency verdict."),
      })
      .optional(),
  }),
  risk: "read",
  async run(ctx, input) {
    const active = await encounterService.activeForThread(ctx.patientId, ctx.threadId);
    if (!active) return { result: { error: "No check-in is open in this conversation. Call start_checkin first with their own words." } };

    const fresh = await encounterService.stateFor(ctx.patientId, active.row.id);
    if (!fresh) return { result: { error: "That check-in could not be read back." } };

    try {
      const assessment = buildAssessment(input as any, fresh.state, fresh.protocol, fresh.region);
      await encounterService.saveAssessment(ctx.patientId, active.row.id, assessment);
      return {
        result: {
          assessed: true,
          checkinId: active.row.id,
          possibilities: assessment.possibilities.map((p) => p.condition),
          nextStep: assessment.nextStep,
          note:
            "The card carries the possibilities, the warning signs, the route and the disclaimer. In your reply: one or two lines, no repetition of the list, and offer the summary they can take to a visit. Never call this a diagnosis.",
        },
        cards: [{ type: "checkin_assessment", title: `What this could be · ${fresh.protocol.title}`, data: { checkinId: active.row.id, about: fresh.protocol.title, ...assessment } }],
      };
    } catch (e: any) {
      if (e instanceof AssessmentRejected) return { result: { rejected: true, fix: e.message } };
      throw e;
    }
  },
});

export const getCheckins = defineTool({
  name: "get_checkins",
  description:
    "The user's past and open check-ins: what they reported, when, and whether anything they told us matched a published criterion. Use to follow up ('how's that headache?') or before booking, so the visit reason is accurate.",
  schema: z.object({ limit: z.number().int().min(1).max(20).optional() }),
  risk: "read",
  async run(ctx, input) {
    const rows = await prisma.encounter.findMany({
      where: { patientId: ctx.patientId },
      orderBy: { createdAt: "desc" },
      take: input.limit ?? 5,
      include: { checkIns: { orderBy: { createdAt: "desc" }, take: 5 } },
    });

    const result = rows.map((row) => {
      const flags = (row.redFlags ?? []) as unknown as TrippedFlag[];
      return {
        id: row.id,
        complaint: row.complaintText,
        about: resolveProtocol(row.complaintKey).title,
        status: row.status,
        startedAt: row.createdAt.toISOString().slice(0, 10),
        matchedCriteria: flags.map((f) => f.criterion),
        followUps: row.checkIns.map((c) => ({ day: c.day, trend: c.trend, note: c.note })),
      };
    });

    return {
      result: result.length ? result : "No check-ins recorded.",
      cards: result.length ? [{ type: "encounters", title: "Your check-ins", data: { encounters: result } }] : [],
    };
  },
});
