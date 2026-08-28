import { LabJourneyReason, LabJourneyStatus, LabRoute } from "@prisma/client";
import prisma from "../../../utility/prismaClient";
import { getPatientById } from "../../patient/model/patient.model";
import { buildPanel } from "../domain/screening.rules";
import { buildRiskReport, RiskProfile, RiskReport } from "../domain/risk";
import { buildCurrentLabs } from "../../../utils/labBiomarkers";
import { calculateAgeFromDob } from "../../../utils/calculateAgefromDob";
import {
  applyCoverage,
  buildScreeningProfile,
  checklistText,
  PanelItemView,
} from "../domain/profile";

/**
 * Labs journey — how a patient gets labs done. The panel is guideline-based
 * and recomputed on every read; a journey row records the chosen route and
 * where it got to (RECOMMENDED → ORDERED → RESULTED). A new lab upload
 * resolves the open journey.
 */

const ACTIVE: LabJourneyStatus[] = ["RECOMMENDED", "ORDERED"];

export type PanelResponse = {
  profile: {
    age: number | null;
    sex: string | null;
    bmi: number | null;
    smoking: string | null;
    hasFamilyHistory: boolean;
    family: Record<string, boolean>;
  };
  items: PanelItemView[];
  counts: { due: number; consider: number; covered: number };
  checklistText: string;
  journey: JourneyView | null;
  /** Annual physical (Set 04): what the patient told us and when the next one is due. */
  physical: {
    status: "within_year" | "over_year" | "never" | null;
    lastAt: string | null;
    nextDueAt: string | null;
    overdue: boolean;
  };
  insurance: { provider: string; planType: string; allowsAnyPCP: boolean } | null;
};

export type JourneyView = {
  id: string;
  route: LabRoute;
  reason: LabJourneyReason;
  status: LabJourneyStatus;
  bookingId: string | null;
  orderedAt: string | null;
  resultedAt: string | null;
  createdAt: string;
};

const toView = (j: any): JourneyView => ({
  id: j.id,
  route: j.route,
  reason: j.reason ?? "LABS_ONLY",
  status: j.status,
  bookingId: j.bookingId ?? null,
  orderedAt: j.orderedAt ? new Date(j.orderedAt).toISOString() : null,
  resultedAt: j.resultedAt ? new Date(j.resultedAt).toISOString() : null,
  createdAt: new Date(j.createdAt).toISOString(),
});

class LabsJourneyService {
  static async activeJourney(patientId: string) {
    return prisma.labJourney.findFirst({
      where: { patientId, status: { in: ACTIVE } },
      orderBy: { createdAt: "desc" },
    });
  }

  static async getPanel(patientId: string): Promise<PanelResponse> {
    const patient = await getPatientById(patientId);
    if (!patient) throw new Error("Patient not found");
    const profile = buildScreeningProfile(patient);
    const items = applyCoverage(buildPanel(profile), patient.patientSummary?.labResults ?? []);
    const fh = patient.patientSummary?.familyHistory;
    const hasFamilyHistory = Boolean(
      fh &&
        ((fh.historyOfCancer?.length ?? 0) > 0 ||
          (fh.historyOfChronicConditions?.length ?? 0) > 0 ||
          fh.historyOfHeartAttack ||
          fh.historyOfHighCholesterol ||
          (fh.historyOfHereditaryConditions?.length ?? 0) > 0)
    );
    const journey = await LabsJourneyService.activeJourney(patientId);
    const lastAt: Date | null = patient.lastPhysicalAt ?? null;
    const nextDue = lastAt ? new Date(new Date(lastAt).setFullYear(new Date(lastAt).getFullYear() + 1)) : null;
    const ins = patient.insurance ?? null;
    return {
      physical: {
        status: (patient.lastPhysicalStatus as any) ?? null,
        lastAt: lastAt ? new Date(lastAt).toISOString() : null,
        nextDueAt: nextDue ? nextDue.toISOString() : null,
        overdue: patient.lastPhysicalStatus === "over_year" || patient.lastPhysicalStatus === "never" || (nextDue ? nextDue.getTime() < Date.now() : false),
      },
      insurance: ins ? { provider: ins.insuranceProvider, planType: ins.planType, allowsAnyPCP: ins.allowsAnyPCP } : null,
      profile: {
        age: profile.age,
        sex: profile.sex,
        bmi: profile.bmi ? Math.round(profile.bmi * 10) / 10 : null,
        smoking: profile.smoking,
        hasFamilyHistory,
        family: profile.family,
      },
      items,
      counts: {
        due: items.filter((i) => i.priority === "DUE" && !i.covered).length,
        consider: items.filter((i) => i.priority !== "DUE" && !i.covered).length,
        covered: items.filter((i) => i.covered).length,
      },
      checklistText: checklistText(items, patient.firstName),
      journey: journey ? toView(journey) : null,
    };
  }

