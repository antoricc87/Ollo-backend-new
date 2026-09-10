/**
 * Training week smoke (no LLM): planned rows in the workouts domain.
 *   save a week → planned WorkoutSession rows under a header
 *   → watch sync on a planned day ADOPTS the row (no duplicate)
 *   → a described session on another planned day ADOPTS it, carrying targets
 *   → a described session on a rest day creates a fresh row
 *   → swap a day; put a single workout on a day; replacing the week keeps
 *     completed rows and drops still-planned ones; training profile round trip.
 * Self-cleaning.  npx ts-node --transpile-only scripts/workoutplan-smoke.ts [email]
 */
import "dotenv/config";
import assert from "assert";
import moment from "moment-timezone";
import prisma from "../src/utility/prismaClient";
import WorkoutService from "../src/services/workouts/model/workouts.model";
import WorkoutPlanService, { shiftDay } from "../src/services/workouts/model/plan.model";
import TrainingProfileService from "../src/services/workouts/model/training_profile.model";
import { WorkoutPlanInput, SessionInput } from "../src/services/workouts/domain/workout.schema";
import { matchPlannedSession } from "../src/services/workouts/domain/workout.matching";

const log = (s: string) => console.log(s);
const TAG = "SMOKE-PLAN";

async function main() {
  const email = process.argv.slice(2).find((a) => a.includes("@")) ?? "antoricciardelli@gmail.com";
  const p = await prisma.patient.findUnique({ where: { email }, select: { id: true, timeZone: true } });
  assert(p, "patient missing");
  const pid = p.id;
  const tz = p.timeZone || "Europe/Rome";
  const today = moment().tz(tz).format("YYYY-MM-DD");
  const t0 = Date.now();

  // Remember what was active so it can be restored; clear leftovers from an aborted run.
  const previousActive = await prisma.workoutPlan.findFirst({ where: { patientId: pid, status: "ACTIVE" }, select: { id: true } });
  const previousProfile = await prisma.trainingProfile.findUnique({ where: { patientId: pid } });
  const cleanup = async () => {
    await prisma.workoutSession.deleteMany({ where: { patientId: pid, OR: [{ externalId: { startsWith: TAG } }, { plan: { title: { startsWith: TAG } } }, { title: { startsWith: TAG } }] } });
    await prisma.workoutPlan.deleteMany({ where: { patientId: pid, title: { startsWith: TAG } } });
    if (previousActive) await prisma.workoutPlan.update({ where: { id: previousActive.id }, data: { status: "ACTIVE" } }).catch(() => undefined);
    if (previousProfile) await prisma.trainingProfile.update({ where: { patientId: pid }, data: { ...previousProfile, patientId: undefined, updatedAt: undefined } as any });
    else await prisma.trainingProfile.deleteMany({ where: { patientId: pid } });
  };
  await cleanup();

  /* 0. pure: planned-session ranking */
  const cands = [
    { id: "a", activityKey: "strength", startedAt: `${today}T05:00:00.000Z`, endedAt: `${today}T05:45:00.000Z`, durationSec: 45 * 60 },
    { id: "b", activityKey: "running", startedAt: `${today}T16:00:00.000Z`, endedAt: `${today}T16:30:00.000Z`, durationSec: 30 * 60 },
  ];
  assert.equal(matchPlannedSession({ activityKey: "hiit", day: today, startedAtMs: null, durationSec: 40 * 60 }, cands)?.id, "a", "strength-shaped session adopts the strength row");
  assert.equal(matchPlannedSession({ activityKey: "running", day: today, startedAtMs: null, durationSec: null }, cands)?.id, "b");
  assert.equal(matchPlannedSession({ activityKey: "cycling", day: today, startedAtMs: null, durationSec: null }, cands), null, "endurance kinds don't cross-adopt");
  log("✓ planned matching");

  /* 1. training profile */
  const prof = await TrainingProfileService.upsert(pid, { place: "gym", equipment: ["barbell", "dumbbell", "cable"], experience: "experienced", sessionMinutes: 45, preferredDays: ["mon", "wed", "fri"], preferredTime: "18:30", limitations: "left knee — no deep squats" });
  assert.deepEqual(prof.equipment, ["barbell", "dumbbell", "cable"]);
  const prof2 = await TrainingProfileService.upsert(pid, { sessionMinutes: 50 });
  assert.equal(prof2.place, "gym", "merge keeps untouched fields");
  assert.equal(prof2.sessionMinutes, 50);
  const line = TrainingProfileService.render(prof2)!;
  assert(/gym; barbell, dumbbell, cable; experienced; 50 min sessions; mon wed fri; usually 18:30; limitations \(their words\): "left knee/.test(line), line);
  log(`✓ training profile: ${line}`);

  /* 2. save a week starting today: Mon-ish day1 strength, day2 run, day3 rest, day4 strength */
  const week = WorkoutPlanInput.parse({
    title: `${TAG} Upper/lower week`,
    days: 5,
    startDate: today,
    brief: { sessionsPerWeek: 3, sessionMinutes: 45, focus: "strength", place: "gym" },
    sessions: [
      {
        day: 1,
        activityKey: "strength",
        title: "Upper body",
        durationMin: 45,
        focus: "strength",
        place: "gym",
        muscleGroups: ["chest", "back", "shoulders"],
        why: "chest and back were last trained a week ago",
        warmup: ["6 min bike", "band pull-aparts"],
        exercises: [
          { exerciseKey: "bench_press", name: "Bench press", muscleGroup: "chest", equipment: "barbell", loadNote: "same as last time +2.5 kg", sets: [1, 2, 3, 4].map(() => ({ targetReps: 8, targetKg: 60, restSec: 120 })) },
          { exerciseKey: "lat_pulldown", name: "Lat pulldown", muscleGroup: "back", equipment: "cable", sets: [1, 2, 3].map(() => ({ targetReps: 10, targetRepsMax: 12, restSec: 90 })) },
        ],
      },
      { day: 2, activityKey: "running", title: "Easy run", durationMin: 30, focus: "endurance", place: "outdoor", distanceKm: 5, exercises: [] },
      {
        day: 4,
        activityKey: "strength",
        title: "Lower body",
        durationMin: 45,
        focus: "strength",
        place: "gym",
        muscleGroups: ["legs", "glutes"],
        exercises: [{ exerciseKey: "leg_press", name: "Leg press", muscleGroup: "legs", equipment: "machine", sets: [1, 2, 3].map(() => ({ targetReps: 12, restSec: 90 })) }],
      },
    ],
  });
  const saved = await WorkoutPlanService.create(pid, week);
  assert.equal(saved.days, 5);
  assert.equal(saved.planned, 3);
  assert.equal(saved.done, 0);
  assert.equal(saved.daysOut[0].state, "planned");
  assert.equal(saved.daysOut[2].state, "rest");
  const day1 = saved.daysOut[0].planned!;
  assert.equal(day1.status, "PLANNED");
  assert.equal(day1.plannedFor, today);
  assert.equal(moment(day1.startedAt).tz(tz).format("HH:mm"), "18:30", "planned slot at the profile's preferred time");
  assert.equal(day1.exercises[0].sets[0].targetKg, 60);
  assert.equal(day1.exercises[0].sets[0].reps, null, "no actuals yet");
  const listed = await WorkoutService.list(pid, { from: moment().tz(tz).startOf("day").toDate(), to: moment().tz(tz).add(6, "days").toDate() });
  assert(!listed.some((s) => s.planId === saved.id), "default list (COMPLETED) hides planned rows");
  const plannedRows = await WorkoutService.listPlanned(pid, today, shiftDay(today, 6));
  assert.equal(plannedRows.filter((s) => s.planId === saved.id).length, 3);
  log(`✓ week saved: ${saved.daysOut.map((d) => `${d.day}:${d.state}`).join(" ")}`);

  /* 3. watch sync on day 1 adopts the planned strength row */
  const start = moment().tz(tz).hour(18).minute(40).second(0).millisecond(0);
  const watch = { externalId: `${TAG}-WATCH-1`, activityName: "TraditionalStrengthTraining", startedAt: start.toISOString(), endedAt: start.clone().add(48, "minutes").toISOString(), durationSec: 48 * 60, calories: 300, avgHr: 121, peakHr: 158, lowHr: 80, zoneSeconds: [500, 1100, 900, 300, 80] };
  const win = { windowStart: start.clone().subtract(1, "day").toISOString(), windowEnd: start.clone().add(1, "day").toISOString() };
  const s1 = await WorkoutService.syncFromHealthKit(pid, { ...win, workouts: [watch] });
  assert.equal(s1.adopted, 1, JSON.stringify(s1));
  assert.equal(s1.created, 0, "no duplicate HEALTHKIT row");
  const adopted = await WorkoutService.get(pid, day1.id);
  assert.equal(adopted!.status, "COMPLETED");
  assert.equal(adopted!.externalId, watch.externalId);
  assert.equal(adopted!.calories, 300);
  assert.equal(adopted!.source, "OLLIE", "source unchanged");
  assert.equal(adopted!.exercises.length, 2, "prescription kept for the user to fill in");
  assert.equal(adopted!.exercises[0].sets[0].targetKg, 60);
  const v2 = await WorkoutPlanService.getActive(pid);
  assert.equal(v2!.done, 1);
  assert.equal(v2!.daysOut[0].state, "done");
  // second sync of the same workout is an ordinary metric refresh
  const s1b = await WorkoutService.syncFromHealthKit(pid, { ...win, workouts: [{ ...watch, calories: 310 }] });
  assert.equal(s1b.updated, 1);
  assert.equal((await WorkoutService.get(pid, day1.id))!.calories, 310);
  log("✓ watch sync adopted the planned row, kept targets, refreshed metrics");

  /* 4. the user then describes the sets (watch-linked): same row, actuals beside targets */
  const described = SessionInput.parse({
    activityKey: "strength",
    title: null,
    startedAt: watch.startedAt,
    endedAt: watch.endedAt,
    durationSec: watch.durationSec,
    description: "bench 4x8 at 60, pulldown 3x12 at 55",
    exercises: [
      { exerciseKey: "bench_press", name: "Bench press", sets: [1, 2, 3, 4].map(() => ({ reps: 8, weightKg: 60 })) },
      { exerciseKey: "lat_pulldown", name: "Lat pulldown", sets: [1, 2, 3].map(() => ({ reps: 12, weightKg: 55 })) },
    ],
    watch,
  });
  const done1 = await WorkoutService.createSession(pid, described, "OLLIE");
  assert.equal(done1.id, day1.id, "described session completed the SAME row");
  assert.equal(done1.title, "Upper body", "planned title kept");
  assert.equal(done1.exercises[0].sets[0].reps, 8);
  assert.equal(done1.exercises[0].sets[0].targetKg, 60, "targets carried onto the actual sets");
  assert.equal(done1.exercises[1].sets[0].targetRepsMax, 12);
  assert.equal(await prisma.workoutSession.count({ where: { patientId: pid, deletedAt: null, externalId: watch.externalId } }), 1);
  log("✓ described sets landed on the adopted row with targets beside actuals");

  /* 5. a described session on day 2 (no watch) adopts the run; on day 3 (rest) creates a fresh row */
  const day2 = shiftDay(today, 1);
  const run = SessionInput.parse({ activityKey: "running", startedAt: moment.tz(`${day2} 07:10`, "YYYY-MM-DD HH:mm", tz).toISOString(), endedAt: moment.tz(`${day2} 07:40`, "YYYY-MM-DD HH:mm", tz).toISOString(), durationSec: 30 * 60, distanceKm: 5.2, description: "ran 5.2k", exercises: [], watch: null });
  const doneRun = await WorkoutService.createSession(pid, run, "OLLIE");
  assert.equal(doneRun.planId, saved.id, "run adopted the planned run");
  assert.equal(doneRun.status, "COMPLETED");
  assert.equal(doneRun.distanceKm, 5.2);
  const day3 = shiftDay(today, 2);
  const yoga = SessionInput.parse({ activityKey: "yoga", title: `${TAG} yoga`, startedAt: moment.tz(`${day3} 08:00`, "YYYY-MM-DD HH:mm", tz).toISOString(), endedAt: moment.tz(`${day3} 08:40`, "YYYY-MM-DD HH:mm", tz).toISOString(), durationSec: 40 * 60, exercises: [], watch: null });
  const other = await WorkoutService.createSession(pid, yoga, "OLLIE");
  assert.equal(other.planId, null);
  const v3 = await WorkoutPlanService.getActive(pid);
  assert.equal(v3!.done, 2);
  assert.equal(v3!.daysOut[1].state, "done");
  assert.equal(v3!.daysOut[2].state, "other");
  assert.equal(v3!.daysOut[2].other[0].id, other.id);
  log(`✓ adoption: ${v3!.daysOut.map((d) => `${d.day}:${d.state}`).join(" ")}`);

  /* 6. swap day 4 */
  const day4 = v3!.daysOut[3].planned!;
  const swapped = await WorkoutService.replacePlanned(pid, day4.id, { activityKey: "strength", title: "Lower body B", plannedFor: day4.plannedFor!, durationMin: 40, focus: "hypertrophy", place: "gym", muscleGroups: ["legs"], warmup: [], cooldown: [], exercises: [{ exerciseKey: "back_squat", name: "Back squat", sets: [{ targetReps: 5, targetKg: 80, restSec: 150 }] }] });
  assert(swapped && swapped.planId === saved.id);
  assert((await prisma.workoutSession.findUnique({ where: { id: day4.id } }))!.deletedAt, "old planned row soft-deleted");
  const v4 = await WorkoutPlanService.getActive(pid);
  assert.equal(v4!.daysOut[3].planned!.id, swapped!.id);
  assert.equal(v4!.planned, 3);
  log("✓ swap replaces the day's planned row");

  /* 7. put a single workout on the rest day (day 5) inside the active week */
  const day5 = shiftDay(today, 4);
  const put = await WorkoutPlanService.putOnDay(pid, { activityKey: "core", title: "Core 15", plannedFor: day5, durationMin: 15, focus: "conditioning", place: "anywhere", muscleGroups: ["core"], warmup: [], cooldown: [], exercises: [{ exerciseKey: "plank", name: "Plank", sets: [{ durationSec: 40, restSec: 30 }, { durationSec: 40, restSec: 30 }] }] });
  assert.equal(put.plan.id, saved.id);
  assert.equal(put.replaced, false);
  assert.equal(put.plan.planned, 4);
  assert.equal(put.plan.daysOut[4].state, "planned");
  log("✓ single workout put on a day of the active week");

  /* 8. snapshot block */
  const snap = await WorkoutPlanService.forSnapshot(pid, today);
  assert(snap && snap.todayIndex === 1 && snap.done === 2 && snap.planned === 4, JSON.stringify(snap));
  assert(snap!.today?.state === "done" && /Bench press 4×8/.test(snap!.today.text), snap!.today?.text);
  assert.equal(snap!.next?.date, day4.plannedFor);
  log(`✓ snapshot: today ${snap!.today!.text} | next ${snap!.next!.date} ${snap!.next!.text}`);

  /* 9. replacing the week keeps completed rows, drops planned ones */
  const next = await WorkoutPlanService.create(pid, { ...week, title: `${TAG} Week 2`, startDate: shiftDay(today, 7) });
  assert.notEqual(next.id, saved.id);
  assert.equal((await prisma.workoutPlan.findUnique({ where: { id: saved.id } }))!.status, "REPLACED");
  assert.equal((await prisma.workoutSession.findUnique({ where: { id: swapped!.id } }))!.deletedAt != null, true, "still-planned row of the old week dropped");
  assert.equal((await prisma.workoutSession.findUnique({ where: { id: day1.id } }))!.deletedAt, null, "completed row survives");
  assert.equal((await prisma.workoutSession.findUnique({ where: { id: day1.id } }))!.planId, saved.id, "…and still points at its old week");
  const history = await WorkoutService.list(pid, { from: moment().tz(tz).startOf("day").toDate(), to: moment().tz(tz).add(6, "days").toDate() });
  assert.equal(history.filter((s) => s.planId === saved.id).length, 2, "history = the two completed rows");
  log("✓ new week replaced the old one without touching history");

  /* 10. REST-shaped default list excludes planned; ALL includes them */
  const all = await WorkoutService.list(pid, { from: moment().tz(tz).add(6, "days").toDate(), to: moment().tz(tz).add(14, "days").toDate() }, { status: "ALL" });
  assert.equal(all.filter((s) => s.planId === next.id).length, 3);
  log("✓ list status filter");

  log(`\nall good in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  await cleanup();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
