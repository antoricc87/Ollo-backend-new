import moment from "moment-timezone";
import prisma from "../../src/utility/prismaClient";
import PlanService from "../../src/services/plan/model/plan.model";
import CaloriesService from "../../src/services/calories_tracker/model/calories.model";
import { seedClinicianFor, unlinkClinician } from "../../scripts/seed-dev-clinician";

/**
 * A self-contained eval patient with known data, so scenario assertions can
 * check real numbers without depending on anyone's dev account.
 *
 *   LDL 128 mg/dL (ref 0–100, flagged), vitamin D 21 ng/mL (ref 30–100, flagged),
 *   HbA1c 5.4 (normal); metformin 500 mg on record; condition "Hypertension";
 *   plan LOSE_WEIGHT/STEADY: 1500–1700 kcal, protein 120–150 g, 3 sessions/wk;
 *   today: one lunch "Chicken salad with rice" (~520 kcal); no BP/glucose/weight entries;
 *   Dr. Giulia Rossi (internal medicine) on the care team.
 */

export const EVAL_EMAIL = "eval-ollie@ollo.test";
export const EVAL_TZ = "Europe/Rome";

export type Fixture = { patientId: string; todayCalories: number };

export async function createFixture(): Promise<Fixture> {
  await destroyFixture();
  const patient = await prisma.patient.create({
    data: {
      email: EVAL_EMAIL,
      firstName: "Evan",
      lastName: "Eval",
      gender: "male",
      dob: new Date("1988-05-02"),
      timeZone: EVAL_TZ,
      onBoardingComplete: true,
      patientSummary: {
        create: {
          immunizations: ["Tdap 2021"],
          caloricAmount: 1700,
          vitals: { create: { weight: 84, weight_unit: "kg", height: 180, height_unit: "cm", isSmoker: false, activityLevel: "moderate" } },
          nutrition: { create: { dietaryPreferences: ["mediterranean"], foodAllergies: ["shellfish"], foodIDontLike: ["cilantro"], foodIntollerances: [], foodILike: [], foodsToAvoid: [], foodsToIncrease: [] } },
          exercise: { create: { frequency: "2x week", preferences: ["running"] } },
          conditions: { create: [{ condition: { connectOrCreate: { where: { name: "Hypertension" }, create: { name: "Hypertension", clinicalStatus: "active", verificationStatus: "confirmed", onset: "2022" } } } }] },
          medications: { create: [{ medication: { connectOrCreate: { where: { name: "Metformin" }, create: { name: "Metformin", dosage: "500 mg", status: "active" } } } }] },
          allergies: { create: [{ allergy: { connectOrCreate: { where: { substance: "Penicillin" }, create: { substance: "Penicillin", status: "active", reactions: ["rash"] } } } }] },
        },
      },
    },
    include: { patientSummary: true },
  });
  const summaryId = patient.patientSummary!.id;

  await prisma.labResultSummary.create({
    data: {
      patientSummaryId: summaryId,
      labReport: "Eval panel",
      recommendations: {},
      collectedAt: moment().subtract(20, "days").toDate(),
      labResults: {
        create: [
          { category: "Lipids", testType: "LDL Cholesterol", referenceRange: "0-100", isOutOfRange: true, result: "128", units: "mg/dL", aboutTestType: "" },
          { category: "Lipids", testType: "HDL Cholesterol", referenceRange: "40-100", isOutOfRange: false, result: "52", units: "mg/dL", aboutTestType: "" },
          { category: "Vitamins", testType: "Vitamin D (25-OH)", referenceRange: "30-100", isOutOfRange: true, result: "21", units: "ng/mL", aboutTestType: "" },
          { category: "Diabetes", testType: "HbA1c", referenceRange: "4.0-5.6", isOutOfRange: false, result: "5.4", units: "%", aboutTestType: "" },
        ],
      },
    },
  });

  await PlanService.createPlan(patient.id, {
    outcome: "LOSE_WEIGHT",
    intensity: "STEADY",
    outcomeMetric: "weight",
    outcomeStart: 84,
    outcomeTarget: 79,
    outcomeUnit: "kg",
    targets: [
      { pillar: "NUTRITION", metricKey: "calories", cadence: "DAILY", min: 1500, max: 1700, unit: "kcal" },
      { pillar: "NUTRITION", metricKey: "protein_g", cadence: "DAILY", min: 120, max: 150, unit: "g" },
      { pillar: "NUTRITION", metricKey: "carbs_g", cadence: "DAILY", min: 130, max: 170, unit: "g" },
      { pillar: "NUTRITION", metricKey: "fat_g", cadence: "DAILY", min: 45, max: 60, unit: "g" },
      { pillar: "EXERCISE", metricKey: "exercise_sessions", cadence: "WEEKLY", min: 3, max: null, unit: "sessions" },
      { pillar: "SLEEP", metricKey: "sleep_minutes", cadence: "DAILY", min: 420, max: null, unit: "min" },
    ],
    watchOuts: [{ nutrientKey: "saturated_fat", level: "WATCH", limit: 18, unit: "g", reason: "LDL flagged" }],
  });

  // One meal today through the real service (trackers get updated the normal way).
  const lunch = await CaloriesService.createFoodEntry(
    patient.id,
    [
      {
        description: "Chicken salad with rice",
        quantity: "1",
        calories: 520,
        mealType: "LUNCH",
        ingredients: [],
        nutrients: { carbohydrates: 48, proteins: 42, fats: 16, fiber: 6, sodium: 620, naturalSugar: 3, addedSugar: 0, calcium: 60, magnesium: 40, iron: 2, potassium: 500, omega_3: 0.2, cholesterol: 90, zinc: 2, vitaminD: 0, vitaminB12: 0.5, vitaminC: 15, vitaminE: 2 },
        glycemicLoad: 12,
        vegetableServings: 1.5,
        fruitServings: 0,
        isProcessedFood: false,
      },
    ],
    moment().tz(EVAL_TZ).hour(13),
    EVAL_TZ
  );
  const todayCalories = Array.isArray(lunch) ? lunch.reduce((a: number, e: any) => a + (e.calories ?? 0), 0) : 520;
  await seedClinicianFor(EVAL_EMAIL); // Dr. Giulia Rossi (Clinician + CareTeamMember)
  return { patientId: patient.id, todayCalories };
}

