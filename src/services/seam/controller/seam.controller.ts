import { Response } from "express";
import Util from "../../../utils/response";
import { SeamRequest } from "../seam.auth";
import { availabilityReplaceSchema, bookingStatusSchema, clinicianUpsertSchema, messageSchema } from "../seam.schema";
import SeamService, { SeamConflictError, SeamMessagingService, SeamPatientService, SeamScheduleService } from "../model/seam.model";

/** S0 wiring checks. Patient-scoped resources arrive with S2 (see docs/physician-app-plan.md). */
class SeamHandler {
  async health(_req: SeamRequest, res: Response) {
    return res.status(200).json(
      Util.success({ ok: true, service: "ollo-backend", seam: "v1", time: new Date().toISOString() }, "Seam reachable")
    );
  }

  /** Publish / refresh a clinician's directory row. Body: seam.schema clinicianUpsertSchema. */
  async upsertClinician(req: SeamRequest, res: Response) {
    const externalId = String(req.params.externalId ?? "").trim();
    if (!externalId) return res.status(400).json(Util.error({}, "externalId is required"));
    const parsed = clinicianUpsertSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(Util.error(parsed.error.flatten().fieldErrors, "Invalid clinician payload"));
    }
    try {
      const row = await SeamService.upsertClinician(externalId, parsed.data);
      return res.status(200).json(Util.success(row, "Clinician published"));
    } catch (error) {
      if (error instanceof SeamConflictError) return res.status(409).json(Util.error({}, error.message));
      console.error("seam: clinician upsert failed", error);
      return res.status(500).json(Util.error({}, "Clinician upsert failed"));
    }
  }

  /* ---- patient-scoped (requireClinician + requireGrant ran before these) ---- */

  async patients(req: SeamRequest, res: Response) {
    try {
      const rows = await SeamPatientService.patientsOf(req.seam!.clinician!.id);
      return res.status(200).json(Util.success(rows, "Patients fetched"));
    } catch (error) {
      console.error("seam: patients failed", error);
      return res.status(500).json(Util.error({}, "Patients fetch failed"));
    }
  }

  private static patientRead =
    (name: string, fn: (patientId: string, req: SeamRequest) => Promise<unknown>) => async (req: SeamRequest, res: Response) => {
      try {
        const data = await fn(req.seam!.patientId!, req);
        if (data === null) return res.status(404).json(Util.error({}, "Patient not found"));
        return res.status(200).json(Util.success(data, `${name} fetched`));
      } catch (error) {
        if (/not found/i.test((error as Error)?.message ?? "")) return res.status(404).json(Util.error({}, "Patient not found"));
        console.error(`seam: ${name} failed`, error);
        return res.status(500).json(Util.error({}, `${name} fetch failed`));
      }
    };

  snapshot = SeamHandler.patientRead("Snapshot", (id) => SeamPatientService.snapshot(id));
  labsCurrent = SeamHandler.patientRead("Current labs", (id) => SeamPatientService.labsCurrent(id));
  labsRisk = SeamHandler.patientRead("Risk report", (id) => SeamPatientService.risk(id));
  plan = SeamHandler.patientRead("Plan", (id) => SeamPatientService.plan(id).then((p) => p ?? { active: null }));
  trackers = SeamHandler.patientRead("Trackers", (id, req) => {
    const days = Math.min(365, Math.max(1, parseInt(String(req.query.days ?? "90"), 10) || 90));
    return SeamPatientService.trackers(id, days);
  });

  /* ---- S4: schedule & bookings (requireClinician ran; :externalId must be the caller) ---- */

  private static own(req: SeamRequest, res: Response) {
    const c = req.seam!.clinician!;
    if (String(req.params.externalId ?? c.externalId) !== c.externalId) {
      res.status(403).json(Util.error({}, "externalId does not match the clinician header"));
      return null;
    }
    return c;
  }

  async replaceAvailability(req: SeamRequest, res: Response) {
    const c = SeamHandler.own(req, res);
    if (!c) return;
    const parsed = availabilityReplaceSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(Util.error(parsed.error.flatten().fieldErrors, "Invalid availability payload"));
    try {
      const r = await SeamScheduleService.replaceAvailability(c.id, parsed.data);
      return res.status(200).json(Util.success(r, "Availability published"));
    } catch (error) {
      console.error("seam: availability replace failed", error);
      return res.status(500).json(Util.error({}, "Availability publish failed"));
    }
  }

  async bookings(req: SeamRequest, res: Response) {
    const c = SeamHandler.own(req, res);
    if (!c) return;
    try {
      const status = req.query.status ? String(req.query.status) : undefined;
      return res.status(200).json(Util.success(await SeamScheduleService.bookingsOf(c.id, status), "Bookings fetched"));
    } catch (error) {
      console.error("seam: bookings failed", error);
      return res.status(500).json(Util.error({}, "Bookings fetch failed"));
    }
  }

  async bookingStatus(req: SeamRequest, res: Response) {
    const c = req.seam!.clinician!;
    const parsed = bookingStatusSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(Util.error(parsed.error.flatten().fieldErrors, "Invalid status payload"));
    try {
      const b = await SeamScheduleService.setBookingStatus(c.id, String(req.params.id), parsed.data.status, parsed.data.note);
      if (!b) return res.status(404).json(Util.error({}, "Booking not found"));
      return res.status(200).json(Util.success(b, "Booking updated"));
    } catch (error) {
      console.error("seam: booking status failed", error);
      return res.status(500).json(Util.error({}, "Booking update failed"));
    }
  }

  /* ---- S5: messaging ---- */

  async chats(req: SeamRequest, res: Response) {
    const c = SeamHandler.own(req, res);
    if (!c) return;
    try {
      return res.status(200).json(Util.success(await SeamMessagingService.chatsOf(c.id), "Chats fetched"));
    } catch (error) {
      console.error("seam: chats failed", error);
      return res.status(500).json(Util.error({}, "Chats fetch failed"));
    }
  }

  async chat(req: SeamRequest, res: Response) {
    try {
      const chat = await SeamMessagingService.chat(req.seam!.clinician!.id, String(req.params.id));
      if (!chat) return res.status(404).json(Util.error({}, "Chat not found"));
      return res.status(200).json(Util.success(chat, "Chat fetched"));
    } catch (error) {
      console.error("seam: chat failed", error);
      return res.status(500).json(Util.error({}, "Chat fetch failed"));
    }
  }

  /** Patient-scoped (requireGrant ran): open or reuse the thread with this patient. */
  async startChat(req: SeamRequest, res: Response) {
    try {
      return res.status(201).json(Util.success(await SeamMessagingService.start(req.seam!.clinician!.id, req.seam!.patientId!), "Chat ready"));
    } catch (error) {
      console.error("seam: start chat failed", error);
      return res.status(500).json(Util.error({}, "Chat start failed"));
    }
  }

  async sendMessage(req: SeamRequest, res: Response) {
    const parsed = messageSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(Util.error(parsed.error.flatten().fieldErrors, "Invalid message"));
    try {
      const m = await SeamMessagingService.send(req.seam!.clinician!.id, String(req.params.id), parsed.data.content);
      if (!m) return res.status(404).json(Util.error({}, "Chat not found"));
      return res.status(201).json(Util.success(m, "Message sent"));
    } catch (error) {
      console.error("seam: send failed", error);
      return res.status(500).json(Util.error({}, "Message send failed"));
    }
  }

  /** Key + clinician header both valid → the directory row the seam resolved. */
  async whoami(req: SeamRequest, res: Response) {
    return res.status(200).json(Util.success({ clinician: req.seam?.clinician }, "Clinician resolved"));
  }
}

export default new SeamHandler();