  static async getJourney(patientId: string): Promise<JourneyView | null> {
    const j = await LabsJourneyService.activeJourney(patientId);
    return j ? toView(j) : null;
  }

  /** Pick (or switch) a route. Any open journey is cancelled first. */
  static async startJourney(
    patientId: string,
    route: LabRoute,
    reason: LabJourneyReason = "LABS_ONLY"
  ): Promise<JourneyView> {
    const panel = await LabsJourneyService.getPanel(patientId);
    const row = await prisma.$transaction(async (tx) => {
      await tx.labJourney.updateMany({
        where: { patientId, status: { in: ACTIVE } },
        data: { status: "CANCELLED" },
      });
      return tx.labJourney.create({
        data: {
          patientId,
          route,
          reason,
          status: "RECOMMENDED",
          panel: panel.items as any,
        },
      });
    });
    return toView(row);
  }

  /**
   * Advance the open journey. `bookingId` marks it ORDERED through an Ollo
   * doctor and writes the checklist into the booking notes so the doctor
   * sees the suggested panel; `status` handles the other transitions.
   */
  static async updateJourney(
    patientId: string,
    input: { status?: LabJourneyStatus; bookingId?: string }
  ): Promise<JourneyView> {
    const j = await LabsJourneyService.activeJourney(patientId);
    if (!j) throw new Error("No open labs journey");
    const data: any = {};

    if (input.bookingId) {
      const booking = await prisma.booking.findFirst({
        where: { id: input.bookingId, patientId },
      });
      if (!booking) throw new Error("Booking not found");
      data.bookingId = booking.id;
      data.status = "ORDERED";
      data.orderedAt = j.orderedAt ?? new Date();
      if (!booking.notes) {
        const panel = await LabsJourneyService.getPanel(patientId);
        await prisma.booking.update({
          where: { id: booking.id },
          data: { notes: `Suggested panel (Ollo, guideline-based):\n${panel.checklistText}` },
        });
      }
    }

    if (input.status) {
      if (!["ORDERED", "RESULTED", "CANCELLED", "RECOMMENDED"].includes(input.status))
        throw new Error("Invalid status");
      data.status = input.status;
      if (input.status === "ORDERED" && !j.orderedAt) data.orderedAt = new Date();
      if (input.status === "RESULTED" && !j.resultedAt) data.resultedAt = new Date();
    }

    const row = await prisma.labJourney.update({ where: { id: j.id }, data });
    return toView(row);
  }

