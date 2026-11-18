import { describeFinding } from "./describe";
import { detectorBy } from "./registry";

/**
 * THE SIGNALS PAGE, BUILT HERE (Nov 17 2026). One shape for both kinds of
 * signal so they sit in one list — what the person REPORTED (a check-in) and
 * what Ollo NOTICED in their data (a health finding) — and every word, date
 * and state on it is decided in code, here. The app draws; it never counts,
 * compares or phrases. Pure module: the loader (model/overview.ts) hands in
 * rows, this returns cards.
 *
 * Rulings behind it (his, Nov 16 2026):
 *  - CONCERN IS A STATUS, NOT A JUDGEMENT. Act = a warning sign was matched
 *    (only a check-in can match one) · Watch = open, being followed · Low =
 *    closed. Ollo never rates how serious something is. A data signal linked
 *    to a check-in takes the higher of the two. A lab row under Resolved
 *    carries no meter: "Low" beside a value still outside its range would
 *    read as a verdict the status does not make.
 *  - THE CHECK-IN CHART IS DIRECTION ONLY: a step down for "better", flat for
 *    "no different", up for "worse", from the first report. No Mild/Moderate/
 *    Strong — follow-ups do not ask a level.
 *  - A LINKED DATA SIGNAL'S TREND FOLLOWS THE DATA; the check-in is reached
 *    through its own action, not a second trend line.
 *  - A LAB REPORT IS A ONE-DAY EVENT for now (closes the next morning; later
 *    a follow-up the clinician closes). It has no trend, and its action is
 *    "Explain my report" — the same prompt the Labs page sends.
 *
 * Copy discipline as everywhere in signals: what was counted against what,
 * never what it means. The OLLIE line quotes the stored assessment's first
 * possibility as "Most consistent with …", never "looks like".
 */

/* --------------------------------- types --------------------------------- */

export type Tag = { key: "source_data" | "source_reported" | "on_record" | "new_report" | "good_news" | "cant_tell" | "paused" | "in_progress" | "warning" | "followup_due"; text: string };

export type ConcernLevel = "act" | "watch" | "low";
export type Concern = { level: ConcernLevel; label: string; line: string | null } | null;

export type TrendKey = "settling" | "worse" | "flat" | "no_data" | "back" | "easing" | "same";
export type TrendView = { key: TrendKey; label: string; progress?: { done: number; of: number } } | null;

export type ActionKind = "tell_ollie" | "view_note" | "explain_report" | "answer_followup" | "continue_checkin" | "view_chat" | "view_summary";
/**
 * What a button does. `prompt` = sent at once (`/ollie?prompt=`), `draft` =
 * put in the composer for them to finish. `tell_ollie` first asks the server
 * for the finding's thread (POST /signals/findings/:id/thread) so a check-in
 * started there is linked to the finding.
 */
export type Action = { kind: ActionKind; label: string; threadId?: string | null; findingId?: string; checkinId?: string; prompt?: string; draft?: string };

export type NightPoint = { date: string; day: string; value: number | null; off: boolean | null };
export type Evidence =
  | {
      type: "nights";
      vital: string;
      vitalLabel: string;
      unit: string;
      usual: { mean: number; std: number; line: string };
      nights: NightPoint[];
      /** Nights left out before the first point (a long episode is cut to its latest nights). */
      earlierNights: number;
      /** Nights with no data after the last point, drawn as one gap marker instead of a dot each. */
      gapNights: number;
    }
  | { type: "weight"; direction: "up" | "down"; unit: string; changePercent: number; from: { date: string; label: string; value: number }; to: { date: string; label: string; value: number } }
  | { type: "labs"; values: LabValue[]; othersStillOutside: number; line: string | null };

export type LabValue = { name: string; result: string; unit: string | null; range: string | null; previous: string | null; status: "newly_outside" | "moved" | "back_inside" };

