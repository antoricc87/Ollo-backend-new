import { z } from "zod";
import prisma from "../../../utility/prismaClient";
import { defineTool } from "./registry";

export const getRecords = defineTool({
  name: "get_records",
  description:
    "What is on the user's medical record: conditions, allergies, medications (name + dosage as recorded by their clinician), procedures, immunizations, family history, and the free-text summary. Read-only — restate, never modify or advise on medications.",
  schema: z.object({
    sections: z
      .array(z.enum(["conditions", "allergies", "medications", "procedures", "immunizations", "family_history", "summary"]))
      .optional()
      .describe("Subset to return. Omit for everything."),
  }),
  risk: "read",
  async run(ctx, input) {
    const s = await prisma.patientSummary.findUnique({
      where: { patientId: ctx.patientId },
      include: {
        conditions: { include: { condition: true } },
        allergies: { include: { allergy: true } },
        medications: { include: { medication: true } },
        procedures: { include: { procedure: true } },
        familyHistory: true,
      },
    });
    if (!s) return { result: { note: "no medical record on file yet" } };
    const want = (k: string) => !input.sections || input.sections.includes(k as any);
    const fh = s.familyHistory;
    const result: Record<string, unknown> = {};
    if (want("conditions"))
      result.conditions = s.conditions.map((c) => ({ name: c.condition.name, clinicalStatus: c.condition.clinicalStatus, onset: c.condition.onset }));
    if (want("allergies")) result.allergies = s.allergies.map((a) => ({ substance: a.allergy.substance, reactions: a.allergy.reactions, status: a.allergy.status }));
    if (want("medications")) result.medications = s.medications.map((m) => ({ name: m.medication.name, dosage: m.medication.dosage, status: m.medication.status }));
    if (want("procedures")) result.procedures = s.procedures.map((p) => ({ name: p.procedure.name, period: p.procedure.period }));
    if (want("immunizations")) result.immunizations = s.immunizations;
    if (want("family_history"))
      result.familyHistory = fh
        ? {
            chronicConditions: fh.historyOfChronicConditions,
            cancer: fh.historyOfCancer,
            mentalHealth: fh.historyOfMentalHealth,
            hereditary: fh.historyOfHereditaryConditions,
            autoimmune: fh.historyOfAutoimmuneConditions,
            stroke: fh.historyOfStroke,
            heartAttack: fh.historyOfHeartAttack,
            highCholesterol: fh.historyOfHighCholesterol,
            highTriglycerides: fh.historyOfHighTriglyceride,
            kidneyDisease: fh.historyOfKidneyDisease,
            respiratory: fh.historyOfRespiratoryConditions,
            dementia: fh.historyOfDementiaOrAlzheimer,
          }
        : null;
    if (want("summary")) result.summary = s.summary;
    return { result };
  },
});
