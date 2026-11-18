import moment from "moment-timezone";
import prisma from "../../../utility/prismaClient";
import encounterService from "../../encounter/model/encounter.model";
import { CHECKIN_DISCLAIMER } from "../../encounter/domain/assessment";
import { NightRow } from "../domain/baseline";
import { nightInside, RUN_NIGHTS } from "../domain/detectors/vitals";
import { domainOf } from "../domain/registry";
import { checkinCard, checkinDetail, CheckinDetail, CheckinRow, dataCard, FindingRow, Overview, overviewOf, runStartOf, SignalCard } from "../domain/view";

/**
 * The Signals page, loaded (Nov 17 2026). Reads the rows and hands them to
 * domain/view.ts, which decides every word. HEALTH findings only (ruling Oct
 * 12 2026: habits go to the weekly review) plus every check-in; a check-in a
 * finding led to is shown inside that finding's card.
 */

/** Nights before an episode the per-night judgement needs (its baseline is the 60 before each night). */
const BASELINE_LEAD_DAYS = 70;

const tzOf = async (patientId: string) =>
  (await prisma.patient.findUnique({ where: { id: patientId }, select: { timeZone: true } }))?.timeZone || "UTC";

const local = (d: Date | null, tz: string) => (d ? moment(d).tz(tz).format("YYYY-MM-DD") : null);

const findingRow = (r: any, tz: string): FindingRow => ({
  id: r.id,
  detectorKey: r.detectorKey,
  status: r.status,
  direction: r.direction,
  severity: r.severity,
  notifiedSeverity: r.notifiedAt ? r.notifiedSeverity ?? r.severity : null,
  evidence: r.evidence ?? {},
  baseline: r.baseline ?? null,
  firstDetectedAt: local(r.firstDetectedAt, tz)!,
  lastSeenAt: local(r.lastSeenAt, tz)!,
  resolvedAt: local(r.resolvedAt, tz),
  lastDataAt: local(r.lastDataAt, tz),
  notifiedAt: local(r.notifiedAt, tz),
  quietDays: r.quietDays ?? 0,
  closeReason: r.closeReason ?? null,
  threadId: r.threadId ?? null,
  encounterId: r.encounterId ?? null,
});

type Loaded = { tz: string; today: string; findings: FindingRow[]; checkins: CheckinRow[]; nights: NightRow[] };

const load = async (patientId: string, opts: { findingIds?: string[]; checkinIds?: string[] } = {}): Promise<Loaded> => {
  const tz = await tzOf(patientId);
  const today = moment().tz(tz).format("YYYY-MM-DD");
  const raw = opts.checkinIds && !opts.findingIds
    ? []
    : await prisma.finding.findMany({
        where: { patientId, ...(opts.findingIds ? { id: { in: opts.findingIds } } : {}) },
        orderBy: { firstDetectedAt: "desc" },
        take: 200,
      });
  const findings = raw.filter((r) => domainOf(r.detectorKey) === "health").map((r) => findingRow(r, tz));
  const linkedIds = findings.map((f) => f.encounterId).filter((x): x is string => !!x);
  const checkinIds = opts.findingIds ? linkedIds : opts.checkinIds;
  const checkins = checkinIds && !checkinIds.length ? [] : await encounterService.signalRows(patientId, tz, checkinIds ? { ids: checkinIds } : {});

  const dips = findings.filter((f) => f.detectorKey === "recovery.dip");
  let nights: NightRow[] = [];
  if (dips.length) {
    const earliest = dips.map((f) => runStartOf(f, RUN_NIGHTS)).sort()[0];
    const from = moment.tz(earliest, tz).subtract(BASELINE_LEAD_DAYS, "days").format("YYYY-MM-DD");
    nights = (await prisma.nightlyVitals.findMany({ where: { patientId, date: { gte: from } }, orderBy: { date: "asc" } })) as any as NightRow[];
  }
  return { tz, today, findings, checkins, nights };
};

const cardsOf = ({ today, findings, checkins, nights }: Loaded): { cards: SignalCard[]; linked: Set<string> } => {
  const byId = new Map(checkins.map((c) => [c.id, c]));
  const inside = (date: string) => nightInside(nights, date);
  const linked = new Set<string>();
  const cards: SignalCard[] = [];
  for (const f of findings) {
    const c = f.encounterId ? byId.get(f.encounterId) : undefined;
    if (c) linked.add(c.id);
    cards.push(
      dataCard(f, {
        today,
        runNights: RUN_NIGHTS,
        nights,
        inside,
        linked: c ? { card: checkinCard(c), due: !!c.followUp?.due && c.state !== "closed", threadId: c.threadId, complaintText: c.complaintText, checkIns: 1 + c.checkIns.length } : null,
      })
    );
  }
  for (const c of checkins) cards.push(checkinCard(c));
  return { cards, linked };
};

export const signalsOverview = async (patientId: string): Promise<Overview> => {
  const { cards, linked } = cardsOf(await load(patientId));
  return overviewOf(cards, linked);
};

export type SignalDetail = { card: SignalCard; checkin: CheckinDetail | null };

/** One signal: `data:<findingId>` or `checkin:<encounterId>`. A data signal carries its linked check-in's detail. */
export const signalDetail = async (patientId: string, key: string): Promise<SignalDetail | null> => {
  const [kind, id] = key.split(":");
  if (!id || (kind !== "data" && kind !== "checkin")) return null;
  const loaded = await load(patientId, kind === "data" ? { findingIds: [id] } : { checkinIds: [id] });
  const { cards } = cardsOf(loaded);
  const card = cards.find((c) => c.key === key);
  if (!card) return null;
  const row = card.checkinId ? loaded.checkins.find((c) => c.id === card.checkinId) : undefined;
  return { card, checkin: row ? checkinDetail(row, CHECKIN_DISCLAIMER) : null };
};

/**
 * The thread "Tell Ollie how you feel" opens: the finding's own note thread
 * when it has one, else a new chat thread recorded on the finding — so a
 * check-in started there is linked to it (findings.store linkEncounter matches
 * on the thread). Before this, a signal nobody was told about (on record only)
 * had no thread, and a check-in about it could never be linked.
 */
export const threadForFinding = async (patientId: string, findingId: string): Promise<string | null> => {
  const f = await prisma.finding.findFirst({ where: { id: findingId, patientId }, select: { id: true, threadId: true, detectorKey: true } });
  if (!f || domainOf(f.detectorKey) !== "health") return null;
  if (f.threadId) return f.threadId;
  const thread = await prisma.agentThread.create({ data: { patientId, source: "CHAT", title: null } });
  // Only if still unset: a note written meanwhile keeps its own thread.
  const { count } = await prisma.finding.updateMany({ where: { id: f.id, threadId: null }, data: { threadId: thread.id } });
  if (!count) {
    await prisma.agentThread.delete({ where: { id: thread.id } }).catch(() => undefined);
    return (await prisma.finding.findUnique({ where: { id: f.id }, select: { threadId: true } }))?.threadId ?? null;
  }
  return thread.id;
};