  /**
   * Insurance for the booking branch. Plan type decides whether the patient can
   * book any in-network doctor (PPO/EPO, out of pocket) or needs their
   * insurer-assigned PCP (HMO/POS/Medicare Advantage HMO).
   */
  static async setInsurance(
    patientId: string,
    input: { provider: string; planType: string }
  ) {
    const plan = input.planType.toUpperCase();
    const allowsAnyPCP = /PPO|EPO|OUT OF POCKET|SELF/.test(plan);
    const row = await prisma.patientInsurance.upsert({
      where: { patientId },
      update: { insuranceProvider: input.provider, planType: input.planType, allowsAnyPCP },
      create: { patientId, insuranceProvider: input.provider, planType: input.planType, allowsAnyPCP },
    });
    return { provider: row.insuranceProvider, planType: row.planType, allowsAnyPCP: row.allowsAnyPCP };
  }

  /**
   * Risk & biological age from the merged current labs (revived post-visit
   * report). Blood pressure: latest tracker reading, else the profile's
   * sBp/dBp, else 120/80 flagged as assumed.
   */
  static async getRisk(patientId: string): Promise<RiskReport> {
    const patient = await getPatientById(patientId);
    if (!patient) throw new Error("Patient not found");
    const summary: any = patient.patientSummary ?? {};
    const vitals = summary.vitals ?? {};
    const sexRaw = String(patient.gender ?? "").toLowerCase();
    const sex = sexRaw.startsWith("m") ? "M" : sexRaw.startsWith("f") ? "F" : null;

    const h = Number(vitals.height) || null;
    const w = Number(vitals.weight) || null;
    const heightCm = h ? (/imperial|in/.test(String(vitals.height_unit ?? "").toLowerCase()) ? h * 2.54 : h) : null;
    const weightKg = w ? (String(vitals.weight_unit ?? "").toLowerCase() === "lbs" ? w * 0.4536 : w) : null;

    const latestBp = await prisma.bloodPressureEntry.findFirst({
      where: { dailyTracker: { userId: patientId } },
      orderBy: { createdAt: "desc" },
    });
    const bloodPressure: RiskProfile["bloodPressure"] = latestBp
      ? { systolic: latestBp.systolic, diastolic: latestBp.diastolic, source: "tracker", at: latestBp.createdAt }
      : vitals.sBp && vitals.dBp
      ? { systolic: vitals.sBp, diastolic: vitals.dBp, source: "profile", at: null }
      : { systolic: 120, diastolic: 80, source: "assumed", at: null };

    const conditions: string[] = (summary.conditions ?? []).map((c: any) => String(c?.condition?.name ?? "").toLowerCase());
    const medications: string[] = (summary.medications ?? []).map((m: any) => String(m?.medication?.name ?? "").toLowerCase());
    const habit = String(vitals.smokingHabit ?? "").toLowerCase();
    const smoker = habit ? /daily|occasion/.test(habit) : vitals.isSmoker === true;
    const chronic: string[] = (summary.familyHistory?.historyOfChronicConditions ?? []).map((x: any) => String(x).toLowerCase());

    const profile: RiskProfile = {
      age: patient.dob ? calculateAgeFromDob(patient.dob) : null,
      sex,
      heightCm,
      weightKg,
      smoker,
      diabetic: conditions.some((c) => /diabet/.test(c) && !/prediabet/.test(c)),
      parentalDiabetes: chronic.some((c) => c.includes("diabet")),
      onBloodPressureTreatment: medications.some((m) =>
        /lisinopril|losartan|amlodipine|valsartan|ramipril|enalapril|metoprolol|atenolol|hydrochlorothiazide|olmesartan|candesartan|irbesartan|telmisartan|diltiazem|nifedipine|bisoprolol|carvedilol/.test(m)
      ),
      bloodPressure,
    };
    const labs = buildCurrentLabs(summary.labResults ?? []);
    return buildRiskReport(profile, labs);
  }

  /** Called after a lab report is saved: the open journey is done. */
  static async markResulted(patientId: string): Promise<void> {
    const j = await LabsJourneyService.activeJourney(patientId);
    if (!j) return;
    await prisma.labJourney.update({
      where: { id: j.id },
      data: { status: "RESULTED", resultedAt: new Date() },
    });
  }
}

export default LabsJourneyService;