export type SignalCard = {
  /** `data:<findingId>` or `checkin:<encounterId>` — the detail route key. */
  key: string;
  kind: "data" | "checkin";
  status: "open" | "resolved";
  tags: Tag[];
  title: string;
  /** For the compact rows under Resolved. */
  shortTitle: string;
  meta: string;
  line: string | null;
  /** Their own words, when they reported it (a check-in, or the one linked to a data signal). */
  you: string | null;
  evidence: Evidence | null;
  concern: Concern;
  trend: TrendView;
  /** Resolved rows: how it ended, one line. */
  closeLabel: string | null;
  actions: Action[];
  findingId: string | null;
  checkinId: string | null;
  /** Newest activity (open) or the close (resolved), for ordering. */
  sortAt: string;
};

export type TimelineRow = { key: "YOU" | "FELT" | "OLLIE" | "LEFT"; text: string };
export type TimelineEntry = { date: string; label: string; tag: { key: string; text: string } | null; current: boolean; rows: TimelineRow[] };

export type CheckinDetail = {
  summary: string;
  concern: Concern;
  trend: TrendView;
  /** Direction only (ruling Nov 16 2026): 0 at the first report, −1 per "better", +1 per "worse". */
  chart: { points: { date: string; label: string; step: number; first: boolean }[]; next: { date: string; label: string } | null } | null;
  timeline: TimelineEntry[];
  nextFollowUp: { date: string; label: string } | null;
  disclaimer: string;
};

/* ------------------------------ input shapes ------------------------------ */

export type FindingRow = {
  id: string;
  detectorKey: string;
  status: "OPEN" | "ONGOING" | "RESOLVED";
  direction: "CONCERN" | "POSITIVE";
  severity: number;
  notifiedSeverity: number | null;
  evidence: any;
  baseline: any;
  /** Local YYYY-MM-DD. */
  firstDetectedAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
  lastDataAt: string | null;
  notifiedAt: string | null;
  quietDays: number;
  closeReason: string | null;
  threadId: string | null;
  encounterId: string | null;
};

export type NightRowLite = { date: string; hrvMs?: number | null; sleepingHr?: number | null; restingHr?: number | null };

export type CheckinRow = {
  id: string;
  title: string;
  /** The catch-all protocol: its title names nothing, so their words do. */
  unnamed: boolean;
  complaintText: string;
  state: "active" | "paused" | "assessed" | "halted" | "closed";
  outcome: string | null;
  threadId: string | null;
  /** Local YYYY-MM-DD of the first report, and of the close. */
  startedOn: string;
  closedOn: string | null;
  /** Newest first. `on` = local YYYY-MM-DD. */
  checkIns: { day: number; trend: "BETTER" | "SAME" | "WORSE"; note: string | null; on: string }[];
  /** Their own 0–10 "at its worst", when answered. */
  severity: number | null;
  /** Unanswered required questions, while the interview is unfinished. */
  questionsLeft: number;
  /** First possibility of the latest stored assessment. */
  topPossibility: string | null;
  /** Criteria matched, sticky. */
  warningSigns: string[];
  followUp: { due: boolean; trajectory: string | null } | null;
  /** Local YYYY-MM-DD of the next ask, when it is being followed. */
  nextAskOn: string | null;
};

/* -------------------------------- helpers -------------------------------- */

const DAY = 86_400_000;
const parse = (d: string) => Date.parse(`${d}T12:00:00Z`);
const daysBetween = (a: string, b: string) => Math.round((parse(b) - parse(a)) / DAY);
const addDays = (d: string, n: number) => new Date(parse(d) + n * DAY).toISOString().slice(0, 10);
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const at = (d: string) => new Date(parse(d));
/** "Mon 5 Oct" */
export const dayLabel = (d: string) => `${WD[at(d).getUTCDay()]} ${at(d).getUTCDate()} ${MO[at(d).getUTCMonth()]}`;
/** "5 Oct" */
const shortDay = (d: string) => `${at(d).getUTCDate()} ${MO[at(d).getUTCMonth()]}`;
/** "5–16 Oct", "28 Sep – 3 Oct" */
const range = (a: string, b: string) =>
  a === b ? shortDay(a) : at(a).getUTCMonth() === at(b).getUTCMonth() ? `${at(a).getUTCDate()}–${shortDay(b)}` : `${shortDay(a)} – ${shortDay(b)}`;
