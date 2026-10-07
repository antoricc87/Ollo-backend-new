/**
 * Lab-signal smoke against the local DB: re-judge one report as if it had just
 * been uploaded, print the delta, then (with --notify) let Ollie write the note.
 *   npx ts-node --transpile-only scripts/labs-signal-smoke.ts <email> [--notify] [--keep]
 */
import "dotenv/config";
import prisma from "../src/utility/prismaClient";
import { runLabScanFor } from "../src/services/signals/labs.service";
import threadStore from "../src/services/agent/memory/thread.store";

async function main() {
  const email = process.argv[2];
  const notify = process.argv.includes("--notify");
  const keep = process.argv.includes("--keep");
  const patient = await prisma.patient.findFirst({ where: { email }, select: { id: true } });
  if (!patient) throw new Error(`no patient ${email}`);
  const pid = patient.id;
  const reports = await prisma.labResultSummary.findMany({ where: { patientSummary: { patientId: pid } }, orderBy: { createdAt: "asc" }, select: { id: true, collectedAt: true } });
  console.log("reports:", reports.map((r) => `${r.id.slice(0, 8)} ${r.collectedAt?.toISOString().slice(0, 10)}`).join(", "));

  // 1. sweep with nothing new → silent
  console.log("\n[sweep, nothing new]", await runLabScanFor(pid, { notify: false }));

  // 2. newest report as if just uploaded
  const newest = reports[reports.length - 1];
  const r: any = await runLabScanFor(pid, { reportIds: [newest.id], notify });
  console.log("\n[newest as new]", { fired: r.fired, label: r.label, reason: r.reason, notified: r.notified, withheld: r.withheld, threadId: r.threadId });
  if (r.fired) {
    const f = await prisma.finding.findUnique({ where: { id: r.findingId } });
    const ev: any = f?.evidence;
    console.log("  evidence:", JSON.stringify({ newlyFlagged: ev.newlyFlagged, changed: ev.changed, backInRange: ev.backInRange, stillFlagged: ev.stillFlagged.map((x: any) => x.key), unremarkable: ev.unremarkable }, null, 1));
    console.log("  baseline:", JSON.stringify(f?.baseline), "severity", f?.severity, f?.direction);
    if (r.threadId) {
      const t = await threadStore.getWithMessages(pid, r.threadId, { includeTool: true });
      const tools = t!.messages.filter((m) => m.role === "TOOL").map((m) => m.toolName);
      console.log("  tools called:", tools.join(", ") || "(none)");
      console.log("  Ollie:\n" + r.text ?? t!.messages.filter((m) => m.role === "ASSISTANT").map((m) => m.content).join("\n"));
    }
    // 3. same report again → silent (covered), duplicate semantics
    console.log("\n[sweep again]", await runLabScanFor(pid, { notify: false }));
    if (!keep) {
      if (r.threadId) await threadStore.remove(pid, r.threadId);
      await prisma.finding.delete({ where: { id: r.findingId } });
      await prisma.notification.deleteMany({ where: { userId: pid, kind: "watch_out" } });
    }
  }
  // 4. the OLDER report as if just uploaded → silent (newer one wins every key)
  if (reports.length > 1) {
    const o: any = await runLabScanFor(pid, { reportIds: [reports[0].id], notify: false });
    console.log("\n[older report as new]", { fired: o.fired, reason: o.reason, label: o.label });
    if (o.fired && !keep) await prisma.finding.delete({ where: { id: o.findingId } });
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
