import moment from "moment-timezone";
import prisma from "../../utility/prismaClient";
import { safeTz } from "../agent/memory/dates";
import threadStore from "../agent/memory/thread.store";
import { getPreference, SIGNAL_SCAN_HOUR } from "../agent/proactive/proactive.service";
import { queueNotification } from "../notifications/notifications.service";
import { SINGLE_LINES } from "../notifications/gate";
import EncounterService from "./model/encounter.model";

/**
 * THE MORNING CHECK-IN SWEEP (Nov 16 2026), once a day per patient at the
 * scan hour, before the digest in the same tick:
 *   1. close what the rules say is over (resolved / persisted / lapsed /
 *      escalated) — check-ins used to stay OPEN for ever;
 *   2. a follow-up due today is ASKED in the check-in's own conversation —
 *      the question (code-built, the same one Ollie asks in chat) is written
 *      there and the answer chips show — and a digest line says one is due.
 *      The push names the work, never the symptom.
 * Asking here logs `followup_asked` for the slot, so Ollie does not raise the
 * same question again in chat. A check-in with no conversation (the retired
 * stepped flow) gets the push only, and Ollie asks in the next chat.
 */

export const queueDueFollowUps = async (patientId: string) => {
  const pref = await getPreference(patientId);
  if (!pref.proactiveEnabled) return [];
  const due = (await EncounterService.followed(patientId)).filter((e) => e.raise && !e.answeredToday && !e.awaiting);
  const out: { id: string; threadId: string | null; status: string }[] = [];
  for (const e of due) {
    const slot = e.followUp.slot;
    let threadId: string | null = null;
    if (e.threadId && (await prisma.agentThread.findFirst({ where: { id: e.threadId, patientId, archivedAt: null }, select: { id: true } }))) {
      const asked = await EncounterService.askFollowUp(patientId, e.id, e.threadId);
      if (asked) {
        await threadStore.append(e.threadId, [{ role: "ASSISTANT", content: asked.question, meta: { followupAsked: { checkinId: e.id, day: e.followUp.day, via: "push" } } }]);
        await threadStore.markUnseen(e.threadId);
        threadId = e.threadId;
      }
    }
    const row = await queueNotification({
      userId: patientId,
      kind: "checkin_followup",
      title: "Ollie",
      body: SINGLE_LINES.checkin_followup,
      route: threadId ? `ollie?threadId=${threadId}` : "ollie",
      threadId,
      dedupeKey: `checkin_followup:${e.id}:${slot}`,
      mode: "digest",
    });
    out.push({ id: e.id, threadId, status: row.status });
  }
  return out;
};

export const runCheckinsFor = async (patientId: string) => {
  const closed = await EncounterService.autoCloseFor(patientId);
  const asked = await queueDueFollowUps(patientId);
  return { closed, asked };
};

/** Called once per UTC hour by the agent tick: patients whose local clock is at the scan hour. */
export const runCheckinsDue = async (now = new Date()) => {
  const patients = await prisma.patient.findMany({
    where: { subAccountOf: null, encounters: { some: { status: { in: ["OPEN", "ABANDONED"] } } } },
    select: { id: true, timeZone: true },
  });
  let closed = 0;
  let asked = 0;
  for (const p of patients) {
    if (moment(now).tz(safeTz(p.timeZone)).hour() !== SIGNAL_SCAN_HOUR) continue;
    try {
      const r = await runCheckinsFor(p.id);
      closed += r.closed.length;
      asked += r.asked.length;
    } catch (e) {
      console.error(`check-in sweep failed for ${p.id}`, e);
    }
  }
  return { closed, asked };
};
