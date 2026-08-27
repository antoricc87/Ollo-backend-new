import { LabJourneyStatus, LabRoute } from "@prisma/client";
import prisma from "../../../utility/prismaClient";
import { getPatientById } from "../../patient/model/patient.model";
import { buildPanel } from "../domain/screening.rules";
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
};

export type JourneyView = {
  id: string;
  route: LabRoute;
  status: LabJourneyStatus;
  bookingId: string | null;
  orderedAt: string | null;
  resultedAt: string | null;
  createdAt: string;
};

const toView = (j: any): JourneyView => ({
  id: j.id,
  route: j.route,
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
    return {
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
  static async startJourney(patientId: string, route: LabRoute): Promise<JourneyView> {
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
