import moment from "moment-timezone";
import { NotifyState } from "../domain/budget";
import { Episode, stillOpen } from "../domain/episodes";
import { carryOpen, runDay } from "../domain/run";
import { SignalInput } from "../domain/types";

/**
 * THE REPLAY HARNESS — walk a patient's history one day at a time and count
 * what WOULD have fired.
 *
 * This exists because thresholds cannot be argued into correctness. The
 * question that decides whether the feature is any good is "how often does
 * this interrupt someone", and the only honest way to answer it before there
 * are users is to run the real engine over real history and count. Tune until
 * the rate is one or two a week, then stop.
 *
 *   npx ts-node --transpile-only src/services/signals/replay/cli.ts --patient <id>
 *   npx ts-node --transpile-only src/services/signals/replay/cli.ts --file series.json
 */

export type ReplayDay = {
  date: string;
  candidates: { key: string; severity: number; label: string }[];
  notified: { key: string; severity: number; label: string }[];
  /** Why each candidate was held back, for reading the tuning back. */
  withheld: { key: string; reason: string }[];
};

export type ReplayResult = {
  days: ReplayDay[];
  from: string;
  to: string;
  weeks: number;
  totals: { candidates: number; episodes: number; notifications: number; positives: number };
  perWeek: number;
  byDetector: Record<string, { episodes: number; notifications: number }>;
};

/** A day's slice of a full-history input: the detectors only ever look
 *  backwards, so replaying day N is the same input truncated at N. */
const truncate = (full: SignalInput, today: string, open: Episode[]): SignalInput => ({
  ...full,
  today,
  nights: full.nights.filter((n) => n.date <= today),
  days: full.days.filter((d) => d.date <= today),
  workouts: full.workouts.filter((w) => w.date <= today),
  weights: full.weights.filter((w) => w.date <= today),
  openFindings: open.map((e) => ({ detectorKey: e.detectorKey, firstDetectedAt: e.firstDetectedAt, peakSeverity: e.peakSeverity })),
});

/** Monday-anchored week key, so the weekly budget is counted the way it is spent. */
const weekKey = (date: string, tz: string) => moment.tz(date, tz).startOf("isoWeek").format("YYYY-MM-DD");

export const replay = (full: SignalInput, opts: { from?: string; to?: string } = {}): ReplayResult => {
  const dates = [...new Set([...full.nights.map((n) => n.date), ...full.days.map((d) => d.date)])].sort();
  const from = opts.from ?? dates[0] ?? full.today;
  const to = opts.to ?? full.today;

  let open: Episode[] = [];
  const lastNotifiedAt: Record<string, string | undefined> = {};
  const lastNotifiedSeverity: Record<string, number | undefined> = {};
  let week = "";
  let sentThisWeek: NotifyState["sentThisWeek"] = [];

  const out: ReplayDay[] = [];
  const byDetector: ReplayResult["byDetector"] = {};
  let episodes = 0;
  let notifications = 0;
  let positives = 0;

  for (let cursor = moment.tz(from, full.timeZone); cursor.format("YYYY-MM-DD") <= to; cursor.add(1, "day")) {
    const today = cursor.format("YYYY-MM-DD");
    const thisWeek = weekKey(today, full.timeZone);
    if (thisWeek !== week) {
      week = thisWeek;
      sentThisWeek = [];
    }

    const run = runDay(truncate(full, today, open), open, { sentThisWeek, lastNotifiedAt, lastNotifiedSeverity });

    for (const episode of run.opened) {
      episodes += 1;
      byDetector[episode.detectorKey] ??= { episodes: 0, notifications: 0 };
      byDetector[episode.detectorKey].episodes += 1;
    }

    const notified: ReplayDay["notified"] = [];
    for (const decision of run.decisions.filter((d) => d.notify)) {
      const { detectorKey, severity, direction, label } = decision.candidate;
      lastNotifiedAt[detectorKey] = today;
      lastNotifiedSeverity[detectorKey] = severity;
      sentThisWeek = [...sentThisWeek, { detectorKey, direction }];
      notifications += 1;
      if (direction === "POSITIVE") positives += 1;
      byDetector[detectorKey] ??= { episodes: 0, notifications: 0 };
      byDetector[detectorKey].notifications += 1;
      notified.push({ key: detectorKey, severity, label });
    }

    out.push({
      date: today,
      candidates: run.candidates.map((c) => ({ key: c.detectorKey, severity: c.severity, label: c.label })),
      notified,
      withheld: run.decisions.filter((d) => !d.notify).map((d) => ({ key: d.candidate.detectorKey, reason: d.reason })),
    });
    open = carryOpen(run);
  }

  const spanDays = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1);
  const weeks = spanDays / 7;
  return {
    days: out,
    from,
    to,
    weeks: Math.round(weeks * 10) / 10,
    totals: { candidates: out.reduce((acc, d) => acc + d.candidates.length, 0), episodes, notifications, positives },
    perWeek: Math.round((notifications / weeks) * 100) / 100,
    byDetector,
  };
};

/** The one number the tuning is for, plus enough detail to see where it came from. */
export const formatReplay = (r: ReplayResult): string => {
  const lines: string[] = [];
  lines.push(`replay ${r.from} → ${r.to}  (${r.weeks} weeks)`);
  lines.push(`  episodes ${r.totals.episodes}   notifications ${r.totals.notifications} (${r.totals.positives} positive)   →  ${r.perWeek} per week`);
  lines.push("");
  lines.push("  detector                   episodes  notified");
  for (const [key, v] of Object.entries(r.byDetector).sort((a, b) => b[1].notifications - a[1].notifications)) {
    lines.push(`  ${key.padEnd(26)} ${String(v.episodes).padStart(8)}  ${String(v.notifications).padStart(8)}`);
  }
  const fired = r.days.filter((d) => d.notified.length);
  if (fired.length) {
    lines.push("");
    lines.push("  what would have been sent");
    for (const day of fired) for (const n of day.notified) lines.push(`  ${day.date}  ${n.key.padEnd(24)} ${String(n.severity).padStart(5)}  ${n.label}`);
  }
  return lines.join("\n");
};

export const stillOpenAfter = stillOpen;
