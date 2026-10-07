import { buildCurrentLabs, CurrentBiomarker, LabReportLike, reportDate } from "../../../../utils/labBiomarkers";
import { Candidate, Detector, round } from "../types";

/**
 * LABS — what a new report CHANGES, judged against what was already on record.
 *
 * This replaced the old `watch_out` run (Oct 2026), which fired on every
 * upload — zero flagged or not, same PDF twice or not — and then asked the
 * model to "look at the flagged labs", a merged view across every report the
 * person ever uploaded. So the note kept reciting values flagged years ago on
 * reports that had nothing to do with the one just uploaded.
 *
 * The rule here is a delta, not a snapshot: a value matters when the new
 * report moves it — newly outside the lab's range, back inside it, or still
 * outside but materially different from last time. A value that is outside
 * the range exactly as it was before is carried as evidence (so the agent can
 * answer "is my LDL still high?") but never trips the detector on its own,
 * which is also what makes a duplicate upload silent for free: against the
 * first copy, the second one changes nothing.
 *
 * Unlike the overnight detectors this is EVENT-driven (an upload), so it is not
 * in the daily `DETECTORS` list; `labs.service.ts` calls `labsDelta` directly
 * and the daily scan only sees its episode to close it the next morning.
 */

/** Numeric movement on a still-flagged value that counts as news. */
export const CHANGE_FRACTION = 0.15;
/** Severity cap, so a 30-value panel does not outrank everything for a month. */
const SEVERITY_CAP = 4;

type Prior = { result: string; units: string | null; on: string; flagged: boolean; value: number | null };

export type LabRow = {
  key: string;
  testType: string;
  result: string;
  units: string | null;
  referenceRange: string;
  on: string;
  previous: Prior | null;
  /** Fractional change against the previous numeric value, when both are numbers. */
  changeFraction?: number;
};

export type LabsDelta = {
  newlyFlagged: LabRow[];
  /** Flagged before and now, moved by at least CHANGE_FRACTION. */
  changed: LabRow[];
  /** Flagged before and now, no material movement — evidence only. */
  stillFlagged: LabRow[];
  backInRange: LabRow[];
  /** Values on the new reports that are inside the range and were not flagged before. */
  unremarkable: number;
};

const day = (iso: string | Date) => new Date(iso as any).toISOString().slice(0, 10);

const rowOf = (b: CurrentBiomarker, previous: Prior | null): LabRow => {
  const row: LabRow = { key: b.key, testType: b.testType, result: b.result, units: b.units ?? null, referenceRange: b.referenceRange, on: day(b.collectedAt), previous };
  if (previous && b.value != null && previous.value != null && previous.value !== 0) row.changeFraction = round(Math.abs(b.value - previous.value) / Math.abs(previous.value));
  return row;
};

/** Pure comparison: the latest-per-biomarker picture with and without the new reports. */
export const labsDeltaOf = (reports: LabReportLike[], newReportIds: string[]): LabsDelta => {
  const fresh = new Set(newReportIds);
  const before = new Map(buildCurrentLabs(reports.filter((r) => !fresh.has(r.id))).map((b) => [b.key, b]));
  const after = buildCurrentLabs(reports);
  const delta: LabsDelta = { newlyFlagged: [], changed: [], stillFlagged: [], backInRange: [], unremarkable: 0 };
  for (const b of after) {
    // Only values the new reports supply. An older report uploaded late never
    // wins "latest" for a biomarker measured since, so it changes nothing.
    if (!fresh.has(b.reportId)) continue;
    const p = before.get(b.key) ?? null;
    const previous: Prior | null = p ? { result: p.result, units: p.units ?? null, on: day(p.collectedAt), flagged: p.isOutOfRange, value: p.value } : null;
    const row = rowOf(b, previous);
    if (b.isOutOfRange) {
      if (!previous?.flagged) delta.newlyFlagged.push(row);
      else if ((row.changeFraction ?? 0) >= CHANGE_FRACTION) delta.changed.push(row);
      else delta.stillFlagged.push(row);
    } else if (previous?.flagged) delta.backInRange.push(row);
    else delta.unremarkable += 1;
  }
  return delta;
};

const names = (rows: LabRow[]) => rows.map((r) => r.key).join(", ");

/**
 * One candidate per upload batch. CONCERN when anything is newly outside the
 * range or has moved while outside it; POSITIVE when the only news is values
 * back inside. Severity in bars: one newly flagged value is the bar.
 */
export const labsDelta = (reports: LabReportLike[], newReportIds: string[]): Candidate | null => {
  const delta = labsDeltaOf(reports, newReportIds);
  const concern = delta.newlyFlagged.length + 0.5 * delta.changed.length;
  const positive = delta.backInRange.length;
  if (concern < 1 && positive < 1) return null;
  const direction = concern >= 1 ? "CONCERN" : "POSITIVE";
  const fresh = reports.filter((r) => newReportIds.includes(r.id));
  const collected = fresh.map((r) => day(reportDate(r))).sort();
  const prior = reports.filter((r) => !newReportIds.includes(r.id)).map((r) => day(reportDate(r))).sort();
  const parts = [
    delta.newlyFlagged.length && `${delta.newlyFlagged.length} newly outside range (${names(delta.newlyFlagged)})`,
    delta.changed.length && `${delta.changed.length} still outside, moved (${names(delta.changed)})`,
    delta.backInRange.length && `${delta.backInRange.length} back in range (${names(delta.backInRange)})`,
  ].filter(Boolean);
  return {
    detectorKey: LABS_KEY,
    detectorVersion: 1,
    direction,
    severity: round(Math.min(SEVERITY_CAP, direction === "CONCERN" ? concern : positive)),
    evidence: {
      reportIds: newReportIds,
      collectedAt: collected,
      valuesOnReport: fresh.reduce((n, r) => n + (r.labResults?.length ?? 0), 0),
      newlyFlagged: delta.newlyFlagged,
      changed: delta.changed,
      stillFlagged: delta.stillFlagged,
      backInRange: delta.backInRange,
      unremarkable: delta.unremarkable,
    },
    baseline: { priorReports: prior.length, priorLatestOn: prior[prior.length - 1] ?? null },
    label: parts.join("; "),
  };
};

export const LABS_KEY = "labs.report";

/**
 * Registered for its metadata only (weight, resolve window) — `run` is a no-op
 * because the daily scan has no reports in its input. A lab finding is a point
 * event: quiet the next morning, so it closes itself then.
 */
export const labsReport: Detector = {
  key: LABS_KEY,
  version: 1,
  weight: 1.5,
  resolveAfterDays: 0,
  cooldownDays: 0,
  run: () => null,
};
