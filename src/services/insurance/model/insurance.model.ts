import { Prisma } from "@prisma/client";
import prisma from "../../../utility/prismaClient";
import { ESTIMATE_CAVEAT, estimate, headline, isExpired, type EstimateInput, type StoredBenefits } from "../domain/benefits";
import { extractBenefits } from "../extract/extractBenefits";

/**
 * INSURANCE — the member's own record of their plan: the card (typed in or
 * read off a photo) and the plan's Summary of Benefits, extracted. There is no
 * payer connection: nothing here is verified with the insurer, and every
 * figure shown from it is labelled as coming from the member's documents.
 * Patient identity always comes from the token.
 */

/** PPO / EPO and paying yourself = any in-network doctor; the rest expect an assigned primary care doctor. */
export const allowsAnyPcpFor = (planType: string): boolean => /PPO|EPO|OUT OF POCKET|SELF/.test(planType.toUpperCase());

export class NotABenefitsSummary extends Error {
  constructor() {
    super("That file is not a plan benefits summary");
  }
}

export type CardInput = {
  provider?: string;
  planType?: string;
  planName?: string | null;
  memberId?: string | null;
  groupNumber?: string | null;
  payerPhone?: string | null;
  rxBin?: string | null;
  rxPcn?: string | null;
  rxGroup?: string | null;
  deductiblePaidUsd?: number | null;
  /** The member agreed to the card photo being read by the AI provider (the card-read step). */
  aiReadConsent?: boolean;
};

const UNKNOWN = "Not sure";
const benefitsOf = (row: { benefits: Prisma.JsonValue | null }) => (row.benefits as unknown as StoredBenefits | null) ?? null;

const toView = (row: NonNullable<Awaited<ReturnType<typeof prisma.patientInsurance.findUnique>>>, today: string) => {
  const b = benefitsOf(row);
  return {
    provider: row.insuranceProvider,
    planType: row.planType,
    planName: row.fullPlanName,
    allowsAnyPCP: row.allowsAnyPCP,
    memberId: row.memberId,
    groupNumber: row.groupNumber,
    payerPhone: row.payerPhone,
    rx: row.rxBin || row.rxPcn || row.rxGroup ? { bin: row.rxBin, pcn: row.rxPcn, group: row.rxGroup } : null,
    benefits: b
      ? { ...headline(b), fileName: row.benefitsFileName, updatedAt: row.benefitsUpdatedAt, expired: isExpired(b, today), scanned: b.source.engine === "scan" }
      : null,
    deductiblePaidUsd: row.deductiblePaidUsd,
    deductiblePaidAt: row.deductiblePaidAt,
    caveat: ESTIMATE_CAVEAT,
  };
};
export type InsuranceView = ReturnType<typeof toView>;

export default class InsuranceService {
  static async get(patientId: string, today: string): Promise<InsuranceView | null> {
    const row = await prisma.patientInsurance.findUnique({ where: { patientId } });
    return row ? toView(row, today) : null;
  }

  /** Save what is on the card. Only the fields passed change; `null` clears one. */
  static async saveCard(patientId: string, input: CardInput, today: string): Promise<InsuranceView> {
    const data: Prisma.PatientInsuranceUncheckedUpdateInput = {};
    if (input.provider !== undefined) data.insuranceProvider = input.provider;
    if (input.planType !== undefined) {
      data.planType = input.planType;
      data.allowsAnyPCP = allowsAnyPcpFor(input.planType);
    }
    if (input.planName !== undefined) data.fullPlanName = input.planName;
    for (const k of ["memberId", "groupNumber", "payerPhone", "rxBin", "rxPcn", "rxGroup"] as const) if (input[k] !== undefined) data[k] = input[k];
    if (input.deductiblePaidUsd !== undefined) {
      data.deductiblePaidUsd = input.deductiblePaidUsd;
      data.deductiblePaidAt = input.deductiblePaidUsd === null ? null : new Date();
    }
    if (input.aiReadConsent) data.aiReadConsentAt = new Date();
    const planType = input.planType ?? UNKNOWN;
    const row = await prisma.patientInsurance.upsert({
      where: { patientId },
      update: data,
      create: {
        patientId,
        insuranceProvider: input.provider ?? UNKNOWN,
        planType,
        allowsAnyPCP: allowsAnyPcpFor(planType),
        fullPlanName: input.planName ?? null,
        memberId: input.memberId ?? null,
        groupNumber: input.groupNumber ?? null,
        payerPhone: input.payerPhone ?? null,
        rxBin: input.rxBin ?? null,
        rxPcn: input.rxPcn ?? null,
        rxGroup: input.rxGroup ?? null,
        deductiblePaidUsd: input.deductiblePaidUsd ?? null,
        deductiblePaidAt: input.deductiblePaidUsd != null ? new Date() : null,
        aiReadConsentAt: input.aiReadConsent ? new Date() : null,
      },
    });
    return toView(row, today);
  }

