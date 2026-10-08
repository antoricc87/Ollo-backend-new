import { z } from "zod";
import prisma from "../../../utility/prismaClient";
import { defineTool } from "./registry";
import encounterService from "../../encounter/model/encounter.model";
import { AssessmentRejected, buildAssessment, NEXT_STEP_KINDS } from "../../encounter/domain/assessment";
import { resolveProtocol } from "../../encounter/domain/protocols";
import { historyComplete, isSafetySlot, questionFor, shouldHalt } from "../../encounter/domain/stateMachine";
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
const protocolPlan = (protocol: Protocol, state: { slots: Record<string, unknown>; askedKeys: string[] }, asking: string | null = null) => {
  // The same question the app shows choices for (stateMachine.questionFor) — text and chips cannot drift.
  const step = questionFor(state as any, protocol, asking);
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
    askNext:
      step.kind === "ask"
        ? {
            slotKey: step.slot.key,
            ask: step.slot.prompt,
            how: isSafetySlot(step.slot)
              ? "The warning-sign question: list EVERY sign so each one is read, and end with 'or none of these'."
              : step.slot.options
              ? "One natural sentence. Its options are on screen as tappable choices — do not list them."
              : "One natural sentence.",
          }
        : null,
    historyComplete: historyComplete(state as any, protocol),
  };
};

/**
 * What record/assess say when nothing is running in this thread — the person
 * tapped End, or an earlier check-in finished, but the conversation still
 * reads like an interview. Without a clear next move the model retried the
 * same call until the loop ran out of steps ("I got a bit lost…", Sep 16 2026).
 */
const NO_CHECKIN = {
  noCheckin: true,
  note:
    "There is no check-in running in this conversation (it was ended, or never started). Do NOT call record_checkin or assess_checkin again this turn. If they are still describing a symptom, call start_checkin ONCE with their own words (their earliest description of it), then carry on from what they have already told you — do not re-ask it. Otherwise just reply normally.",
};

/** A check-in exists but End paused it (End = pause, ruling 2026-09-16). */
const PAUSED = {
  paused: true,
  // Worded so it can't be paraphrased at the user: the first version said "do not record or assess" and the reply said "I can't record or assess more here".
  note: "Nothing from this message was kept: they tapped End earlier, so the check-in is on hold. Say none of that to them — no pausing, saving, recording or assessing. Reply only with the offer: pick it back up where it stopped so you can tell them what it could be, or send what they've told you to their care team. If they say yes to picking it up, call resume_checkin.",
};

const flagView = (flags: TrippedFlag[]) => flags.map((f) => ({ level: f.level, criterion: f.criterion, source: `${f.source.org}, ${f.source.year}` }));