export async function destroyFixture() {
  const p = await prisma.patient.findUnique({ where: { email: EVAL_EMAIL }, select: { id: true } });
  if (!p) return;
  // Tracker tables hang off userId without FKs — clear them explicitly.
  const uid = p.id;
  await unlinkClinician(uid);
  await prisma.foodEntry.deleteMany({ where: { dailyFood: { userId: uid } } });
  await prisma.dailyFood.deleteMany({ where: { userId: uid } });
  await prisma.weeklyFood.deleteMany({ where: { userId: uid } }).catch(() => null);
  await prisma.foodTracker.deleteMany({ where: { userId: uid } });
  await prisma.dailyCalories.deleteMany({ where: { userId: uid } });
  await prisma.weeklyCalories.deleteMany({ where: { userId: uid } }).catch(() => null);
  await prisma.caloriesTracker.deleteMany({ where: { userId: uid } });
  await prisma.dailyNutrients.deleteMany({ where: { userId: uid } });
  await prisma.weeklyNutrients.deleteMany({ where: { userId: uid } }).catch(() => null);
  await prisma.macroNutrientsTracker.deleteMany({ where: { userId: uid } });
  await prisma.weightTracker.deleteMany({ where: { userId: uid } });
  await prisma.bloodPressureTracker.deleteMany({ where: { userId: uid } });
  await prisma.glucoseTracker.deleteMany({ where: { userId: uid } });
  const summary = await prisma.patientSummary.findUnique({ where: { patientId: uid }, select: { id: true } });
  if (summary) {
    await prisma.conditionSummary.deleteMany({ where: { patientSummaryId: summary.id } });
    await prisma.medicationSummary.deleteMany({ where: { patientSummaryId: summary.id } });
    await prisma.allergySummary.deleteMany({ where: { patientSummaryId: summary.id } });
    await prisma.vitalsSummary.deleteMany({ where: { patientSummaryId: summary.id } });
    await prisma.exerciseSummary.deleteMany({ where: { patientSummaryId: summary.id } });
    await prisma.nutritionSummary.deleteMany({ where: { patientSummaryId: summary.id } });
    await prisma.labResultSummary.deleteMany({ where: { patientSummaryId: summary.id } });
    await prisma.patientSummary.delete({ where: { id: summary.id } });
  }
  await prisma.patient.delete({ where: { id: uid } }); // cascades plan, agent tables
}
