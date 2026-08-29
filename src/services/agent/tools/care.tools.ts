import { z } from "zod";
import prisma from "../../../utility/prismaClient";
import ClinicianService from "../../clinicians/model/clinicians.model";
import { defineTool } from "./registry";

export const getCareTeam = defineTool({
  name: "get_care_team",
  description:
    "The user's clinicians on Ollo (name, specialty, clinic) and their upcoming/pending appointments. Use when something should go to a doctor — offer to message or book (those actions arrive as confirmable proposals).",
  schema: z.object({}),
  risk: "read",
  async run(ctx) {
    const [clinicians, bookings] = await Promise.all([
      ClinicianService.careTeamOf(ctx.patientId),
      prisma.booking.findMany({
        where: { patientId: ctx.patientId, status: { in: ["PENDING", "CONFIRMED"] } },
        orderBy: { appointmentDate: "asc" },
        take: 10,
        select: { id: true, clinicianName: true, appointmentDate: true, durationMinutes: true, reason: true, status: true },
      }),
    ]);
    const result = {
      clinicians: clinicians.map((c) => ({ id: c.id, name: `${c.firstName} ${c.lastName}`, specialty: c.specialty, clinic: c.clinicName })),
      appointments: bookings,
    };
    return { result, cards: [{ type: "care_team", title: "Care team", data: result }] };
  },
});

export const listSubaccounts = defineTool({
  name: "list_subaccounts",
  description: "Family members (sub-accounts) this user manages, with ids to pass as subjectId to other tools.",
  schema: z.object({}),
  risk: "read",
  async run(ctx) {
    const rows = await prisma.patient.findMany({
      where: { subAccountOf: ctx.patientId },
      select: { id: true, firstName: true, lastName: true, dob: true, gender: true },
    });
    return {
      result: rows.map((r) => ({
        id: r.id,
        name: [r.firstName, r.lastName].filter(Boolean).join(" ") || "unnamed",
        dob: r.dob ? r.dob.toISOString().slice(0, 10) : null,
        gender: r.gender,
      })),
    };
  },
});
