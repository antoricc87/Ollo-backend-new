/**
 * THE PREVENTIVE PLAN — shared shapes (P0, Ollo/docs/preventive-plan-plan.md).
 *
 * One plan per person: the services the guideline rules put in it, grouped by
 * TYPE (his ruling Nov 19 2026), and every other preventive test as an
 * optional addition. Pure types — no I/O anywhere in `domain/`.
 *
 * Copy in this module (checks, how, why optional, vaccine reasons) is drafted
 * from the named guidelines and NEEDS CLINICAL REVIEW before production
 * (his ruling: review later).
 */

/** How you get it — also how it is booked (one blood draw · an imaging slot · a specialist · a pharmacy). */
export type ServiceType = "lab" | "diagnostic" | "procedure" | "vaccine" | "check";

/** Group order on the page; `check` = measured by a clinician at any visit (blood pressure, mood). */
export const TYPE_ORDER: ServiceType[] = ["lab", "diagnostic", "procedure", "vaccine", "check"];

export const TYPE_LABEL: Record<ServiceType, string> = {
  lab: "Labs",
  diagnostic: "Diagnostics",
  procedure: "Procedures",
  vaccine: "Vaccines",
  check: "Checks at a visit",
};

export type Source = { org: string; year: number; grade?: string; url?: string };

/** Why an item applies to THIS person (the tags under its name). */
export type Tag =
  | { key: "family"; text: string }
  | { key: "condition"; text: string }
  | { key: "medication"; text: string }
  | { key: "age"; text: string }
  | { key: "everyone"; text: string }
  | { key: "once"; text: string }
  | { key: "coming"; text: string };

export type Coverage = {
  /** Covered with no cost-sharing in network under the ACA preventive-care rules. */
  aca: boolean;
  /** The tag ("Covered under the ACA") or null when not. */
  tag: string | null;
  /** One line for the detail (COST). */
  line: string;
};

export type Status = "planned" | "coming" | "up_to_date";

export type PlanItem = {
  key: string;
  type: ServiceType;
  name: string;
  /** What the test looks at (fixed copy). */
  checks: string;
  /** Why it is in this plan (the rule's personal reason). */
  why: string;
  how: string;
  every: string;
  source: Source;
  coverage: Coverage;
  tags: Tag[];
  status: Status;
  /** Rules' weight: strongly suggested · worth considering · a decision to discuss. */
  priority: "DUE" | "CONSIDER" | "DISCUSS";
  /** Lab items: canonical biomarker keys that satisfy it (up-to-date check). */
  biomarkers?: string[];
};

export type OptionalItem = {
  key: string;
  type: ServiceType;
  name: string;
  checks: string;
  /** Why it is optional and what to weigh. */
  whyOptional: string;
  how: string;
  every: string;
  /** Directional, until real providers price it (his ruling Nov 19 2026). */
  price: string;
  source: Source | null;
  /** Relevance to this person; first in the list when non-empty. */
  tags: Tag[];
};

export type PlanGroup = { type: ServiceType; label: string; items: PlanItem[] };

export type PreventivePlan = {
  groups: PlanGroup[];
  /** Items already done recently, folded on the page. */
  upToDate: PlanItem[];
  optional: OptionalItem[];
  counts: { planned: number; coming: number; upToDate: number; optional: number };
};
