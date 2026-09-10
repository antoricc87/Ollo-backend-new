/**
 * OBSERVE_OWN_DATA — the patient's own record, restated for the visit.
 *
 * THE DESIGN DECISION THAT MATTERS: this never filters by the complaint.
 * Picking out the labs that "relate to" chest pain is the interpretive step —
 * it implies a connection, which is INTERPRET_AS_DIAGNOSIS by layout rather
 * than by sentence. So we show what is flagged and what is on record, in full,
 * labelled as background a clinician will want, and let the clinician do the
 * connecting.
 *
 * Every line is a value with its date, its units and the lab's own reference
 * range. Nothing here is computed, ranked or explained.
 */

export type ContextInput = {
  flaggedLabs: { testType: string; result: string; units: string | null; referenceRange: string; collectedAt: string }[];
  conditions: string[];
  medications: { name: string; dosage: string }[];
  allergies: string[];
  bloodPressure: { systolic: number; diastolic: number; at: string } | null;
};

export type OwnDataBlock = { heading: string; lines: string[] };

const MAX_LABS = 8;

/**
 * Blocks for the handout. Empty array when there is nothing on record — an
 * empty section is worse than no section on a page a clinician reads.
 */
export const ownDataBlocks = (input: ContextInput): OwnDataBlock[] => {
  const blocks: OwnDataBlock[] = [];

  if (input.conditions.length || input.medications.length || input.allergies.length) {
    const lines: string[] = [];
    if (input.conditions.length) lines.push(`Conditions on record: ${input.conditions.join(", ")}`);
    if (input.medications.length) lines.push(`Medications on record: ${input.medications.map((m) => `${m.name} ${m.dosage}`.trim()).join(", ")}`);
    if (input.allergies.length) lines.push(`Allergies on record: ${input.allergies.join(", ")}`);
    blocks.push({ heading: "ALREADY ON THEIR RECORD", lines });
  }

  if (input.flaggedLabs.length) {
    const shown = input.flaggedLabs.slice(0, MAX_LABS);
    const lines = shown.map(
      (l) => `${l.testType}: ${l.result}${l.units ? ` ${l.units}` : ""} (lab's range ${l.referenceRange}), collected ${l.collectedAt}`
    );
    if (input.flaggedLabs.length > shown.length) lines.push(`…and ${input.flaggedLabs.length - shown.length} more outside the lab's range.`);
    blocks.push({
      heading: "LAB VALUES OUTSIDE THE LAB'S RANGE",
      // Said plainly, because a list of abnormal labs next to a symptom invites exactly the inference we must not make.
      lines: ["Listed as background, not because they are connected to what the patient described.", ...lines],
    });
  }

  if (input.bloodPressure) {
    blocks.push({
      heading: "LAST RECORDED BLOOD PRESSURE",
      lines: [`${input.bloodPressure.systolic}/${input.bloodPressure.diastolic}, recorded ${input.bloodPressure.at}`],
    });
  }

  return blocks;
};

/** The same material as flat text for the handout body. */
export const renderOwnData = (blocks: OwnDataBlock[]): string[] => {
  const out: string[] = [];
  for (const b of blocks) {
    out.push("");
    out.push(b.heading);
    for (const l of b.lines) out.push(`- ${l}`);
  }
  return out;
};
