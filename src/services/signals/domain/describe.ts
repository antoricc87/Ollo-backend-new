/**
 * A finding in words a person reads on the Signals page: a title and one
 * factual line, built in code from the detector's own evidence. The app does
 * no arithmetic and no model writes this — it is the record, so it states
 * what was counted against what, and nothing about what it means.
 *
 * Never "abnormal", never a condition, never advice (the lint test runs every
 * line here through the output guard's rules).
 */

type Row = { detectorKey: string; evidence: unknown; baseline?: unknown };

const VITALS: Record<string, string> = { hrvMs: "HRV", sleepingHr: "Sleeping heart rate", restingHr: "Resting heart rate" };

const listOf = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);
const lowerRest = (items: string[]) => items.map((s, i) => (i === 0 || s === "HRV" ? s : s.charAt(0).toLowerCase() + s.slice(1)));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const hours = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
};
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);

export const describeFinding = (finding: Row): { title: string; line: string } => {
  const e = (finding.evidence ?? {}) as Record<string, any>;
  const b = (finding.baseline ?? {}) as Record<string, any>;
  switch (finding.detectorKey) {
    case "recovery.dip": {
      const vitals = lowerRest(arr(e.vitals).map((v) => VITALS[v?.vital] ?? null).filter(Boolean) as string[]);
      const nights = arr(e.nights).length;
      return {
        title: "Overnight readings away from your usual",
        line: vitals.length ? `${listOf(vitals)} away from your usual${nights ? `, ${plural(nights, "night")} running` : ""}` : "Away from your usual several nights running",
      };
    }
    case "recovery.restored":
      return { title: "Overnight readings back to your usual", line: `Inside your usual range ${plural(arr(e.nights).length || 3, "night")} running` };
    case "sleep.debt": {
      const target = num(e.targetMinutes);
      const short = num(e.shortNights);
      const of = arr(e.nights).length;
      return {
        title: "Sleep under your plan's target",
        line: short != null && of && target ? `${short} of ${plural(of, "night")} under your ${hours(target)} target` : "Several nights under your target",
      };
    }
    case "training.stopped": {
      const days = num(e.daysSince);
      const target = num(e.sessionsPerWeekTarget);
      return {
        title: "No training sessions",
        line: `${days != null ? `No session in ${plural(days, "day")}` : "No session on record"}${target ? `; your plan lists ${target} a week` : ""}`,
      };
    }
    case "training.drifting": {
      const target = num(e.sessionsPerWeekTarget);
      const weeks = arr(e.weeks).map((w) => num(w?.done)).filter((n) => n != null) as number[];
      return {
        title: "Fewer sessions than your plan",
        line: weeks.length && target ? `${listOf(weeks.map(String))} of ${target} sessions over the last two weeks` : "Under half your planned sessions two weeks running",
      };
    }
    case "training.consistent": {
      const target = num(e.sessionsPerWeekTarget);
      return { title: "Training on plan", line: target ? `${target} or more sessions a week, three weeks running` : "Your planned sessions met three weeks running" };
    }
    case "logging.stopped": {
      const days = num(e.daysWithNoMealLogged) ?? num(e.consecutiveDaysUnlogged);
      return { title: "No meals logged", line: days != null ? `${plural(days, "day")} with no meal logged` : "Several days with no meal logged" };
    }
    case "nutrition.protein_short": {
      const short = num(e.shortDays);
      const logged = num(e.loggedDays);
      const target = num(e.targetG) ?? num(b.targetG);
      return {
        title: "Protein under your plan's target",
        line: short != null && logged != null ? `${short} of ${plural(logged, "logged day")} under your target${target ? ` of ${Math.round(target)} g` : ""}` : "Most logged days under your target",
      };
    }
    case "weight.off_track": {
      const observed = num(e.observedKgPerWeek);
      const target = num(e.targetKgPerWeek);
      return {
        title: "Weight moving away from your plan",
        line: observed != null && target != null ? `${observed > 0 ? "+" : ""}${observed} kg a week against a plan of ${target > 0 ? "+" : ""}${target} kg a week` : "The three-week trend differs from your plan",
      };
    }
    case "labs.report": {
      const parts = [
        arr(e.newlyFlagged).length && `${plural(arr(e.newlyFlagged).length, "value")} newly outside the lab's range`,
        arr(e.changed).length && `${plural(arr(e.changed).length, "value")} outside the range moved`,
        arr(e.backInRange).length && `${plural(arr(e.backInRange).length, "value")} back inside the range`,
      ].filter(Boolean) as string[];
      return { title: "A lab report changed something on record", line: parts.length ? listOf(parts) : "A new report was read" };
    }
    default:
      return { title: "Something changed in your data", line: "" };
  }
};
