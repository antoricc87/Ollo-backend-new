import { Coverage, ServiceType, Source } from "./types";

/**
 * ACA PREVENTIVE COVERAGE (45 CFR 147.130): non-grandfathered plans cover with
 * no cost-sharing, in network —
 *  - USPSTF recommendations graded A or B,
 *  - vaccines recommended by ACIP (adopted by CDC),
 *  - HRSA women's preventive services (well-woman visits, contraception,
 *    breastfeeding support, etc.).
 * Anything else may cost something, depending on the plan. A plan's own
 * Summary of Benefits, when uploaded, is more exact (P1: "$0 on your plan").
 *
 * The test is the item's SOURCE, not its name: a cholesterol panel listed for
 * the USPSTF statin recommendation is covered; the same panel listed for a
 * society guideline is "usually covered".
 */

export const TAG = "Covered under the ACA";

export const coverageOf = (type: ServiceType, source: Source): Coverage => {
  const uspstfAB = source.org === "USPSTF" && (source.grade === "A" || source.grade === "B");
  const acip = type === "vaccine" && /ACIP|CDC/.test(source.org);
  if (uspstfAB || acip)
    return { aca: true, tag: TAG, line: "No cost in network under the ACA preventive-care rules. Out of network, your plan's terms apply." };
  if (type === "lab") return { aca: false, tag: null, line: "Often covered as part of preventive care; depends on your plan." };
  return { aca: false, tag: null, line: "May have a cost; depends on your plan." };
};
