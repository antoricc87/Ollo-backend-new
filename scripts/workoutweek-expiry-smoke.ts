/**
 * Training week end-of-life smoke (no LLM):
 *   a week whose last day has passed stops being current → COMPLETED, its
 *   still-PLANNED rows dropped, done rows kept
 *   → "repeat last week" copies its sessions onto this week's matching days
 *     (past days skipped), targets kept
 *   → Ollie's newest unsaved week card is offered as the draft; saving a week
 *     after it clears it; a draft whose week is over is never offered.
 * Self-cleaning.  npx ts-node --transpile-only scripts/workoutweek-expiry-smoke.ts [email]
 */
import "dotenv/config";
import assert from "assert";
import moment from "moment-timezone";
import prisma from "../src/utility/prismaClient";
import WorkoutService from "../src/services/workouts/model/workouts.model";
import WorkoutPlanService, { shiftDay } from "../src/services/workouts/model/plan.model";
import { WorkoutPlanInput } from "../src/services/workouts/domain/workout.schema";

const log = (s: string) => console.log(s);
const TAG = "SMOKE-EXPIRY";

const session = (day: number, title: string) => ({
  day,
  activityKey: "strength",
  title: `${TAG} ${title}`,
  durationMin: 45,
  focus: "strength",
  place: "gym",
  exercises: [{ exerciseKey: "bench_press", name: "Bench press", sets: [{ targetReps: 8, targetRepsMax: 10, targetKg: 60, restSec: 90 }, { targetReps: 8, targetRepsMax: 10, targetKg: 60, restSec: 90 }] }],
});

async function main() {
  const email = process.argv.slice(2).find((a) => a.includes("@")) ?? "antoricciardelli@gmail.com";
  const p = await prisma.patient.findUnique({ where: { email }, select: { id: true } });
  assert(p, "patient missing");
  const pid = p.id;
  const tz = await WorkoutService.tzOf(pid);
  const today = moment().tz(tz).format("YYYY-MM-DD");
  const thisMonday = moment.utc(today, "YYYY-MM-DD").startOf("isoWeek").format("YYYY-MM-DD");

  const previousActive = await prisma.workoutPlan.findFirst({ where: { patientId: pid, status: "ACTIVE" }, select: { id: true } });
  let threadId: string | null = null;
  const cleanup = async () => {
    await prisma.workoutSession.deleteMany({ where: { patientId: pid, OR: [{ plan: { title: { startsWith: TAG } } }, { title: { startsWith: TAG } }] } });
    await prisma.workoutPlan.deleteMany({ where: { patientId: pid, title: { startsWith: TAG } } });
    await prisma.agentThread.deleteMany({ where: { patientId: pid, title: { startsWith: TAG } } });
    if (previousActive) await prisma.workoutPlan.update({ where: { id: previousActive.id }, data: { status: "ACTIVE" } }).catch(() => undefined);
  };
  await cleanup();

  try {
    /* 1. a week two Mondays ago: Mon done, Wed + Fri never done */
    const oldMonday = shiftDay(thisMonday, -14);
    const saved = await WorkoutPlanService.create(pid, WorkoutPlanInput.parse({ title: `${TAG} Old week`, days: 7, startDate: oldMonday, sessions: [session(1, "Upper"), session(3, "Lower"), session(5, "Full body")] }));
    const mon = saved.daysOut[0].planned!;
    await prisma.workoutSession.update({ where: { id: mon.id }, data: { status: "COMPLETED", completedAt: new Date() } });

    assert.equal(await WorkoutPlanService.getActive(pid), null, "an ended week is not current");
    const row = await prisma.workoutPlan.findUnique({ where: { id: saved.id } });
    assert.equal(row?.status, "COMPLETED", "the ended week is closed");
    const live = await prisma.workoutSession.findMany({ where: { planId: saved.id, deletedAt: null } });
    assert.deepEqual(live.map((s) => s.id), [mon.id], "only the done session stays; unfinished planned rows are dropped");
    log("✓ ended week retired: COMPLETED, 1 done kept, 2 planned dropped");

    /* 2. a draft card from Ollie for this week, after the last save */
    const thread = await prisma.agentThread.create({ data: { patientId: pid, title: `${TAG} thread`, source: "PROACTIVE" } });
    threadId = thread.id;
    const card = { type: "workout_plan", data: { draftId: "smoke", title: `${TAG} Draft`, startDate: thisMonday, days: 7, sessions: [{ day: 7, session: { ...session(7, "Sunday"), plannedFor: shiftDay(thisMonday, 6) } }] } };
    await prisma.agentMessage.create({ data: { threadId: thread.id, seq: 1, role: "ASSISTANT", content: "draft", cards: [card] as any } });
    const draft = await WorkoutPlanService.pendingDraft(pid);
    assert.equal(draft?.card?.title, `${TAG} Draft`, "the unsaved card is offered");
    assert.equal(draft?.threadId, thread.id);
    log("✓ pending draft found from the stored card");

    /* 3. a draft whose week is over is not offered */
    await prisma.agentMessage.create({ data: { threadId: thread.id, seq: 2, role: "ASSISTANT", content: "old draft", cards: [{ type: "workout_plan", data: { ...card.data, title: `${TAG} Stale`, startDate: oldMonday } }] as any } });
    assert.equal(await WorkoutPlanService.pendingDraft(pid), null, "the newest draft is over → nothing offered");
    await prisma.agentMessage.deleteMany({ where: { threadId: thread.id, seq: 2 } });
    log("✓ an ended draft is not offered");

    /* 4. repeat last week → same weekdays this week, past days skipped, targets kept */
    const repeated = await WorkoutPlanService.repeatLast(pid);
    assert(repeated, "repeat returns a week");
    const want = [1, 3, 5].map((d) => shiftDay(thisMonday, d - 1)).filter((d) => d >= today);
    const monday = want.length ? thisMonday : shiftDay(thisMonday, 7);
    const expected = want.length ? want : [1, 3, 5].map((d) => shiftDay(monday, d - 1));
    assert.equal(repeated.startDate, monday);
    const got = repeated.daysOut.filter((d) => d.planned).map((d) => d.date);
    assert.deepEqual(got, expected, `repeated days ${got} vs ${expected}`);
    const ex = repeated.daysOut.find((d) => d.planned)!.planned!.exercises[0];
    assert.equal(ex.sets[0].targetKg, 60);
    assert.equal(ex.sets[0].targetRepsMax, 10);
    assert.equal((await WorkoutPlanService.getActive(pid))?.id, repeated.id, "the repeated week is current");
    log(`✓ repeat last week: ${got.join(", ")} (targets kept)`);

    /* 5. saving cleared the draft (it is older than the saved week) */
    assert.equal(await WorkoutPlanService.pendingDraft(pid), null, "a save after the draft clears it");
    log("✓ draft cleared by a later save");

    log("\nALL PASS");
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