/** "Muscle strain" → "muscle strain", but "COVID-19" and "IBS" stay as written. */
const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);

const CONCERN: Record<ConcernLevel, string> = { act: "Act", watch: "Watch", low: "Low" };
const concernOf = (level: ConcernLevel, line: string | null = null): Concern => ({ level, label: CONCERN[level], line });
const RANK: Record<ConcernLevel, number> = { low: 0, watch: 1, act: 2 };
const higher = (a: Concern, b: Concern): Concern => (!a ? b : !b ? a : RANK[b.level] > RANK[a.level] ? b : a);

/* ------------------------------ data signals ------------------------------ */

const VITAL: Record<string, { label: string; unit: string; sign: -1 | 1 }> = {
  hrvMs: { label: "HRV", unit: "ms", sign: -1 },
  sleepingHr: { label: "Sleeping heart rate", unit: "bpm", sign: 1 },
  restingHr: { label: "Resting heart rate", unit: "bpm", sign: 1 },
};

const SHORT: Record<string, string> = { "recovery.dip": "Overnight readings", "weight.change": "Weight", "labs.report": "Lab report" };

/** Nights in the chart at most; a longer episode shows its latest. */
export const CHART_NIGHTS = 14;
/** After the last night with data, this many empty nights are drawn before the gap marker. */
const GAP_SHOWN = 3;
/** Nights on which the dip judges itself back (resolveAfterDays + 1, read from the registry). */
const nightsToClose = (key: string) => (detectorBy(key)?.resolveAfterDays ?? 3) + 1;
/** "Getting worse": this far past the severity it had when Ollie mentioned it, in bars. */
export const WORSE_BY = 0.5;

/** First night of the run that opened it: the dip fires on the 3rd off night in a row. */
export const runStartOf = (f: FindingRow, runNights: number) => (f.detectorKey === "recovery.dip" ? addDays(f.firstDetectedAt, -(runNights - 1)) : f.firstDetectedAt);

const nightsEvidence = (f: FindingRow, nights: NightRowLite[], inside: (date: string) => boolean | null, today: string, runNights: number): Evidence | null => {
  const vital = typeof f.baseline?.vital === "string" ? f.baseline.vital : "hrvMs";
  const v = VITAL[vital] ?? VITAL.hrvMs;
  const mean = num(f.baseline?.mean);
  const std = num(f.baseline?.std);
  if (mean == null || std == null) return null;
  const start = runStartOf(f, runNights);
  const end = f.resolvedAt ?? today;
  let last = end;
  let gapNights = 0;
  // Closed for lack of data: stop a few nights after the last one with data
  // and say how many more there were, rather than draw three weeks of nothing.
  if (f.lastDataAt && daysBetween(f.lastDataAt, end) > GAP_SHOWN) {
    last = addDays(f.lastDataAt, GAP_SHOWN);
    gapNights = daysBetween(last, end);
  }
  const byDate = new Map(nights.map((n) => [n.date, n]));
  const dates: string[] = [];
  for (let d = start; d <= last; d = addDays(d, 1)) dates.push(d);
  const earlierNights = Math.max(0, dates.length - CHART_NIGHTS);
  const shown = dates.slice(earlierNights);
  const r = (x: number) => Math.round(x);
  return {
    type: "nights",
    vital,
    vitalLabel: v.label,
    unit: v.unit,
    usual: { mean: r(mean), std: r(std), line: `Your usual · ${v.label} ${r(mean)} ± ${r(std)} ${v.unit}` },
    nights: shown.map((date) => {
      const n = byDate.get(date);
      const value = n ? num((n as any)[vital]) : null;
      // `off` is the SAME judgement that counts toward "back to your usual"
      // (every watched vital, the dip's own cut-off) — the dot's colour and the
      // trend's count can never disagree.
      return { date, day: WD[at(date).getUTCDay()].charAt(0), value, off: n ? (inside(date) === null ? null : !inside(date)) : null };
    }),
    earlierNights,
    gapNights,
  };
};

