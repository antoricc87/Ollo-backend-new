import { z } from "zod";
import InsuranceService from "../../insurance/model/insurance.model";
import { SERVICE_KEYS } from "../../insurance/domain/benefits";
import { defineTool } from "./registry";

/**
 * What the member's own plan documents say, and an out-of-pocket estimate
 * from them. There is no payer connection: nothing here is verified with the
 * insurer. The arithmetic and the caveat are code-built
 * (insurance/domain/benefits.ts); the model only relays them.
 */
export const getInsurance = defineTool({
  name: "get_insurance",
  description:
    "The user's own health plan as THEY put it in the app (insurance card + the plan's Summary of Benefits): insurer, plan type, deductible, out-of-pocket limit and what the summary lists per kind of service. Pass `service` for an out-of-pocket estimate of one kind of service (add `priceUsd` when they know the provider's price). Use for 'what's my copay', 'what's my deductible', 'what would an MRI / a specialist / urgent care cost me'. It cannot say whether a specific doctor is in network, whether a specific procedure will be approved, or what a provider charges.",
  schema: z.object({
    service: z.enum(SERVICE_KEYS).optional().describe("The kind of service to estimate, as the plan summary groups them."),
    network: z.enum(["in_network", "out_of_network"]).optional().describe("Default in_network. Only out_of_network when they say the provider is outside the network."),
    priceUsd: z.number().min(1).optional().describe("The provider's price for it, ONLY when the user stated one. Never a typical or guessed price."),
  }),
  risk: "read",
  async run(ctx, input) {
    const plan = await InsuranceService.get(ctx.patientId, ctx.today);
    if (!plan) return { result: { onFile: false, note: "No insurance on file. They can add their card and their plan's Summary of Benefits under You → Insurance. Say that in one line; do not guess at their plan." } };
    const base = { onFile: true, insurer: plan.provider, planType: plan.planType, planName: plan.planName, memberIdOnFile: !!plan.memberId, memberServicesPhone: plan.payerPhone };
    if (!plan.benefits)
      return { result: { ...base, summaryOnFile: false, note: "Only the card is on file — no benefits summary, so no deductible, copay or cost figures. They can upload the plan's Summary of Benefits and Coverage (a PDF every plan provides) under You → Insurance. Never state typical amounts in its place." } };

    const est = input.service
      ? await InsuranceService.estimateFor(ctx.patientId, { service: input.service, network: input.network, priceUsd: input.priceUsd ?? null }, ctx.today)
      : null;
    const b = plan.benefits;
    return {
      result: {
        ...base,
        summaryOnFile: true,
        planYear: b.period,
        summaryIsFromAPastPlanYear: b.expired,
        deductible: b.deductible,
        outOfPocketLimit: b.outOfPocketMax,
        deductiblePaidSoFar: plan.deductiblePaidUsd === null ? "not entered" : { usd: plan.deductiblePaidUsd, enteredOn: plan.deductiblePaidAt?.toISOString().slice(0, 10) },
        referralRequired: b.referralRequired,
        ...(input.service ? { estimate: est?.estimate ?? "The summary on file has no usable row for this service." } : { services: b.services }),
        caveat: plan.caveat,
        note:
          "These are the words of their plan's summary as they uploaded it, not a confirmation from the insurer. Say 'your plan's summary lists…', never 'you are covered' or 'you will pay'. Give dollars only when `estimate` carries them, with what the range stands on; when lowUsd is null give the rule and say a dollar figure needs the provider's price. Close with the caveat in one sentence and, for anything costly or uncertain, the member services number on their card." +
          (b.expired ? " The summary's plan year has ended — say the numbers may have changed and suggest uploading this year's." : ""),
      },
    };
  },
});