export const startCheckin = defineTool({
  name: "start_checkin",
  description:
    "Open a check-in when the user describes a symptom they are having (pain, breathlessness, a rash, dizziness, exhaustion, low mood…). Pass their own words as `complaint`. This CREATES the check-in and returns the questions to cover — you then take the history yourself, in conversation, one question per message. Do not call it for a condition already on their record, or for food, training or sleep coaching.",
  schema: z.object({
    complaint: z.string().min(2).max(1000).describe("The user's own description of the symptom, in their words. Do not summarise or rename it."),
    newEpisode: z.boolean().optional().describe("Only when they say this is a DIFFERENT problem from a check-in already on record for the same complaint (a new headache, not the one being followed)."),
  }),
  risk: "read",
  async run(ctx, input) {
    const started = await encounterService.start(ctx.patientId, input.complaint.trim(), { threadId: ctx.threadId, newEpisode: input.newEpisode });
    if ("existing" in started) {
      const e = started.existing;
      const here = e.row.threadId === ctx.threadId;
      const what =
        e.recordedState === "assessed"
          ? "It has been assessed; nothing is re-asked. If they are saying how it is NOW (better, the same, worse), call record_followup. Then answer what they actually asked — a training request goes to generate_workout / generate_workout_plan, which apply the rule for a symptom on record."
          : e.recordedState === "paused"
          ? `It was ended before it finished${here ? " — offer ONCE to pick it back up (resume_checkin) if they want to know what it could be" : " in another conversation"}. Then answer what they actually asked; a training request goes to the design tools.`
          : e.recordedState === "active"
          ? here
            ? "It is running in this conversation — carry on with it: record_checkin for anything they have just told you, then ask askNext."
            : "An interview about it is running in another conversation; answer what they asked here without re-asking its questions."
          : "Answer what they actually asked.";
      return {
        result: {
          existing: true,
          checkinId: e.row.id,
          about: e.protocol.title,
          state: e.recordedState,
          startedAt: e.row.createdAt,
          inTheirWords: e.row.complaintText,
          note: `A check-in about their ${e.protocol.title.toLowerCase()} is already on record (${e.recordedState}), so none was opened. ${what} Pass newEpisode only if they say this is a different problem.`,
        },
      };
    }
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
          "FIRST record everything their messages so far already answer (record_checkin, same turn) — never ask what they have told you. Then ask ONE question in your reply: `askNext`, the way its `how` says. Use what you already know (record, medications, labs) instead of asking. assess_checkin when the history is covered.",
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
          text: z.string().max(1000).optional().describe("Their own words, when no option fits — kept as the answer, so the question is not asked again."),
        })
      )
      .min(1)
      .max(8),
    asking: z
      .string()
      .optional()
      .describe("Only when the ONE question you are about to ask is not the one this tool would return as askNext: the slotKey of the uncovered question their answer leads to. The app's choices follow it. Omit to ask them in order."),
  }),
  risk: "read",
  cardRole: "result", // records answers and ends the interview — its cards are the conversation, not a lookup
  async run(ctx, input) {
    const active = await encounterService.activeForThread(ctx.patientId, ctx.threadId);
    if (!active) return { result: (await encounterService.pausedForThread(ctx.patientId, ctx.threadId)) ? PAUSED : NO_CHECKIN };

    const before = active.state.redFlags.length;
    // `z.infer` leaves every field optional in this project (no strictNullChecks) — zod already validated it.
    const answers = input.answers as { slotKey: string; value?: SlotValue; text?: string }[];
    const { unplaced } = await encounterService.recordAnswers(ctx.patientId, active.row.id, answers);
    const after = await encounterService.stateFor(ctx.patientId, active.row.id);
    if (!after) return { result: { error: "That check-in could not be read back." } };
    // Logged on every record (null = in order), so the question named for one turn never outlives it.
    const asking = input.asking && after.protocol.slots.some((s) => s.key === input.asking) ? (input.asking as string) : null;
    await encounterService.setAsking(active.row.id, asking);

    const newFlags = after.state.redFlags.slice(before);
    const escalation = escalationFor(after.state.redFlags, after.region);

    /**
     * Self-harm ends the interview, and the reply is NOT the model's to write.
     * Left to it, it reached for authority it did not have ("the NHS says…")
     * — the crisis script cites nobody on purpose. So pin the copy.
     */
    if (shouldHalt(after.state.redFlags) && escalation) {
      return {
        result: {
          halted: true,
          note: "The interview is over and your reply for this turn is fixed — the crisis script was sent as written. Do not add to it, do not ask another question.",
        },
        cards: [{ type: "checkin_escalation", title: escalation.title, data: escalation }],
        pinnedAnswer: [escalation.body, escalation.action].filter(Boolean).join("\n\n"),
      };
    }

    return {
      result: {
        recorded: input.answers.length - unplaced.length,
        unplaced: unplaced.length ? unplaced : undefined,
        ...protocolPlan(after.protocol, after.state, asking),
        matchedNow: flagView(newFlags),
        escalation: newFlags.length ? escalation : null,
        note: newFlags.length
          ? "They matched a published criterion. Say so plainly THIS TURN, with the criterion and who publishes it, and give the action from the escalation. Do not soften it, do not wait for the assessment."
          : historyComplete(after.state as any, after.protocol)
          ? "The history is covered — call assess_checkin now rather than asking anything else. Anything still unanswered is optional and will not change what you say."
          : unplaced.length
          ? "Something could not be recorded (see `unplaced`): if they did answer it, record it again with their own words as `text` — do not ask it a second time. Then ask ONE question: `askNext`, the way its `how` says."
          : "Ask ONE question in this reply: `askNext`, the way its `how` says. Nothing else with a question mark.",
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
  cardRole: "result", // records answers and ends the interview — its cards are the conversation, not a lookup
  async run(ctx, input) {
    const active = await encounterService.activeForThread(ctx.patientId, ctx.threadId);
    if (!active) return { result: (await encounterService.pausedForThread(ctx.patientId, ctx.threadId)) ? PAUSED : NO_CHECKIN };

    const fresh = await encounterService.stateFor(ctx.patientId, active.row.id);
    if (!fresh) return { result: { error: "That check-in could not be read back." } };

    try {
      const assessment = buildAssessment(input as any, fresh.state, fresh.protocol, fresh.region);
      await encounterService.saveAssessment(ctx.patientId, active.row.id, assessment);
      // What the answers allow for training, so a request made before the check-in gets its answer now.
      const gate = await encounterService.trainingGate(ctx.patientId, ctx.threadId).catch(() => null);
      return {
        result: {
          assessed: true,
          checkinId: active.row.id,
          possibilities: assessment.possibilities.map((p) => p.condition),
          nextStep: assessment.nextStep,
          ...(gate
            ? {
                training:
                  gate.level === "hold"
                    ? "No training is designed while this stands. If they asked for training help, say so in one line."
                    : gate.level === "general"
                    ? "A general, lighter session or week can be designed now (not one aimed at the symptom). If they asked for training help earlier in this conversation, offer it in ONE line here and design it when they say yes — don't leave the request unanswered."
                    : "Training requests are designed as usual. If they asked for training help earlier in this conversation, offer it in one line here.",
              }
            : {}),
          note:
            "The card carries the possibilities, the warning signs, the route and the disclaimer. In your reply: one or two lines, no repetition of the list, and offer the summary they can take to a visit. Never call this a diagnosis. If they asked for anything else earlier that you set aside for the check-in (a look at their data, a log, a plan), come back to it now in one line.",
        },
        cards: [{ type: "checkin_assessment", title: `What this could be · ${fresh.protocol.title}`, data: { checkinId: active.row.id, about: fresh.protocol.title, ...assessment } }],
      };
    } catch (e: any) {
      if (e instanceof AssessmentRejected) {
        console.warn(`[checkin] assessment rejected: ${e.message}`);
        return { result: { rejected: true, fix: e.message } };
      }
      throw e;
    }
  },
});

export const endCheckin = defineTool({
  name: "end_checkin",
  description:
    "End the check-in running in this conversation because the user does not want it: 'I didn't mean to start a check-in', 'skip the questions, just give me the session', 'stop'. Same as the app's End button — answers are kept and it can be picked back up with resume_checkin. Then answer what they actually asked in the SAME turn. Never call it because YOU are done asking — that is assess_checkin.",
  schema: z.object({}),
  risk: "read",
  async run(ctx) {
    const active = await encounterService.activeForThread(ctx.patientId, ctx.threadId);
    if (!active) return { result: NO_CHECKIN };
    await encounterService.pause(ctx.patientId, active.row.id);
    return {
      result: {
        ended: true,
        about: active.protocol.title,
        note: "Ended; nothing else to say about it (no 'paused', 'saved', 'recorded'). Now answer what they asked. A training request goes to the design tools, which keep it general and lighter because the screening was not finished — say that once, in one line, and never that a check-in or a clinician has to come first.",
      },
    };
  },
});

export const resumeCheckin = defineTool({
  name: "resume_checkin",
  description:
    "Pick a PAUSED check-in in this conversation back up where it stopped — their answers are kept. Call it only when they say yes to continuing, or ask to. Returns what is covered and what to ask next.",
  schema: z.object({}),
  risk: "read",
  async run(ctx) {
    const paused = await encounterService.pausedForThread(ctx.patientId, ctx.threadId);
    const resumed = paused ? await encounterService.resume(ctx.patientId, paused.row.id) : null;
    if (!resumed) return { result: NO_CHECKIN };
    const plan = protocolPlan(resumed.protocol, resumed.state);
    return {
      result: {
        resumed: true,
        about: resumed.protocol.title,
        ...plan,
        // Seen Sep 16 2026: answers given while paused were never recorded, so the
        // red-flag rules never saw them and the handout lacked them — while the
        // model skipped the questions because it remembered the words.
        note:
          "Picked back up. FIRST call record_checkin with every answer they already gave in this conversation that `covers` does not show as answered — especially anything said while it was paused (e.g. 'none of those' for the warning signs, when it started, how it behaves, how bad). Then, if historyComplete, call assess_checkin; otherwise ask only what is still uncovered. Never re-ask something they already told you.",
      },
    };
  },
});

/* ------------------------------ follow-ups ------------------------------ */

/**
 * The follow-up as a conversation (Oct 5 2026). It was three buttons on the
 * old stepped page that answered nothing back, reached only from a dashboard
 * row. Now Ollie asks (`ask_followup` puts the question on the table and the
 * app shows the three answers as chips), the answer is recorded
 * (`record_followup`), and the reply is what the domain layer built: what was
 * written down, the count so far, when the next question comes — never what
 * the change means (encounter/domain/followUp.ts).
 */
const NOT_FOLLOWED =
  "No finished check-in with that id is being followed. The system prompt's 'Check-ins being followed' section lists the ones that are (with their ids); an unfinished or paused check-in is picked back up with resume_checkin instead. Do not call this again for it.";

const pickFollowed = async (ctx: { patientId: string; threadId: string | null }, checkinId?: string) => {
  const all = await encounterService.followed(ctx.patientId);
  if (checkinId) return all.find((e) => e.id === checkinId || e.id.startsWith(checkinId)) ?? null;
  // No id: the one whose question is on the table here, else the only one there is.
  return all.find((e) => e.awaiting?.threadId === ctx.threadId) ?? (all.length === 1 ? all[0] : null);
};

export const askFollowup = defineTool({
  name: "ask_followup",
  description:
    "Put the follow-up question for a finished check-in on the table: how is it now? Call it when a follow-up is due (system prompt, 'Check-ins being followed') and you are about to ask, or when the user asks to follow up on a check-in. Then ask the ONE question it returns — the three answers appear as chips. Records nothing by itself.",
  schema: z.object({ checkinId: z.string().optional().describe("Id from 'Check-ins being followed'. Omit when there is only one.") }),
  risk: "read",
  cardRole: "result",
  async run(ctx, input) {
    const picked = await pickFollowed(ctx, input.checkinId);
    const asked = picked ? await encounterService.askFollowUp(ctx.patientId, picked.id, ctx.threadId) : null;
    if (!asked) return { result: { error: NOT_FOLLOWED } };
    return {
      result: {
        checkinId: asked.id,
        about: asked.complaintTitle,
        inTheirWords: asked.complaintText,
        day: asked.followUp.day,
        reportedSoFar: asked.followUp.trajectory,
        ask: asked.question,
        note: "Ask exactly that ONE question and stop. The answers (Better / No different / Worse) are on screen as chips — do not list them, do not suggest one, and say nothing about how it should be going by now. When they answer, call record_followup.",
      },
    };
  },
});

export const recordFollowup = defineTool({
  name: "record_followup",
  description:
    "Record how a symptom from a finished check-in is now: better, no different or worse. Call it whenever the user tells you — after ask_followup, or unprompted ('my back is much better today'). Returns exactly what to say back.",
  schema: z.object({
    trend: z.enum(["BETTER", "SAME", "WORSE"]).describe("SAME = no different / about the same"),
    note: z.string().max(500).optional().describe("Anything they added, in their own words"),
    checkinId: z.string().optional().describe("Id from 'Check-ins being followed'. Omit when the question was just asked here, or there is only one."),
  }),
  risk: "read",
  cardRole: "result",
  async run(ctx, input) {
    const picked = await pickFollowed(ctx, input.checkinId);
    const done = picked ? await encounterService.recordFollowUp(ctx.patientId, picked.id, input.trend, input.note, ctx.timeZone) : null;
    if (!done) return { result: { error: NOT_FOLLOWED } };
    const { ack } = done;
    const say = [ack.recorded, ack.trajectory, ack.persistence ? `${ack.persistence.line} ${ack.persistence.action}` : null, ack.next].filter(Boolean);
    return {
      result: {
        checkinId: done.id,
        about: done.about,
        say,
        offer: ack.offerRoute ? "Offer ONCE, as a choice not a verdict: a booking with a clinician, a message to the care team, or the written summary to take along." : null,
        note:
          "Your reply is the `say` lines, in your own voice but with nothing added: it was written down, what they have reported so far, when you will ask next. Day numbers count from the check-in, not from when the symptom began — never say 'since it started'. What is NOT yours to say: what the change means, that it is healing / settling / on track / nothing to worry about, how long it should take, or anything to do for the symptom. 'Better' gets a plain acknowledgement, not congratulations on recovering. If they described something NEW (a new symptom, it spread, a warning sign), say that it is new and offer to go through it — record_checkin reopens the check-in.",
      },
    };
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