const weightEvidence = (f: FindingRow): Evidence | null => {
  const e = f.evidence ?? {};
  const from = e.from;
  const to = e.to;
  if (!from?.date || !to?.date || num(from.value) == null || num(to.value) == null) return null;
  return {
    type: "weight",
    direction: e.direction === "up" ? "up" : "down",
    unit: e.unit === "lb" ? "lb" : "kg",
    changePercent: num(e.changePercent) ?? 0,
    from: { date: from.date, label: shortDay(from.date), value: from.value },
    to: { date: to.date, label: shortDay(to.date), value: to.value },
  };
};

const labValue = (row: any, status: LabValue["status"]): LabValue => ({
  name: String(row?.testType ?? row?.key ?? "Value"),
  result: String(row?.result ?? ""),
  unit: row?.units ?? null,
  range: row?.referenceRange ?? null,
  previous: row?.previous?.result != null ? String(row.previous.result) : null,
  status,
});

const labsEvidence = (f: FindingRow): Evidence => {
  const e = f.evidence ?? {};
  const still = arr(e.stillFlagged).length;
  return {
    type: "labs",
    values: [...arr(e.newlyFlagged).map((r) => labValue(r, "newly_outside")), ...arr(e.changed).map((r) => labValue(r, "moved")), ...arr(e.backInRange).map((r) => labValue(r, "back_inside"))],
    othersStillOutside: still,
    line: still ? `${plural(still, "other value")} still outside the range, about where ${still === 1 ? "it was" : "they were"}` : null,
  };
};

/** "2 newly outside, 1 back inside" — the close label's short form of the line. */
const labCounts = (f: FindingRow) =>
  [
    arr(f.evidence?.newlyFlagged).length && `${arr(f.evidence.newlyFlagged).length} newly outside`,
    arr(f.evidence?.changed).length && `${arr(f.evidence.changed).length} moved`,
    arr(f.evidence?.backInRange).length && `${arr(f.evidence.backInRange).length} back inside`,
  ]
    .filter(Boolean)
    .join(", ");

const labDate = (f: FindingRow): string => arr(f.evidence?.collectedAt).slice(-1)[0] ?? f.firstDetectedAt;
/** The Labs page's own prompt shape ("Explain my lab report from 6 Oct 2026."), which the eval scenario also sends. */
const explainPrompt = (date: string) => `Explain my lab report from ${at(date).getUTCDate()} ${MO[at(date).getUTCMonth()]} ${at(date).getUTCFullYear()}.`;

export type DataContext = {
  today: string;
  runNights: number;
  /** Nightly rows from well before the run to today (the judgement needs the 60 nights before each). */
  nights: NightRowLite[];
  /** The dip's own per-night judgement (detectors/vitals nightInside), bound to `nights`. */
  inside: (date: string) => boolean | null;
  /** The check-in this finding led to, already built, when there is one. */
  linked: { card: SignalCard; due: boolean; threadId: string | null; complaintText: string; checkIns: number } | null;
};