  /**
   * Read a Summary of Benefits PDF and store what it says. The summary names
   * the plan, so it fills the insurer / plan type the member left as "Not
   * sure" — it never overwrites what they chose. The PDF itself is not kept.
   */
  static async saveBenefits(patientId: string, file: Buffer, fileName: string, today: string): Promise<InsuranceView> {
    const { benefits } = await extractBenefits(file);
    if (!benefits.isBenefitsSummary || (!benefits.services.length && benefits.deductible.inNetwork.individualUsd === null)) throw new NotABenefitsSummary();
    const existing = await prisma.patientInsurance.findUnique({ where: { patientId } });
    const unknown = (s?: string | null) => !s || s === UNKNOWN;
    const provider = unknown(existing?.insuranceProvider) ? benefits.issuer ?? UNKNOWN : existing!.insuranceProvider;
    const planType = unknown(existing?.planType) && benefits.planType && benefits.planType !== "OTHER" ? benefits.planType : existing?.planType ?? UNKNOWN;
    const data = {
      insuranceProvider: provider,
      planType,
      allowsAnyPCP: allowsAnyPcpFor(planType),
      fullPlanName: existing?.fullPlanName ?? benefits.planName,
      benefits: benefits as unknown as Prisma.InputJsonValue,
      benefitsFileName: fileName.slice(0, 120),
      benefitsUpdatedAt: new Date(),
      aiReadConsentAt: new Date(),
    };
    const row = await prisma.patientInsurance.upsert({ where: { patientId }, update: data, create: { patientId, ...data } });
    return toView(row, today);
  }

  static async removeBenefits(patientId: string, today: string): Promise<InsuranceView | null> {
    const existing = await prisma.patientInsurance.findUnique({ where: { patientId } });
    if (!existing) return null;
    const row = await prisma.patientInsurance.update({
      where: { patientId },
      data: { benefits: Prisma.JsonNull, benefitsFileName: null, benefitsUpdatedAt: null, deductiblePaidUsd: null, deductiblePaidAt: null },
    });
    return toView(row, today);
  }

  /** Forget everything about the member's insurance. */
  static async remove(patientId: string): Promise<void> {
    await prisma.patientInsurance.deleteMany({ where: { patientId } });
  }

  /**
   * What one kind of service would cost under the stored summary. `null` when
   * there is no summary; `estimate: null` when the summary has no usable row.
   * The deductible already paid defaults to what the member entered.
   */
  static async estimateFor(patientId: string, input: EstimateInput, today: string) {
    const row = await prisma.patientInsurance.findUnique({ where: { patientId } });
    const b = row ? benefitsOf(row) : null;
    if (!row || !b) return null;
    const paid = input.deductiblePaidUsd !== undefined ? input.deductiblePaidUsd : row.deductiblePaidUsd;
    return {
      plan: b.planName ?? row.fullPlanName ?? row.insuranceProvider,
      period: b.periodStart || b.periodEnd ? { start: b.periodStart, end: b.periodEnd } : null,
      expired: isExpired(b, today),
      estimate: estimate(b, { ...input, deductiblePaidUsd: paid }),
      caveat: ESTIMATE_CAVEAT,
    };
  }
}
