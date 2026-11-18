import { Episode } from "./episodes";
import { domainOf, isEventDetector } from "./registry";

/**
 * WHAT COMES AFTER THE NOTE (rulings Nov 16 2026). A health signal someone was
 * told about is followed by its own data — Ollie still never asks whether it
 * has passed (ruling Sep 24) — and each change of state is said once:
 *
 *   still_going    open STILL_GOING_DAYS after it started and still firing →
 *                  one note that says so and offers a check-in about how
 *                  they feel (a check-in started in that thread is linked).
 *   back_to_usual  it closed because the data came back inside the bar →
 *                  one short note. Never for a "no_data" close: silence from
 *                  the sensor is not good news.
 *
 * "Worse" is not here: an escalation competes in the budget (budget.ts) like
 * any first mention, measured against the severity it had when told.
 *
 * Both follow-ups ride outside the weekly budget — they continue a
 * conversation already started rather than starting a new one — and both are
 * written into the original note's thread, so one signal is one conversation.
 * Only HEALTH findings that were notified qualify: habits are never notes now
 * (they go to the weekly review), and an event finding (a lab report) is a
 * point in time with nothing to follow.
 */

export const STILL_GOING_DAYS = 7;
/** "Still going" needs it to be still firing, not merely still open for want of data. */
const STILL_FIRING_WITHIN_DAYS = 1;

export type FollowUpKind = "still_going" | "back_to_usual";

export type FollowUpEvent = { detectorKey: string; kind: FollowUpKind; episode: Episode };

const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

const eligible = (e: Episode) => e.direction === "CONCERN" && !!e.notifiedAt && domainOf(e.detectorKey) === "health" && !isEventDetector(e.detectorKey);

/** `episodes` = the day's fold; `resolvedToday` = what closed in it. */
export const followUpsFor = (episodes: Episode[], resolvedToday: Episode[], today: string): FollowUpEvent[] => {
  const out: FollowUpEvent[] = [];
  for (const e of resolvedToday) {
    if (!eligible(e) || e.closeReason !== "quiet" || e.followUps.backToUsual) continue;
    out.push({ detectorKey: e.detectorKey, kind: "back_to_usual", episode: e });
  }
  for (const e of episodes) {
    if (e.status === "RESOLVED" || !eligible(e) || e.followUps.stillGoing || e.encounterId) continue;
    if (daysBetween(e.firstDetectedAt, today) < STILL_GOING_DAYS) continue;
    if (daysBetween(e.lastSeenAt, today) > STILL_FIRING_WITHIN_DAYS) continue;
    out.push({ detectorKey: e.detectorKey, kind: "still_going", episode: e });
  }
  return out;
};