export const dataCard = (f: FindingRow, ctx: DataContext): SignalCard => {
  const { title, line } = describeFinding(f);
  const isLab = f.detectorKey === "labs.report";
  const linked = ctx.linked;
  // The finding itself closed; the SIGNAL stays open while the check-in it led
  // to is still being followed (that check-in is shown only inside this card).
  const findingClosed = f.status === "RESOLVED";
  const resolved = findingClosed && (!linked || linked.card.status === "resolved");
  const positive = f.direction === "POSITIVE";

  /* evidence + meta */
  let evidence: Evidence | null = null;
  let meta = "";
  if (f.detectorKey === "recovery.dip") {
    evidence = nightsEvidence(f, ctx.nights, ctx.inside, ctx.today, ctx.runNights);
    const start = runStartOf(f, ctx.runNights);
    const end = f.lastDataAt ?? f.lastSeenAt;
    const withData = ctx.nights.filter((n) => n.date >= start && n.date <= (f.resolvedAt ?? ctx.today) && (n.hrvMs != null || n.sleepingHr != null || n.restingHr != null)).length;
    meta = findingClosed ? `${dayLabel(start)} – ${dayLabel(f.resolvedAt!)} · ${plural(withData, "night")}` : `Since ${dayLabel(start)} · ${plural(withData || daysBetween(start, end) + 1, "night")}`;
  } else if (f.detectorKey === "weight.change") {
    evidence = weightEvidence(f);
    const e = f.evidence ?? {};
    meta = e.from?.date && e.to?.date ? `${dayLabel(e.from.date)} → ${dayLabel(e.to.date)} · ${plural(num(e.days) ?? daysBetween(e.from.date, e.to.date), "day")}` : `Since ${dayLabel(f.firstDetectedAt)}`;
  } else if (isLab) {
    evidence = labsEvidence(f);
    const changed = (evidence as any).values.length;
    const total = num(f.evidence?.valuesOnReport);
    meta = `Report of ${dayLabel(labDate(f))} · ${total && total > changed ? `${changed} changed of ${total}` : plural(changed, "value")}`;
  } else {
    meta = `Since ${dayLabel(f.firstDetectedAt)}`;
  }
  if (linked) meta += ` · ${plural(linked.checkIns, "check-in")}`;

  /* concern */
  const own: Concern = isLab && findingClosed ? null : findingClosed || positive ? concernOf("low") : concernOf("watch");
  const concern = linked ? higher(own, linked.card.concern) : own;

  /* trend — the data's, even when a check-in is linked */
  let trend: TrendView = null;
  if (!isLab) {
    if (findingClosed) {
      trend =
        f.closeReason === "no_data"
          ? { key: "no_data", label: "No new data" }
          : f.closeReason === "quiet"
          ? { key: "back", label: f.detectorKey === "weight.change" ? "Back under a 5% change" : "Back to your usual" }
          : null;
    } else {
      const stale = f.detectorKey === "recovery.dip" && f.lastDataAt && daysBetween(f.lastDataAt, ctx.today) > 1;
      const of = nightsToClose(f.detectorKey);
      if (stale) trend = { key: "no_data", label: `No new data since ${dayLabel(f.lastDataAt!)}` };
      else if (f.quietDays > 0)
        trend = {
          key: "settling",
          label: f.detectorKey === "weight.change" ? `${f.quietDays} of ${plural(of, "weigh-in")} back under 5%` : `${f.quietDays} of ${of} nights back`,
          progress: { done: f.quietDays, of },
        };
      else if (f.notifiedSeverity != null && f.severity >= f.notifiedSeverity + WORSE_BY) trend = { key: "worse", label: "Getting worse" };
      else trend = { key: "flat", label: "Flat" };
    }
  }

  /* tags */
  const tags: Tag[] = [{ key: "source_data", text: "Noticed in your data" }];
  if (linked) tags.push({ key: "source_reported", text: "You reported" });
  if (isLab && !findingClosed) tags.push(positive ? { key: "good_news", text: "Good news" } : { key: "new_report", text: "New report" });
  else if (positive) tags.push({ key: "good_news", text: "Good news" });
  if (!findingClosed && !f.notifiedAt && !linked && !isLab) tags.push({ key: "on_record", text: "On record only" });
  if (findingClosed && f.closeReason === "no_data") tags.push({ key: "cant_tell", text: "Closed · can't tell" });

  /* close label */
  let closeLabel: string | null = null;
  if (resolved) {
    const end = f.resolvedAt!;
    closeLabel =
      f.closeReason === "no_data"
        ? `No data since ${shortDay(f.lastDataAt ?? f.lastSeenAt)} · can't tell`
        : f.closeReason === "replaced"
        ? `Replaced by a newer report · ${shortDay(labDate(f))}`
        : isLab
        ? `Report of ${shortDay(labDate(f))}${labCounts(f) ? ` · ${labCounts(f)}` : ""}`
        : f.detectorKey === "weight.change"
        ? `Back under a 5% change · ${range(f.firstDetectedAt, end)}`
        : `Back to your usual · ${range(runStartOf(f, ctx.runNights), end)}`;
  }

  /* line — the server's, with "no data" said where it applies */
  // The detector's evidence only ever holds the 3-night window it last judged
  // ("3 nights running" on day 9 of a dip); the page counts the episode's nights.
  let ownLine = line || null;
  if (evidence?.type === "nights") {
    const judged = evidence.nights.filter((n) => n.off !== null);
    const off = judged.filter((n) => n.off).length;
    const names = line.split(" away from")[0];
    if (judged.length && names) ownLine = `${names} away from your usual on ${off} of ${plural(judged.length, "night")}`;
  }
  const cardLine = findingClosed && f.closeReason === "no_data" ? `No data since ${dayLabel(f.lastDataAt ?? f.lastSeenAt)}, so there is no way to tell how it went.` : ownLine;

  /* actions */
  const actions: Action[] = [];
  const note: Action | null = f.notifiedAt && f.threadId ? { kind: "view_note", label: "View note", threadId: f.threadId, findingId: f.id } : null;
  if (isLab) {
    if (!positive) actions.push({ kind: "explain_report", label: "Explain my report", prompt: explainPrompt(labDate(f)) });
    if (note) actions.push(note);
  } else if (linked) {
    if (linked.due) actions.push({ kind: "answer_followup", label: "Answer follow-up", checkinId: linked.card.checkinId!, prompt: followUpPrompt(linked.complaintText) });
    else if (linked.threadId) actions.push({ kind: "view_chat", label: "View chat", threadId: linked.threadId, checkinId: linked.card.checkinId! });
    if (note && note.threadId !== linked.threadId) actions.push(note);
  } else {
    if (!findingClosed && !positive) actions.push({ kind: "tell_ollie", label: "Tell Ollie how you feel", findingId: f.id, threadId: f.threadId, draft: "How I've been feeling: " });
    if (note) actions.push(note);
  }

  return {
    key: `data:${f.id}`,
    kind: "data",
    status: resolved ? "resolved" : "open",
    tags,
    title,
    shortTitle: SHORT[f.detectorKey] ?? title,
    meta,
    line: cardLine,
    you: linked?.complaintText ?? null,
    evidence,
    concern,
    trend,
    closeLabel,
    actions,
    findingId: f.id,
    checkinId: linked?.card.checkinId ?? null,
    sortAt: findingClosed ? f.resolvedAt! : [f.lastSeenAt, f.lastDataAt ?? ""].sort().slice(-1)[0],
  };
};

