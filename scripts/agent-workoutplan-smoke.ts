/**
 * Training design live smoke (LLM): generate_workout → card with loads only
 * from history → log it via draftId → proposal; generate_workout_plan →
 * save_workout_plan proposal → confirm → PLANNED rows under a header →
 * "did today's workout" → log_workout sessionId → proposal completes the row
 * → confirm → same row COMPLETED; update_training_profile proposal.
 * Runs against the dev user; cleans up what it creates and restores the
 * previous active week / profile.
 *   npx ts-node --transpile-only scripts/agent-workoutplan-smoke.ts [email]
 */
import "dotenv/config";
import assert from "assert";
import moment from "moment-timezone";
import prisma from "../src/utility/prismaClient";
import { runTurnCollect } from "../src/services/agent/agent.service";
import proposalStore from "../src/services/agent/memory/proposals.store";
import threadStore from "../src/services/agent/memory/thread.store";
import WorkoutService from "../src/services/workouts/model/workouts.model";
import WorkoutPlanService from "../src/services/workouts/model/plan.model";
import { buildPatientSnapshot, renderSnapshot } from "../src/services/agent/context/snapshot";

const log = (s: string) => console.log(s);

async function main() {
  const email = process.argv.slice(2).find((a) => a.includes("@")) ?? "antoricciardelli@gmail.com";
  const p = await prisma.patient.findUnique({ where: { email }, select: { id: true, timeZone: true } });
  assert(p, "patient missing");
  const pid = p.id;
  const tz = p.timeZone || "Europe/Rome";
  const today = moment().tz(tz).format("YYYY-MM-DD");
  const t0 = Date.now();
  let threadId: string | null = null;
  const previousActive = await prisma.workoutPlan.findFirst({ where: { patientId: pid, status: "ACTIVE" }, select: { id: true } });
  const previousProfile = await prisma.trainingProfile.findUnique({ where: { patientId: pid } });
  const createdSessions: string[] = [];
  const createdPlans: string[] = [];
  const cleanup = async () => {
    await prisma.workoutSession.deleteMany({ where: { id: { in: createdSessions } } });
    if (createdPlans.length) {
      await prisma.workoutSession.deleteMany({ where: { planId: { in: createdPlans } } });
      await prisma.workoutPlan.deleteMany({ where: { id: { in: createdPlans } } });
    }
    if (previousActive) await prisma.workoutPlan.update({ where: { id: previousActive.id }, data: { status: "ACTIVE" } }).catch(() => undefined);
    if (previousProfile) await prisma.trainingProfile.update({ where: { patientId: pid }, data: { ...previousProfile, patientId: undefined, updatedAt: undefined } as any });
    if (threadId) await threadStore.remove(pid, threadId).catch(() => undefined);
  };
  for (const stale of await prisma.agentProposal.findMany({ where: { patientId: pid, toolName: { in: ["log_workout", "save_workout_plan", "update_training_profile"] }, status: "PENDING" }, select: { id: true } })) await proposalStore.cancel(pid, stale.id).catch(() => undefined);
  if (!previousProfile) await prisma.trainingProfile.create({ data: { patientId: pid, place: "gym", equipment: ["barbell", "dumbbell", "cable", "machine"], experience: "experienced", sessionMinutes: 45, preferredTime: "18:30" } });

  const turn = async (message: string, client?: any) => {
    const r = await runTurnCollect({ patientId: pid, threadId, message, client: client ?? null });
    threadId = r.threadId;
    const tools = r.events.filter((e): e is any => e.type === "tool_start").map((e) => e.name);
    const proposals = r.events.filter((e): e is any => e.type === "proposal");
    const cards = r.events.filter((e): e is any => e.type === "card").map((e) => e.card);
    log(`\n> ${message}\n  tools=${JSON.stringify(tools)} cards=${JSON.stringify(cards.map((c: any) => c.type))} safety=${JSON.stringify(r.safety)}${r.error ? " ERROR " + r.error : ""}`);
    log("  " + (r.done?.text ?? "").split("\n").join("\n  "));
    return { ...r, proposals, tools, cards };
  };

  try {
    /* 1. one workout */
    const a = await turn("Give me a 40 minute upper body strength workout for the gym today.");
    assert(a.tools.includes("generate_workout"), "generate_workout called");
    const wcard: any = a.cards.find((c: any) => c.type === "workout");
    assert(wcard, "workout card");
    const sess = wcard.data.session;
    assert.equal(sess.plannedFor, today);
    assert.equal(sess.durationMin, 40);
    assert(sess.exercises.length >= 3, "exercises");
    const upper = new Set(["chest", "back", "shoulders", "arms"]);
    assert(sess.exercises.some((e: any) => upper.has(e.muscleGroup)), "upper-body coverage");
    for (const e of sess.exercises) for (const st of e.sets) if (st.targetKg != null) assert(wcard.data.lastLoads[e.exerciseKey], `kg only from history: ${e.name}`);
    assert.equal(a.proposals.length, 0, "no proposal for a draft");
    assert(!/\b(saved|logged)\b/i.test(a.done!.text) || /not (yet )?saved|until|nothing is saved/i.test(a.done!.text), "must not claim saved");
    log(`  card: ${wcard.data.display.exercises.map((e: any) => `${e.name} ${e.prescription}`).join(" · ")} · fit=${JSON.stringify(wcard.data.fit)} · ${wcard.data.assumptions.join("; ")}`);

    /* 2. "I did it" → log via draftId (no parsing), proposal starts from the planned sets */
    const b = await turn("Done — I did that workout exactly as written, about 40 minutes.");
    assert(b.tools.includes("log_workout"), "log_workout called");
    const lp = b.proposals[0];
    assert(lp && lp.toolName === "log_workout", "log proposal");
    const lprev: any = lp.preview;
    assert.equal(lprev.exercises.length, sess.exercises.length, "planned sets became the log's starting point");
    assert(lprev.completes && lprev.completes.source === "draft", "preview names the draft it completes");
    await proposalStore.cancel(pid, lp.proposalId);
    log("  ✓ draft → log_workout proposal (cancelled)");

    /* 3. a week */
    const c = await turn("Plan my next 3 days of training: two sessions, 45 minutes each, at the gym.");
    assert(c.tools.includes("generate_workout_plan"), "generate_workout_plan called");
    const pcard: any = c.cards.find((x: any) => x.type === "workout_plan");
    assert(pcard, "workout_plan card");
    assert.equal(pcard.data.days, 3);
    assert.equal(pcard.data.sessions.length, 2, JSON.stringify(pcard.data.sessions.map((s: any) => s.day)));
    assert.equal(c.proposals.length, 0);
    log(`  week: ${pcard.data.sessions.map((s: any) => `day ${s.day} ${s.session.title} (${s.session.exercises.length} ex)`).join(" | ")} · fit=${JSON.stringify(pcard.data.fit.ok)}`);

    /* 4. save it → proposal → confirm → planned rows */
    const d = await turn("Save that as my plan starting today.");
    assert(d.tools.includes("save_workout_plan"), "save_workout_plan called");
    const sp = d.proposals[0];
    assert(sp && sp.toolName === "save_workout_plan");
    assert(/confirm/i.test(d.done!.text), "asks to confirm");
    assert(!/\b(i('ve| have) )?saved (it|that|your|the plan)\b/i.test(d.done!.text), "must not claim saved");
    const conf = await proposalStore.confirm(pid, sp.proposalId);
    assert.equal(conf.status, 200, JSON.stringify(conf));
    const savedId = (conf as any).result.id as string;
    createdPlans.push(savedId);
    const view = await WorkoutPlanService.getActive(pid);
    assert(view && view.id === savedId);
    assert.equal(view!.planned, 2);
    const first = view!.daysOut.find((x) => x.planned)!;
    assert.equal(first.planned!.status, "PLANNED");
    log(`  ✓ saved: ${view!.daysOut.map((x) => `${x.day}:${x.state}`).join(" ")}`);

    /* 5. snapshot shows the week + training line */
    const snap = renderSnapshot(await buildPatientSnapshot(pid, null));
    assert(/training week: "/.test(snap), "snapshot has the week");
    assert(/^training: /m.test(snap), "snapshot has the training line");
    log("  ✓ snapshot: " + snap.split("\n").filter((l) => /training/.test(l)).join(" | ").slice(0, 300));

    /* 6. "did today's workout" → log_workout sessionId → completes the row */
    const todays = view!.daysOut.find((x) => x.date === today && x.planned);
    if (todays) {
      const e = await turn("I did today's planned session, everything as planned.");
      assert(e.tools.includes("log_workout"), "log_workout called for the planned session");
      const ep = e.proposals[0];
      assert(ep && ep.toolName === "log_workout");
      assert.equal((ep.preview as any).plannedSessionId, todays.planned!.id, "targets the planned row");
      const ec = await proposalStore.confirm(pid, ep.proposalId);
      assert.equal(ec.status, 200, JSON.stringify(ec));
      const row = await WorkoutService.get(pid, todays.planned!.id);
      assert.equal(row!.status, "COMPLETED", "same row completed");
      assert(row!.exercises[0].sets[0].reps != null, "actuals filled from targets");
      const after = await WorkoutPlanService.getActive(pid);
      assert.equal(after!.done, 1);
      log("  ✓ planned row completed in place");
    } else log("  (no session planned today — skip completion check)");

    /* 7. training profile update */
    const f = await turn("By the way, I only have dumbbells and a pull-up bar at home now, and I train at 7am.");
    assert(f.tools.includes("update_training_profile"), "update_training_profile called");
    const fp = f.proposals[0];
    assert(fp && fp.toolName === "update_training_profile");
    await proposalStore.cancel(pid, fp.proposalId);
    log("  ✓ profile proposal (cancelled)");

    log(`\nall good in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  } finally {
    await cleanup();
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
