/**
 * Dev seed: a training profile + a 7-day training week (Mon–Sun of the
 * current ISO week) for one patient, with the first session already done,
 * so the week screen / Exercise "This week" / dashboard row / snapshot have
 * something to show. Replaces any active week (previous → REPLACED).
 *   npx ts-node --transpile-only scripts/seed-training-week.ts [email] [--clear]
 */
import "dotenv/config";
import moment from "moment-timezone";
import prisma from "../src/utility/prismaClient";
import WorkoutService from "../src/services/workouts/model/workouts.model";
import WorkoutPlanService from "../src/services/workouts/model/plan.model";
import TrainingProfileService from "../src/services/workouts/model/training_profile.model";
import { WorkoutPlanInput, SessionInput } from "../src/services/workouts/domain/workout.schema";

const TITLE = "Upper / lower week";

async function main() {
  const email = process.argv.slice(2).find((a) => a.includes("@")) ?? "antoricciardelli@gmail.com";
  const clear = process.argv.includes("--clear");
  const p = await prisma.patient.findUnique({ where: { email }, select: { id: true, timeZone: true } });
  if (!p) throw new Error("patient missing");
  const tz = p.timeZone || "Europe/Rome";
  const monday = moment().tz(tz).startOf("isoWeek");
  const today = moment().tz(tz).format("YYYY-MM-DD");

  if (clear) {
    const plans = await prisma.workoutPlan.findMany({ where: { patientId: p.id, title: TITLE }, select: { id: true } });
    await prisma.workoutSession.deleteMany({ where: { planId: { in: plans.map((x) => x.id) } } });
    await prisma.workoutPlan.deleteMany({ where: { id: { in: plans.map((x) => x.id) } } });
    console.log(`cleared ${plans.length} seeded week(s)`);
    return;
  }

  await TrainingProfileService.upsert(p.id, { place: "gym", equipment: ["barbell", "dumbbell", "cable", "machine", "bench"], experience: "experienced", sessionMinutes: 45, preferredDays: ["mon", "tue", "thu", "sat"], preferredTime: "18:30", limitations: "left knee — no deep squats" });

  const strength = (title: string, groups: string[], exercises: any[]) => ({ activityKey: "strength", title, durationMin: 45, focus: "strength", place: "gym", muscleGroups: groups, why: `${groups.join(" and ")} are fresh; loads follow your last sessions.`, warmup: ["6 min bike", "band pull-aparts", "one light set of the first lift"], cooldown: ["3 min easy walk", "chest + hip flexor stretch"], exercises });
  const set = (n: number, reps: number, kg: number | null, rest: number, repsMax?: number) => Array.from({ length: n }, () => ({ targetReps: reps, targetRepsMax: repsMax ?? null, targetKg: kg, restSec: rest }));
  const week = WorkoutPlanInput.parse({
    title: TITLE,
    notes: "Two upper, one lower, one easy run. Miss a day? Do the next one, don't double up.",
    startDate: monday.format("YYYY-MM-DD"),
    days: 7,
    brief: { sessionsPerWeek: 4, sessionMinutes: 45, focus: "strength", place: "gym" },
    fit: { ok: true, issues: [] },
    source: "ollie",
    sessions: [
      { day: 1, ...strength("Upper body A", ["chest", "back", "shoulders"], [
        { exerciseKey: "bench_press", name: "Bench press", muscleGroup: "chest", equipment: "barbell", loadNote: "same as last time +2.5 kg", sets: set(4, 8, 60, 120) },
        { exerciseKey: "chest_supported_row", name: "Chest-supported row", muscleGroup: "back", equipment: "dumbbell", loadNote: "a weight you could do 12 with, 2 reps in reserve", sets: set(4, 10, null, 90, 12) },
        { exerciseKey: "overhead_press", name: "Overhead press", muscleGroup: "shoulders", equipment: "barbell", sets: set(3, 8, 37.5, 120) },
        { exerciseKey: "lat_pulldown", name: "Lat pulldown", muscleGroup: "back", equipment: "cable", sets: set(3, 12, 55, 60) },
        { exerciseKey: "face_pull", name: "Face pull", muscleGroup: "shoulders", equipment: "cable", loadNote: "light — feel it in the rear delts", sets: set(3, 15, null, 60) },
      ]) },
      { day: 2, ...strength("Lower body", ["legs", "glutes"], [
        { exerciseKey: "leg_press", name: "Leg press", muscleGroup: "legs", equipment: "machine", loadNote: "knee-friendly depth — stop before it pinches", sets: set(4, 10, 140, 120) },
        { exerciseKey: "romanian_deadlift", name: "Romanian deadlift", muscleGroup: "legs", equipment: "barbell", sets: set(3, 8, 80, 120) },
        { exerciseKey: "hip_thrust", name: "Hip thrust", muscleGroup: "glutes", equipment: "barbell", sets: set(3, 10, null, 90, 12) },
        { exerciseKey: "leg_curl", name: "Leg curl", muscleGroup: "legs", equipment: "machine", sets: set(3, 12, null, 60) },
        { exerciseKey: "plank", name: "Plank", muscleGroup: "core", equipment: "bodyweight", sets: Array.from({ length: 3 }, () => ({ durationSec: 40, restSec: 30 })) },
      ]) },
      { day: 4, ...strength("Upper body B", ["back", "chest", "arms"], [
        { exerciseKey: "pull_up", name: "Pull-up", muscleGroup: "back", equipment: "bodyweight", loadNote: "bodyweight, leave 2 reps in reserve", sets: set(4, 6, null, 120, 8) },
        { exerciseKey: "incline_dumbbell_press", name: "Incline dumbbell press", muscleGroup: "chest", equipment: "dumbbell", sets: set(4, 10, 24, 90) },
        { exerciseKey: "seated_cable_row", name: "Seated cable row", muscleGroup: "back", equipment: "cable", sets: set(3, 12, 60, 60) },
        { exerciseKey: "lateral_raise", name: "Lateral raise", muscleGroup: "shoulders", equipment: "dumbbell", sets: set(3, 15, 10, 60) },
        { exerciseKey: "bicep_curl", name: "Bicep curl", muscleGroup: "arms", equipment: "dumbbell", sets: set(3, 12, null, 60) },
      ]) },
      { day: 6, activityKey: "running", title: "Easy run", durationMin: 35, focus: "endurance", place: "outdoor", muscleGroups: ["cardio"], why: "Easy pace, conversational — it's recovery, not a workout to win.", warmup: ["5 min brisk walk"], cooldown: ["5 min walk", "calf stretch"], distanceKm: 5, exercises: [] },
    ],
  });

  const saved = await WorkoutPlanService.create(p.id, week);
  // Day 1 done (if it is not in the future): completed in place with actuals beside the targets.
  const day1 = saved.daysOut[0].planned!;
  if (day1.plannedFor! <= today) {
    const start = moment.tz(`${day1.plannedFor} 18:35`, "YYYY-MM-DD HH:mm", tz);
    await WorkoutService.completeSession(
      p.id,
      day1.id,
      SessionInput.parse({
        activityKey: "strength",
        startedAt: start.toISOString(),
        endedAt: start.clone().add(47, "minutes").toISOString(),
        durationSec: 47 * 60,
        rpe: 7,
        description: "bench 4x8 at 60, rows 4x10 with 26s, ohp 3x8 at 37.5, pulldown 3x12 at 55, face pulls 3x15",
        exercises: [
          { exerciseKey: "bench_press", name: "Bench press", sets: [8, 8, 8, 7].map((r) => ({ reps: r, weightKg: 60 })) },
          { exerciseKey: "chest_supported_row", name: "Chest-supported row", sets: [10, 10, 10, 10].map((r) => ({ reps: r, weightKg: 26 })) },
          { exerciseKey: "overhead_press", name: "Overhead press", sets: [8, 8, 6].map((r) => ({ reps: r, weightKg: 37.5 })) },
          { exerciseKey: "lat_pulldown", name: "Lat pulldown", sets: [12, 12, 12].map((r) => ({ reps: r, weightKg: 55 })) },
          { exerciseKey: "face_pull", name: "Face pull", sets: [15, 15, 15].map((r) => ({ reps: r, weightKg: 20 })) },
        ],
        watch: null,
      }),
      "OLLIE"
    );
  }
  const v = await WorkoutPlanService.getActive(p.id);
  console.log(`seeded "${v!.title}" ${v!.startDate}→${v!.endDate}: ${v!.daysOut.map((d) => `${moment(d.date).format("ddd")}:${d.state}`).join(" ")}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
