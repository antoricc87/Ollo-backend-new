/**
 * The patient-facing summary of one lab report, built in code from the
 * validated entries — never written by a model.
 *
 * Wording rule (Sep 15 2026): the summary states what the report shows against
 * the ranges the lab printed, and nothing else. No "healthy", "normal",
 * "abnormal", "suggests", "recommend", "should", no condition names, no diet or
 * exercise advice tied to results. Interpretation belongs to the clinician.
 * `tests/utils/labReportSummary.test.ts` enforces the banned words.
 */

export type SummaryEntry = {
  testType: string;
  result: string;
  units?: string | null;
  referenceRange?: string | null;
  isOutOfRange: boolean;
  needsReview?: boolean | null;
};

const LISTED = 6;

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

const describe = (e: SummaryEntry) => {
  const value = [e.result, e.units].filter(Boolean).join(" ");
  return e.referenceRange ? `${e.testType} ${value} (range ${e.referenceRange})` : `${e.testType} ${value}`;
};

export const buildLabReportSummary = (entries: SummaryEntry[] | null | undefined): string => {
  const all = entries ?? [];
  if (all.length === 0) return "";
  const flagged = all.filter((e) => e.isOutOfRange);
  const toCheck = all.filter((e) => e.needsReview).length;

  const parts: string[] = [];
  if (flagged.length === 0) {
    parts.push(
      all.length === 1
        ? "The measured value is inside the reference range printed on this report."
        : `All ${all.length} measured values are inside the reference ranges printed on this report.`
    );
  } else {
    const listed = flagged.slice(0, LISTED).map(describe).join("; ");
    const more = flagged.length > LISTED ? `; and ${flagged.length - LISTED} more` : "";
    parts.push(
      `${flagged.length} of ${all.length} ${plural(all.length, "value is", "values are")} outside the reference range printed on this report: ${listed}${more}.`
    );
    parts.push("Your clinician can explain what these results mean for you.");
  }
  if (toCheck > 0)
    parts.push(`${toCheck} ${plural(toCheck, "value is", "values are")} marked to check against the original PDF.`);
  return parts.join(" ");
};
