/**
 * Slice 4 live smoke: proactive runs + plan-target proposal + eligibility.
 *   npx ts-node --transpile-only scripts/agent-proactive-smoke.ts [email]
 */
import "dotenv/config";
import assert from "assert";
import moment from "moment-timezone";
import prisma from "../src/utility/prismaClient";
import { runProactiveFor, duePatients, setPreference, triggerWatchOut } from "../src/services/agent/proactive/proactive.service";
import proposalStore from "../src/services/agent/memory/proposals.store";
import threadStore from "../src/services/agent/memory/thread.store";

const show = (label: string, r: any) => {
  console.log(`\n=== ${label}\n  thread=${r.threadId} cards=${JSON.stringify((r.cards ?? []).map((c: any) => c.type))} notified=${r.notified}`);
  console.log("  " + String(r.text ?? r.error ?? r.skipped).split("\n").join("\n  "));
};

async function main() {
  const email = process.argv.slice(2).find((a) => a.includes("@")) ?? "antoricciardelli@gmail.com";
  const p = await prisma.patient.findUnique({ where: { email }, select: { id: true, timeZone: true } });
  assert(p);
  const pid = p.id;
  const threads: string[] = [];
  const t0 = Date.now();

  /* weekly review */
  const w: any = await runProactiveFor(pid, "weekly_review", { notify: false });
  assert(w.threadId && w.text, JSON.stringify(w));
  threads.push(w.threadId);
  show("weekly_review", w);
  const wt = await threadStore.getWithMessages(pid, w.threadId, { includeTool: true });
  assert.equal(wt!.source, "PROACTIVE");
  assert(wt!.messages[0].role === "SYSTEM" && wt!.messages[0].content.startsWith("[Weekly plan review"));
  const toolsUsed = wt!.messages.filter((m) => m.role === "TOOL").map((m) => m.toolName);
  console.log("  tools:", toolsUsed.join(", "));
  assert(toolsUsed.includes("get_nutrition_summary") || toolsUsed.includes("get_activity"), "review must read last week's data");
  const pref = await prisma.agentPreference.findUnique({ where: { patientId: pid } });
  assert(pref?.lastWeeklyReviewAt, "stamped");

  /* Sunday planning: lays out next week as a draft card, never saves */
  const pw: any = await runProactiveFor(pid, "plan_week", { notify: false });
  assert(pw.threadId && pw.text, JSON.stringify(pw));
  threads.push(pw.threadId);
  show("plan_week", pw);
  const pwt = await threadStore.getWithMessages(pid, pw.threadId, { includeTool: true });
  const pwTools = pwt!.messages.filter((m) => m.role === "TOOL").map((m) => m.toolName);
  console.log("  tools:", pwTools.join(", "));
  assert(pwTools.includes("generate_workout_plan"), "plan_week must lay out next week");
  assert(!pwTools.includes("save_workout_plan"), "plan_week must not save");
  assert((pw.cards ?? []).some((c: any) => c.type === "workout_plan"), "week card attached");
  assert((await prisma.agentPreference.findUnique({ where: { patientId: pid } }))?.lastPlanWeekAt, "stamped");

  /* daily check-in */
  const d: any = await runProactiveFor(pid, "daily_checkin", { notify: false });
  assert(d.threadId && d.text);
  threads.push(d.threadId);
  show("daily_checkin", d);
  assert(d.text.split(/\s+/).length < 160, "daily check-in should be short");

  /* watch-out via the event hook */
  const x: any = await triggerWatchOut(pid, "new lab report uploaded (2 values outside the reference range)");
  assert(x.threadId && x.text, JSON.stringify(x));
  threads.push(x.threadId);
  show("watch_out", x);
  assert(!/you have (high|low|hyper|hypo)|diagnos/i.test(x.text), "no diagnosis language");

  /* plan-target proposal → confirm → PlanTarget changed → restore */
  const plan = await prisma.healthPlan.findFirst({ where: { patientId: pid, status: "ACTIVE" }, include: { targets: true } });
  assert(plan, "active plan needed");
  const original = plan.targets.map((t) => ({ pillar: t.pillar, metricKey: t.metricKey, cadence: t.cadence, min: t.min, max: t.max, unit: t.unit, baseline: t.baseline, tolerance: t.tolerance }));
  const { runTurnCollect } = await import("../src/services/agent/agent.service");
  const r = await runTurnCollect({ patientId: pid, message: "Lower my daily calorie target by about 100 kcal, keep everything else the same." });
  threads.push(r.threadId!);
  const prop: any = r.events.find((e) => e.type === "proposal");
  console.log(`\n=== update_plan_targets\n  ${prop ? prop.summary : "NO PROPOSAL"}\n  ${r.done?.text.split("\n")[0]}`);
  assert(prop && prop.toolName === "update_plan_targets", "expected a plan proposal");
  const c: any = await proposalStore.confirm(pid, prop.proposalId);
  assert.equal(c.status, 200, JSON.stringify(c));
  const after = await prisma.planTarget.findFirst({ where: { planId: plan.id, metricKey: "calories" } });
  const before = original.find((t) => t.metricKey === "calories")!;
  console.log(`  calories ${before.min}–${before.max} → ${after!.min}–${after!.max}`);
  assert(after!.max! < before.max!, "calorie max lowered");
  const { default: PlanService } = await import("../src/services/plan/model/plan.model");
  await PlanService.replaceTargets(pid, plan.id, original);
  const restored = await prisma.planTarget.findFirst({ where: { planId: plan.id, metricKey: "calories" } });
  assert.equal(restored!.max, before.max, "restored");

  /* eligibility: force this patient due for daily now, then not */
  const tz = p.timeZone || "UTC";
  const hourNow = moment().tz(tz).hour();
  await setPreference(pid, { dailyCheckinHour: hourNow });
  await prisma.agentPreference.update({ where: { patientId: pid }, data: { lastDailyCheckinAt: null } });
  assert((await duePatients("daily_checkin")).includes(pid), "due at local hour");
  await prisma.agentPreference.update({ where: { patientId: pid }, data: { lastDailyCheckinAt: new Date() } });
  assert(!(await duePatients("daily_checkin")).includes(pid), "not due twice a day");
  await setPreference(pid, { proactiveEnabled: false });
  const off: any = await triggerWatchOut(pid, "x");
  assert.equal(off.skipped, "disabled");

  console.log(`\nall proactive checks passed in ${Math.round((Date.now() - t0) / 1000)} s`);

  for (const id of threads) await threadStore.remove(pid, id);
  await prisma.agentProposal.deleteMany({ where: { patientId: pid } });
  await prisma.agentPreference.deleteMany({ where: { patientId: pid } });
  await prisma.agentAuditLog.deleteMany({ where: { patientId: pid } });
  console.log("cleaned up");
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
