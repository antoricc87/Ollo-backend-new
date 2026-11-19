import moment from "moment-timezone";
import { Hours, Slot, Taken } from "./types";

/**
 * Free appointment times from opening hours, pure. Steps of `minutes`
 * (rounded up to 15), never in the past or within `leadMinutes` of now,
 * never overlapping a taken time. `busy(start)` lets a network mark times
 * that are taken by other people (the simulated network uses a hash).
 */
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

export const slotsFrom = (opts: {
  hours: Hours;
  timeZone: string;
  minutes: number;
  from: Date;
  days: number;
  taken: Taken[];
  now?: Date;
  leadMinutes?: number;
  busy?: (startsAt: Date) => boolean;
}): Slot[] => {
  const step = Math.max(15, Math.ceil(opts.minutes / 15) * 15);
  const now = opts.now ?? new Date();
  const earliest = now.getTime() + (opts.leadMinutes ?? 120) * 60_000;
  const out: Slot[] = [];
  const day0 = moment(opts.from).tz(opts.timeZone).startOf("day");
  for (let d = 0; d < opts.days; d++) {
    const day = day0.clone().add(d, "days");
    const open = opts.hours[DAYS[day.day()]];
    if (!open) continue;
    const [oh, om] = open[0].split(":").map(Number);
    const [ch, cm] = open[1].split(":").map(Number);
    const close = day.clone().hour(ch).minute(cm);
    for (let t = day.clone().hour(oh).minute(om); t.clone().add(step, "minutes").isSameOrBefore(close); t.add(step, "minutes")) {
      const start = t.toDate();
      const end = t.clone().add(opts.minutes, "minutes").toDate();
      if (start.getTime() < earliest) continue;
      if (opts.taken.some((k) => start < k.endsAt && end > k.startsAt)) continue;
      if (opts.busy?.(start)) continue;
      out.push({ startsAt: start.toISOString(), endsAt: end.toISOString() });
    }
  }
  return out;
};
