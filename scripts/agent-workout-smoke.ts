/**
 * Workouts live smoke: parse → match watch workout → proposal → edit → confirm
 * → WorkoutSession/Exercise/Set rows → get_workouts sees it → sync keeps the
 * detail. Cleans up everything it creates.
 *   npx ts-node --transpile-only scripts/agent-workout-smoke.ts [email]
 */
import "dotenv/config";
import assert from "assert";
import moment from "moment-timezone";
import prisma from "../src/utility/prismaClient";
import { runTurnCollect } from "../src/services/agent/agent.service";
import proposalStore from "../src/services/agent/memory/proposals.store";
import threadStore from "../src/services/agent/memory/thread.store";
import WorkoutService from "../src/services/workouts/model/workouts.model";
import { parseWorkout } from "../src/services/workouts/parsing/workoutParse.service";
import { canonicalExercise } from "../src/services/workouts/domain/exercise.catalog";
import { matchWatchWorkout } from "../src/services/workouts/domain/workout.matching";
import { applyWorkoutEdits } from "../src/services/agent/tools/workout.tools";

const log = (s: string) => console.log(s);

async function main() {
  const email = process.argv.slice(2).find((a) => a.includes("@")) ?? "antoricciardelli@gmail.com";
  const p = await prisma.patient.findUnique({ where: { email }, select: { id: true, timeZone: true } });
  assert(p, "patient missing");
  const pid = p.id;
  const tz = p.timeZone || "Europe/Rome";
  const today = moment().tz(tz).format("YYYY-MM-DD");
  const created: string[] = [];
  let threadId: string | null = null;
  // Leftovers from an aborted run: pending workout proposals + their threads, smoke sessions.
  for (const stale of await prisma.agentProposal.findMany({ where: { patientId: pid, toolName: "log_workout", status: "PENDING" }, select: { id: true, threadId: true } })) {
    await proposalStore.cancel(pid, stale.id).catch(() => undefined);
    if (stale.threadId) await threadStore.remove(pid, stale.threadId).catch(() => undefined);
  }
  await prisma.workoutSession.deleteMany({ where: { patientId: pid, externalId: { in: ["SMOKE-WATCH-1", "SMOKE-WATCH-2"] } } });
  const t0 = Date.now();

  /* 0. pure pieces */
  assert.equal(canonicalExercise("flat bench").key, "bench_press");
  assert.equal(canonicalExercise("Incline DB press").key, "incline_dumbbell_press");
  assert.equal(canonicalExercise("panca piana").key, "bench_press");
  assert(canonicalExercise("landmine rotations").key.startsWith("custom:"));
  log("✓ exercise canonicalisation");

  /* 1. parser alone */
  const parsed = await parseWorkout("Push day this evening: bench 4x8 at 70kg, incline dumbbell press 3x10 with 24s, dips 3 sets to failure, about 50 minutes", { today, timeZone: tz });
  assert(parsed.isWorkout);
  assert.equal(parsed.activityKey, "strength");
  assert.equal(parsed.exercises.length, 3, JSON.stringify(parsed.exercises));
  assert.equal(parsed.exercises[0].exerciseKey, "bench_press");
  assert.equal(parsed.exercises[0].sets.length, 4);
  assert.equal(parsed.exercises[0].sets[0].reps, 8);
  assert.equal(parsed.exercises[0].sets[0].weightKg, 70);
  assert.equal(parsed.exercises[1].sets[0].weightKg, 24);
  assert(parsed.exercises[2].sets.every((s) => s.toFailure));
  assert.equal(parsed.durationSec, 50 * 60);
  log(`✓ parser (${parsed.model}, ${parsed.latencyMs} ms): ${parsed.exercises.map((e) => `${e.name}×${e.sets.length}`).join(", ")}`);

  /* 2. watch matching (pure) */
  const start = moment().tz(tz).hour(18).minute(4).second(0).millisecond(0);
  const watch = {
    externalId: "SMOKE-WATCH-1",
    activityName: "TraditionalStrengthTraining",
    startedAt: start.toISOString(),
    endedAt: start.clone().add(52, "minutes").toISOString(),
    durationSec: 52 * 60,
    calories: 312,
    avgHr: 118,
    peakHr: 161,
    lowHr: 82,
    zoneSeconds: [600, 1200, 900, 360, 60],
    sourceName: "Smoke Watch",
  };
  const decoy = { ...watch, externalId: "SMOKE-WATCH-2", activityName: "Walking", startedAt: start.clone().hour(7).toISOString(), endedAt: start.clone().hour(7).add(25, "minutes").toISOString(), durationSec: 25 * 60, calories: 90, avgHr: 95 };
  const m = matchWatchWorkout({ activityKey: "strength", day: today, startedAtMs: null, durationSec: 50 * 60 }, [decoy, watch], (iso) => moment(iso).tz(tz).format("YYYY-MM-DD"));
  assert(m.kind === "likely" || m.kind === "exact");
  assert.equal((m as any).workout.externalId, "SMOKE-WATCH-1");
  log(`✓ matching picks the strength workout over the morning walk (${m.kind})`);

  /* 3. through the agent, with client context */
  const turn = async (message: string) => {
    const r = await runTurnCollect({ patientId: pid, threadId, message, client: { recentWorkouts: [decoy, watch] } });
    threadId = r.threadId;
    const tools = r.events.filter((e): e is any => e.type === "tool_start").map((e) => e.name);
    const proposals = r.events.filter((e): e is any => e.type === "proposal");
    log(`\n> ${message}\n  tools=${JSON.stringify(tools)} safety=${JSON.stringify(r.safety)}${r.error ? " ERROR " + r.error : ""}`);
    log("  " + (r.done?.text ?? "").split("\n").join("\n  "));
    return { ...r, proposals, tools };
  };
  const a = await turn("Did push day tonight: bench 4x8 at 70kg, incline dumbbell press 3x10 with 24s, dips 3 sets to failure. Took about 50 minutes, felt strong.");
  assert(a.tools.includes("log_workout"), "log_workout called");
  assert.equal(a.proposals.length, 1, "one proposal");
  const prop = a.proposals[0];
  assert.equal(prop.toolName, "log_workout");
  const preview: any = prop.preview;
  assert.equal(preview.exercises.length, 3);
  assert.equal(preview.watchLabel && preview.session.watch.externalId, "SMOKE-WATCH-1", "linked to the strength watch workout");
  assert.equal(preview.calories, 312);
  assert(!/\b(logged|saved) (it|that|your)/i.test(a.done!.text) || /confirm/i.test(a.done!.text), "must not claim it is logged");
  log(`  proposal: ${prop.title} — ${prop.summary}`);

  /* 4. edit a set on the card, confirm */
  const edited = applyWorkoutEdits(preview, { exercises: [{ index: 0, sets: [{ index: 3, weightKg: 72.5 }] }] });
  assert.equal(edited.session.exercises[0].sets[3].weightKg, 72.5);
  const c = await proposalStore.confirm(pid, prop.proposalId, null, { exercises: [{ index: 0, sets: [{ index: 3, weightKg: 72.5 }] }] });
  assert.equal(c.status, 200, JSON.stringify(c));
  const saved = (c as any).result;
  created.push(saved.id);
  const row = await WorkoutService.get(pid, saved.id);
  assert(row, "session row");
  assert.equal(row!.source, "OLLIE");
  assert.equal(row!.externalId, "SMOKE-WATCH-1");
  assert.equal(row!.calories, 312);
  assert.equal(row!.avgHr, 118);
  assert.equal(row!.exercises.length, 3);
  assert.equal(row!.exercises[0].sets[3].weightKg, 72.5, "edited weight persisted");
  assert.equal(row!.zoneSeconds.length, 5);
  log(`  ✓ confirmed → WorkoutSession ${row!.id} (${row!.title ?? row!.activityKey}) ${row!.durationSec / 60} min, ${row!.calories} kcal, ${row!.exercises.length} exercises`);

  /* 5. next turn reads it back */
  const b = await turn("What did I do on bench today and how does it compare to last time?");
  assert(b.tools.includes("get_workouts") || /72\.5|70/.test(b.done!.text), "reads the session back");

  /* 6. sync must keep the detail and only refresh metrics */
  const sync = await WorkoutService.syncFromHealthKit(pid, { windowStart: start.clone().subtract(1, "day").toISOString(), windowEnd: start.clone().add(1, "day").toISOString(), workouts: [{ ...watch, calories: 320 }] });
  const after = await WorkoutService.get(pid, saved.id);
  assert.equal(after!.calories, 320, "metrics refreshed by sync");
  assert.equal(after!.exercises.length, 3, "exercises survive sync");
  assert.equal(after!.source, "OLLIE");
  log(`  ✓ sync ${JSON.stringify(sync)} refreshed calories, kept exercises`);

  /* 7. watch-only workout synced, then removed from Health */
  const s2 = await WorkoutService.syncFromHealthKit(pid, { windowStart: start.clone().subtract(1, "day").toISOString(), windowEnd: start.clone().add(1, "day").toISOString(), workouts: [{ ...watch, calories: 320 }, decoy] });
  assert.equal(s2.created, 1);
  const walk = await prisma.workoutSession.findUnique({ where: { patientId_externalId: { patientId: pid, externalId: "SMOKE-WATCH-2" } } });
  assert(walk && walk.source === "HEALTHKIT" && walk.activityKey === "walking");
  created.push(walk!.id);
  const s3 = await WorkoutService.syncFromHealthKit(pid, { windowStart: start.clone().subtract(1, "day").toISOString(), windowEnd: start.clone().add(1, "day").toISOString(), workouts: [{ ...watch, calories: 320 }] });
  const walkGone = await prisma.workoutSession.findUnique({ where: { id: walk!.id } });
  assert(walkGone?.deletedAt, "watch-only session soft-deleted when it disappears from Health");
  assert.equal(s3.removed, 1);
  log("  ✓ watch-only sync + removal");

  /* 8. no watch data → estimate */
  const d = await turn("Also yesterday morning I ran 5k in about 28 minutes, no watch.");
  assert(d.tools.includes("log_workout"));
  const p2 = d.proposals[0];
  assert(p2, "proposal for the run");
  assert.equal((p2.preview as any).session.watch, null);
  assert.equal((p2.preview as any).session.activityKey, "running");
  log(`  run preview: ${(p2.preview as any).summary} · assumptions=${JSON.stringify((p2.preview as any).assumptions)}`);
  await proposalStore.cancel(pid, p2.proposalId);

  log(`\nall good in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

  /* cleanup */
  await prisma.workoutSession.deleteMany({ where: { id: { in: created } } });
  await prisma.workoutSession.deleteMany({ where: { patientId: pid, externalId: { in: ["SMOKE-WATCH-1", "SMOKE-WATCH-2"] } } });
  if (threadId) await threadStore.remove(pid, threadId).catch(() => undefined);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
