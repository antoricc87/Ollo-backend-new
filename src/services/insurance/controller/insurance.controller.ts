import { Response } from "express";
import type { UploadedFile } from "express-fileupload";
import { z } from "zod";
import Util from "../../../utils/response";
import InsuranceService, { NotABenefitsSummary } from "../model/insurance.model";
import { SERVICE_KEYS, type EstimateInput } from "../domain/benefits";
import { extractCard } from "../extract/extractCard";

const text = (max: number) => z.string().trim().min(1).max(max);
const optional = (max: number) => z.string().trim().max(max).nullable().transform((s) => (s ? s : null));

const CardBody = z
  .object({
    provider: text(80),
    planType: text(80),
    planName: optional(120),
    memberId: optional(60),
    groupNumber: optional(60),
    payerPhone: optional(40),
    rxBin: optional(20),
    rxPcn: optional(20),
    rxGroup: optional(30),
    deductiblePaidUsd: z.number().min(0).max(1_000_000).nullable(),
    aiReadConsent: z.boolean(),
  })
  .partial();

const EstimateBody = z.object({
  service: z.enum(SERVICE_KEYS),
  network: z.enum(["in_network", "out_of_network"]).optional(),
  priceUsd: z.number().positive().max(10_000_000).nullable().optional(),
  deductiblePaidUsd: z.number().min(0).nullable().optional(),
});

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]);
const MAX_CARD_BYTES = 12 * 1024 * 1024;
const MAX_PDF_BYTES = 25 * 1024 * 1024;
const today = () => new Date().toISOString().slice(0, 10);
/**
 * A card photo or a plan summary is read by a third-party AI model. The app
 * asks first and sends `consent=true`; without it nothing leaves the server.
 */
const consented = (request: any) => String(request.body?.consent) === "true";
const noConsent = (response: Response) => response.status(422).json(Util.error({ code: "consent_required" }, "Consent to read this document is required"));
const one = (f: unknown): UploadedFile | null => (Array.isArray(f) ? f[0] : (f as UploadedFile)) ?? null;

/** Patient identity always comes from the verified token — never from the body. */
class InsuranceHandler {
  async fetch(request: any, response: Response) {
    try {
      return response.status(200).json(Util.success(await InsuranceService.get(request.user.id, today()), "Insurance"));
    } catch (error) {
      console.error("Error reading insurance", error);
      return response.status(400).json(Util.error({}, "Error reading insurance"));
    }
  }

  async save(request: any, response: Response) {
    const body = CardBody.safeParse(request.body ?? {});
    if (!body.success) return response.status(400).json(Util.error({ issues: body.error.issues }, "Invalid insurance details"));
    try {
      return response.status(200).json(Util.success(await InsuranceService.saveCard(request.user.id, body.data, today()), "Insurance saved"));
    } catch (error) {
      console.error("Error saving insurance", error);
      return response.status(400).json(Util.error({}, "Error saving insurance"));
    }
  }

  /** Read a card photo (`front`, optional `back`). Returns the fields for the member to check; saves nothing. */
  async readCard(request: any, response: Response) {
    if (!consented(request)) return noConsent(response);
    const images = [one(request.files?.front), one(request.files?.back)].filter((f): f is UploadedFile => !!f);
    if (!images.length) return response.status(400).json(Util.error({}, "No photo uploaded"));
    if (images.some((f) => !IMAGE_TYPES.has(f.mimetype) || f.size > MAX_CARD_BYTES))
      return response.status(400).json(Util.error({}, "The photo must be a JPEG or PNG under 12 MB"));
    try {
      const card = await extractCard(images.map((f) => ({ data: f.data, mimeType: f.mimetype })));
      if (!card.isInsuranceCard) return response.status(422).json(Util.error({ code: "not_a_card" }, "That does not look like an insurance card"));
      return response.status(200).json(Util.success(card, "Card read"));
    } catch (error) {
      console.error("Error reading insurance card", error);
      return response.status(400).json(Util.error({}, "The card could not be read"));
    }
  }

  /** Upload the plan's Summary of Benefits and Coverage (PDF, field `file`). */
  async uploadBenefits(request: any, response: Response) {
    if (!consented(request)) return noConsent(response);
    const file = one(request.files?.file);
    if (!file) return response.status(400).json(Util.error({}, "No file uploaded"));
    if (file.mimetype !== "application/pdf" || file.size > MAX_PDF_BYTES) return response.status(400).json(Util.error({}, "The summary must be a PDF under 25 MB"));
    try {
      return response.status(200).json(Util.success(await InsuranceService.saveBenefits(request.user.id, file.data, file.name, today()), "Benefits saved"));
    } catch (error) {
      if (error instanceof NotABenefitsSummary) return response.status(422).json(Util.error({ code: "not_a_summary" }, error.message));
      console.error("Error reading benefits summary", error);
      return response.status(400).json(Util.error({}, "The summary could not be read"));
    }
  }

  async removeBenefits(request: any, response: Response) {
    try {
      return response.status(200).json(Util.success(await InsuranceService.removeBenefits(request.user.id, today()), "Benefits removed"));
    } catch (error) {
      console.error("Error removing benefits", error);
      return response.status(400).json(Util.error({}, "Error removing benefits"));
    }
  }

  async remove(request: any, response: Response) {
    try {
      await InsuranceService.remove(request.user.id);
      return response.status(200).json(Util.success(null, "Insurance removed"));
    } catch (error) {
      console.error("Error removing insurance", error);
      return response.status(400).json(Util.error({}, "Error removing insurance"));
    }
  }

  async estimate(request: any, response: Response) {
    const body = EstimateBody.safeParse(request.body ?? {});
    if (!body.success) return response.status(400).json(Util.error({ issues: body.error.issues }, "Invalid estimate request"));
    try {
      const out = await InsuranceService.estimateFor(request.user.id, body.data as EstimateInput, today());
      if (!out) return response.status(404).json(Util.error({ code: "no_summary" }, "No benefits summary on file"));
      return response.status(200).json(Util.success(out, "Estimate"));
    } catch (error) {
      console.error("Error estimating cost", error);
      return response.status(400).json(Util.error({}, "Error estimating cost"));
    }
  }
}

export default new InsuranceHandler();
