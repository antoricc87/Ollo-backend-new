/**
 * Print the agent's patient snapshot for one user.
 *   npx ts-node --transpile-only scripts/agent-snapshot.ts <email|patientId> [--json]
 */
import prisma from "../src/utility/prismaClient";
import { buildPatientSnapshot, renderSnapshot } from "../src/services/agent/context/snapshot";

async function main() {
  const [who, ...flags] = process.argv.slice(2);
  if (!who) {
    console.error("usage: agent-snapshot.ts <email|patientId> [--json]");
    process.exit(1);
  }
  const patient = who.includes("@")
    ? await prisma.patient.findUnique({ where: { email: who }, select: { id: true } })
    : { id: who };
  if (!patient) {
    console.error("patient not found:", who);
    process.exit(1);
  }
  const started = Date.now();
  const snapshot = await buildPatientSnapshot(patient.id, {
    sleepMinutesLastNight: 412, // sample HealthKit values so the render path is exercised
    stepsToday: 6200,
  });
  if (!snapshot) {
    console.error("no snapshot");
    process.exit(1);
  }
  const text = renderSnapshot(snapshot);
  if (flags.includes("--json")) console.log(JSON.stringify(snapshot, null, 2));
  console.log(text);
  console.log(
    `\n[${Date.now() - started} ms · ${text.length} chars · ~${Math.round(text.length / 4)} tokens]`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
