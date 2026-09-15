import { z } from "zod";
import prisma from "../../../utility/prismaClient";
import { defineTool } from "./registry";
import { resolveProtocol } from "../../encounter/domain/protocols";
import { TrippedFlag } from "../../encounter/domain/types";

/**
 * The handoff: symptoms leave the open chat and enter the bounded flow.
 *
 * `start_encounter` deliberately does NOT create anything. It offers the
 * check-in as a card; tapping it opens the stepped flow, and the encounter is
 * created there from the patient's own words. Two reasons:
 *   - the tap IS the opt-in, so a confirm-gated proposal would ask twice;
 *   - an offer the user ignores leaves no half-finished encounter behind.
 * (This deviates from docs/ai-check-in-architecture.md §7.3, which sketched it
 * as a proposal. Proposals here are for writes to the patient's record; this
 * is navigation.)
 *
 * The compliance value is in what Ollie does NEXT: it stops answering. That
 * rule lives in prompt/system.ts — a guard can only stop a wrong answer, while
 * this produces the right one.
 */

export const startEncounter = defineTool({
  name: "start_encounter",
  description:
    "Offer the check-in when the user describes a physical or mental symptom they are having (pain, breathlessness, a rash, dizziness, exhaustion, low mood…). Pass their own words as `complaint`. Call this INSTEAD of discussing the symptom: you cannot say what is causing it, but the check-in takes a proper history and produces something they can hand a clinician. Do not call it for questions about a condition already on their record, or for food, training or sleep coaching.",
  schema: z.object({
    complaint: z.string().min(2).max(1000).describe("The user's own description of the symptom, in their words. Do not summarise or rename it."),
  }),
  risk: "read",
  async run(_ctx, input) {
    const complaint = input.complaint.trim();
    // Named only so the card can say what it will ask about — never shown as a finding.
    const protocol = resolveProtocol(null);
    return {
      result: {
        offered: true,
        complaint,
        note: "The check-in was offered as a card. Do not describe possible causes. Say in one line what it does and let them tap it.",
      },
      cards: [
        {
          type: "checkin_offer",
          title: "Check in about this",
          data: {
            complaint,
            takes: "about two minutes",
            produces: "a summary you can show a clinician",
            fallbackTitle: protocol.title,
          },
        },
      ],
    };
  },
});

export const getEncounters = defineTool({
  name: "get_encounters",
  description:
    "The user's past and open check-ins: what they reported, when, and whether anything they told us matched a red-flag criterion. Use to follow up ('how's that headache?') or before booking, so the visit reason is accurate.",
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
