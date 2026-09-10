/**
 * TrainingProfile — how the user trains. Read by every generated workout and
 * rendered as one snapshot line. `limitations` is the user's own words about
 * pain/injury/what to avoid: Ollie repeats it as a constraint, never
 * interprets it (that is the care team's job).
 */
import prisma from "../../../utility/prismaClient";
import type { TrainingProfileInput } from "../domain/workout.schema";

export type TrainingProfileRecord = NonNullable<Awaited<ReturnType<typeof prisma.trainingProfile.findUnique>>>;

const LABEL: Record<string, string> = {
  pull_up_bar: "pull-up bar",
};
const label = (k: string) => LABEL[k] ?? k.replace(/_/g, " ");

class TrainingProfileService {
  async get(patientId: string) {
    return prisma.trainingProfile.findUnique({ where: { patientId } });
  }

  /** Merge-upsert: only the fields present in `input` change. */
  async upsert(patientId: string, input: TrainingProfileInput) {
    const data = {
      ...(input.place !== undefined ? { place: input.place } : {}),
      ...(input.equipment !== undefined ? { equipment: Array.from(new Set(input.equipment)) } : {}),
      ...(input.experience !== undefined ? { experience: input.experience } : {}),
      ...(input.sessionMinutes !== undefined ? { sessionMinutes: input.sessionMinutes } : {}),
      ...(input.preferredDays !== undefined ? { preferredDays: Array.from(new Set(input.preferredDays)) } : {}),
      ...(input.preferredTime !== undefined ? { preferredTime: input.preferredTime } : {}),
      ...(input.limitations !== undefined ? { limitations: input.limitations?.trim() || null } : {}),
    };
    return prisma.trainingProfile.upsert({ where: { patientId }, create: { patientId, ...data }, update: data });
  }

  /** One line for the agent snapshot and the generator brief. */
  render(p: TrainingProfileRecord | null): string | null {
    if (!p) return null;
    const parts: string[] = [];
    if (p.place) parts.push(p.place);
    if (p.equipment.length) parts.push(p.equipment.map(label).join(", "));
    if (p.experience) parts.push(p.experience === "new" ? "new to training" : p.experience === "some" ? "some experience" : "experienced");
    if (p.sessionMinutes) parts.push(`${p.sessionMinutes} min sessions`);
    if (p.preferredDays.length) parts.push(p.preferredDays.join(" "));
    if (p.preferredTime) parts.push(`usually ${p.preferredTime}`);
    if (p.limitations) parts.push(`limitations (their words): "${p.limitations}"`);
    return parts.length ? parts.join("; ") : null;
  }
}

export default new TrainingProfileService();