/* -------------------------------- check-ins -------------------------------- */

/** The dashboard row's prompt, so a follow-up asked from here takes the path Ollie already knows. */
export const followUpPrompt = (complaintText: string) => `Follow up on my check-in: "${complaintText.trim().slice(0, 120)}"`;
/** What "Pick it up" in the chat header sends. */
export const RESUME_PROMPT = "Let's pick the check-in back up.";

const TREND_OF: Record<"BETTER" | "SAME" | "WORSE", { key: TrendKey; label: string; felt: string; step: number }> = {
  BETTER: { key: "easing", label: "Easing", felt: "Better", step: -1 },
  SAME: { key: "same", label: "No different", felt: "No different", step: 0 },
  WORSE: { key: "worse", label: "Getting worse", felt: "Worse", step: 1 },
};

const checkinTitle = (c: CheckinRow) => (c.unnamed ? c.complaintText.trim().replace(/\s+/g, " ").slice(0, 60) : c.title);

const checkinConcern = (c: CheckinRow): Concern =>
  c.warningSigns.length
    ? concernOf("act", c.warningSigns.length === 1 ? "A warning sign was matched" : `${c.warningSigns.length} warning signs were matched`)
    : c.state === "closed"
    ? concernOf("low", "No warning signs")
    : concernOf("watch", "No warning signs so far");

