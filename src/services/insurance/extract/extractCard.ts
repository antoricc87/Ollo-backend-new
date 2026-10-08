/**
 * Insurance card photo → the fields printed on it. The model only copies; the
 * result goes back to the app for the member to check and save. The photo is
 * sent to the model and then dropped — it is never written to disk or the DB.
 */
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { modelRequestParams } from "../../meal_analysis/mealAnalysis.service";
import { getClient, INSURANCE_MODEL } from "./extractBenefits";

export const CardSchema = z.object({
  isInsuranceCard: z.boolean(),
  insurer: z.string().nullable(),
  planName: z.string().nullable(),
  planType: z.enum(["PPO", "HMO", "EPO", "POS", "HDHP", "OTHER"]).nullable(),
  memberId: z.string().nullable(),
  groupNumber: z.string().nullable(),
  payerPhone: z.string().nullable(),
  rxBin: z.string().nullable(),
  rxPcn: z.string().nullable(),
  rxGroup: z.string().nullable(),
});
export type CardFields = z.infer<typeof CardSchema>;

const CARD_PROMPT = `You read a photo of a US health insurance member card and copy the fields printed on it. Copy characters exactly (member ids mix letters and digits; do not correct or pad them). A field that is not printed, or that you cannot read with confidence, is null — never guess.
- isInsuranceCard: false for anything that is not a health insurance member card; then every other field is null.
- insurer: the insurance company as printed (e.g. "Aetna", "Blue Cross Blue Shield of Texas").
- planName: the plan or network name as printed. planType only when the card states it (PPO, HMO, EPO, POS, HDHP), else null.
- memberId: the member / subscriber / ID number, including any letter prefix. groupNumber: the group number.
- payerPhone: the member services phone number.
- rxBin, rxPcn, rxGroup: the pharmacy fields, when printed.`;

export type CardImage = { data: Buffer; mimeType: string };

/** One or two photos (front, back) of the same card. */
export const extractCard = async (images: CardImage[], opts: { model?: string } = {}): Promise<CardFields> => {
  const model = opts.model || INSURANCE_MODEL;
  const r = await getClient().responses.parse({
    model,
    ...(modelRequestParams(model) as any),
    input: [
      { role: "system", content: CARD_PROMPT },
      {
        role: "user",
        content: [
          { type: "input_text", text: images.length > 1 ? "Images of one card (front, back, or pages of its PDF)." : "One image of the card." },
          ...images.map((i) => ({ type: "input_image", image_url: `data:${i.mimeType};base64,${i.data.toString("base64")}`, detail: "high" })),
        ] as any,
      },
    ],
    text: { format: zodTextFormat(CardSchema, "insurance_card") },
  });
  const parsed = r.output_parsed as CardFields | null;
  if (!parsed) throw new Error("The card could not be read");
  // The model sometimes writes the word instead of leaving the field empty ("null" came back as a string on a non-card).
  const clean = (s: string | null) => (s && s.trim() && !/^(null|none|n\/?a|unknown|not (printed|shown|available))$/i.test(s.trim()) ? s.trim().slice(0, 80) : null);
  return {
    ...parsed,
    insurer: clean(parsed.insurer),
    planName: clean(parsed.planName),
    memberId: clean(parsed.memberId),
    groupNumber: clean(parsed.groupNumber),
    payerPhone: clean(parsed.payerPhone),
    rxBin: clean(parsed.rxBin),
    rxPcn: clean(parsed.rxPcn),
    rxGroup: clean(parsed.rxGroup),
  };
};