const checkinTrend = (c: CheckinRow): TrendView => {
  const latest = c.checkIns[0];
  if (!latest) return null;
  const t = TREND_OF[latest.trend];
  return { key: t.key, label: t.label };
};

const OUTCOME_LINE: Record<string, string> = {
  resolved: "Closed after you said it was better.",
  persisted: "Closed at day 14; your last answer was not better.",
  lapsed: "Closed with no follow-up answered.",
  escalated: "Closed after a warning sign was matched; the next step was care.",
};

const summaryOf = (c: CheckinRow): string => {
  if (c.state === "closed") return OUTCOME_LINE[c.outcome ?? ""] ?? "Closed.";
  if (c.warningSigns.length) return "A warning sign was matched, so it isn't followed up with questions.";
  if (c.state === "active" || c.state === "paused")
    return c.questionsLeft ? `The check-in isn't finished: ${plural(c.questionsLeft, "question")} left.` : "The check-in isn't finished.";
  if (c.followUp?.trajectory) return c.followUp.trajectory;
  return "No follow-up answered yet.";
};

const checkinTags = (c: CheckinRow): Tag[] => {
  const tags: Tag[] = [];
  if (c.state === "paused") tags.push({ key: "paused", text: "Check-in paused" });
  else if (c.state === "active") tags.push({ key: "in_progress", text: "Check-in in progress" });
  if (c.warningSigns.length) tags.push({ key: "warning", text: "Warning sign" });
  if (c.followUp?.due && c.state !== "closed") tags.push({ key: "followup_due", text: "Follow-up due" });
  tags.push({ key: "source_reported", text: "You reported" });
  return tags;
};

const checkinActions = (c: CheckinRow): Action[] => {
  const out: Action[] = [];
  const chat: Action | null = c.threadId ? { kind: "view_chat", label: "View chat", threadId: c.threadId, checkinId: c.id } : null;
  if ((c.state === "paused" || c.state === "active") && c.threadId)
    out.push({ kind: "continue_checkin", label: "Continue check-in", threadId: c.threadId, checkinId: c.id, prompt: c.state === "paused" ? RESUME_PROMPT : undefined });
  else if (c.followUp?.due && c.state !== "closed") out.push({ kind: "answer_followup", label: "Answer follow-up", checkinId: c.id, prompt: followUpPrompt(c.complaintText) });
  if (chat) out.push(chat);
  else if (c.state !== "active" && c.state !== "paused") out.push({ kind: "view_summary", label: "View summary", checkinId: c.id });
  return out;
};

export const checkinCard = (c: CheckinRow): SignalCard => {
  const resolved = c.state === "closed";
  const count = 1 + c.checkIns.length;
  const newest = c.checkIns[0]?.on ?? c.startedOn;
  return {
    key: `checkin:${c.id}`,
    kind: "checkin",
    status: resolved ? "resolved" : "open",
    tags: checkinTags(c),
    title: checkinTitle(c),
    shortTitle: checkinTitle(c),
    meta: resolved ? `${dayLabel(c.startedOn)} · ${plural(count, "check-in")}` : `Since ${dayLabel(c.startedOn)} · ${plural(count, "check-in")}`,
    line: summaryOf(c),
    you: c.complaintText,
    evidence: null,
    concern: checkinConcern(c),
    trend: checkinTrend(c),
    closeLabel: resolved ? `${OUTCOME_LINE[c.outcome ?? ""]?.replace(/\.$/, "") ?? "Closed"} · ${range(c.startedOn, c.closedOn ?? newest)}` : null,
    actions: checkinActions(c),
    findingId: null,
    checkinId: c.id,
    sortAt: resolved ? c.closedOn ?? newest : newest,
  };
};

export const checkinDetail = (c: CheckinRow, disclaimer: string): CheckinDetail => {
  const oldestFirst = [...c.checkIns].reverse();
  let step = 0;
  const points = [{ date: c.startedOn, label: shortDay(c.startedOn), step: 0, first: true }];
  for (const ci of oldestFirst) {
    step += TREND_OF[ci.trend].step;
    points.push({ date: ci.on, label: shortDay(ci.on), step, first: false });
  }
  // Due now = asked today (the sweep puts the question in the chat at 09:00).
  const next = c.nextAskOn ? { date: c.nextAskOn, label: c.followUp?.due ? "Today" : dayLabel(c.nextAskOn) } : null;

  const first: TimelineRow[] = [{ key: "YOU", text: c.complaintText.trim() }];
  if (c.severity != null) first.push({ key: "FELT", text: `${c.severity} out of 10 at its worst` });
  if (c.topPossibility || c.warningSigns.length || c.state === "assessed")
    first.push({
      key: "OLLIE",
      text: [c.topPossibility ? `Most consistent with ${lowerFirst(c.topPossibility)}.` : null, c.warningSigns.length ? `Warning sign: ${c.warningSigns[0]}.` : "No warning signs."]
        .filter(Boolean)
        .join(" "),
    });
  if ((c.state === "active" || c.state === "paused") && c.questionsLeft) first.push({ key: "LEFT", text: `${plural(c.questionsLeft, "question")} left` });

  const timeline: TimelineEntry[] = [
    ...c.checkIns.map((ci, i) => ({
      date: ci.on,
      label: dayLabel(ci.on),
      tag: { key: "day", text: `Day ${ci.day}` },
      current: i === 0 && c.state !== "closed",
      rows: [...(ci.note ? [{ key: "YOU" as const, text: ci.note }] : []), { key: "FELT" as const, text: TREND_OF[ci.trend].felt }],
    })),
    {
      date: c.startedOn,
      label: dayLabel(c.startedOn),
      tag: c.state === "paused" ? { key: "paused", text: "Paused" } : c.state === "active" ? { key: "in_progress", text: "In progress" } : { key: "first", text: "First report" },
      current: !c.checkIns.length && c.state !== "closed",
      rows: first,
    },
  ];

  return {
    summary: summaryOf(c),
    concern: checkinConcern(c),
    trend: checkinTrend(c),
    chart: c.checkIns.length ? { points, next } : null,
    timeline,
    nextFollowUp: c.state !== "closed" && !c.warningSigns.length ? next : null,
    disclaimer,
  };
};

/* --------------------------------- the page -------------------------------- */

export type Overview = { open: SignalCard[]; resolved: SignalCard[]; meta: string };

/** Open newest-first by activity, resolved newest-first by close. A check-in linked to a data signal is inside that card, not listed again. */
export const overviewOf = (cards: SignalCard[], linkedCheckinIds: Set<string>): Overview => {
  const shown = cards.filter((c) => !(c.kind === "checkin" && c.checkinId && linkedCheckinIds.has(c.checkinId)));
  const byNewest = (a: SignalCard, b: SignalCard) => b.sortAt.localeCompare(a.sortAt);
  const open = shown.filter((c) => c.status === "open").sort(byNewest);
  const resolved = shown.filter((c) => c.status === "resolved").sort(byNewest);
  return { open, resolved, meta: `${open.length} open · ${resolved.length} resolved` };
};
