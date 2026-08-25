import moment from "moment-timezone";
import { z } from "zod";
import prisma from "../../../utility/prismaClient";
import { analyzeMeal } from "../../meal_analysis/mealAnalysis.service";
import CaloriesService from "../../calories_tracker/model/calories.model";
import WeightService from "../../weight_tracker/model/weight.model";
import BFPService from "../../bodyFatPercentage/model/bfp.model";
import BloodPressureService from "../../bp_tracker/model/bloodpressure.model";
import GlucoseService from "../../glucose_tracker/model/glucose.model";
import MessagingService from "../../messaging/model/messaging.model";
import BookingService from "../../bookings/model/bookings.model";
import { DAY_RE, dayString, defineTool, subjectField } from "./registry";

/**
 * Confirm-gated write tools. `run` prepares a proposal (what will happen,
 * with a preview the app can show and edit); `commit` performs it through the
 * same service functions the app's own screens call, so trackers, summaries
 * and notifications stay consistent.
 */

const r1 = (n: number) => Math.round(n * 10) / 10;
const sum = (xs: (number | null | undefined)[]) => xs.reduce<number>((a, b) => a + (b ?? 0), 0);

/* ------------------------------- log_meal -------------------------------- */

const MEAL_TYPES = ["BREAKFAST", "LUNCH", "DINNER", "SNACK"] as const;

const mealPreview = (meals: any[], date: string) => ({
  date,
  meals: meals.map((m) => ({
    name: m.mealName || "Meal",
    mealType: m.mealType,
    calories: Math.round(sum(m.ingredients.map((i: any) => i.calories))),
    protein_g: r1(sum(m.ingredients.map((i: any) => i.nutrients?.proteins))),
    carbs_g: r1(sum(m.ingredients.map((i: any) => i.nutrients?.carbohydrates))),
    fat_g: r1(sum(m.ingredients.map((i: any) => i.nutrients?.fats))),
    ingredients: m.ingredients.map((i: any) => ({
      name: i.name,
      quantity: i.quantity,
      unit: i.unit,
      grams: i.grams,
      calories: Math.round(i.calories ?? 0),
      portionSource: i.portionSource ?? null,
      nutrientSource: i.nutrientSource ?? null,
    })),
  })),
});

/**
 * Portion edits from the card: `{ meals: [{ index, ingredients: [{ index, grams }] }] }`
 * — `grams: null` removes the ingredient. Calories and every numeric nutrient
 * scale linearly with grams (works for USDA- and model-sourced rows alike).
 */
const PortionEdits = z.object({
  meals: z.array(
    z.object({
      index: z.number().int().min(0),
      ingredients: z.array(z.object({ index: z.number().int().min(0), grams: z.number().min(0).max(5000).nullable() })).max(60),
    })
  ).max(10),
});

export const applyPortionEdits = (preview: any, rawEdits: unknown) => {
  const edits = PortionEdits.parse(rawEdits);
  const analysed: any[] = preview?.analysis?.meals ?? [];
  if (!analysed.length) throw new Error("preview has no analysed meals to edit");
  const meals = analysed.map((m) => ({ ...m, ingredients: m.ingredients.map((i: any) => ({ ...i })) }));
  for (const me of edits.meals) {
    const meal = meals[me.index];
    if (!meal) throw new Error(`no meal at index ${me.index}`);
    const removed = new Set<number>();
    for (const ie of me.ingredients) {
      const ing = meal.ingredients[ie.index];
      if (!ing) throw new Error(`no ingredient at index ${ie.index}`);
      if (ie.grams === null || ie.grams === 0) {
        removed.add(ie.index);
        continue;
      }
      const factor = ing.grams > 0 ? ie.grams / ing.grams : 1;
      ing.grams = ie.grams;
      ing.quantity = Math.round((ing.quantity ?? 1) * factor * 100) / 100;
      ing.calories = Math.round((ing.calories ?? 0) * factor * 10) / 10;
      ing.portionSource = "user";
      if (ing.nutrients && typeof ing.nutrients === "object")
        for (const k of Object.keys(ing.nutrients)) if (typeof ing.nutrients[k] === "number") ing.nutrients[k] = Math.round(ing.nutrients[k] * factor * 1000) / 1000;
    }
    meal.ingredients = meal.ingredients.filter((_: any, i: number) => !removed.has(i));
    if (!meal.ingredients.length) throw new Error("a meal must keep at least one ingredient");
  }
  return { ...preview, analysis: { ...preview.analysis, meals }, ...mealPreview(meals, preview.date), edited: true };
};

export const logMeal = defineTool({
  name: "log_meal",
  description:
    "Log food the user ate (their own or a family member's). Pass the meal exactly as described — foods, portions, brand names, and any time reference ('yesterday's lunch'). The tool analyses it into ingredients with calories and macros and returns a PREVIEW; the user confirms it in the app before anything is saved. Do not call it for hypothetical meals or meal ideas.",
  schema: z.object({
    description: z.string().min(3).max(1500).describe("What was eaten, verbatim from the user, incl. portions"),
    mealType: z.enum(MEAL_TYPES).optional().describe("If the user said or it is obvious from time of day"),
    date: dayString.optional().describe("Day the meal was eaten. Omit for today, or when the description says 'yesterday' etc. (the analyser reads it)"),
    subjectId: subjectField,
  }),
  risk: "write",
  applyPreviewEdits: applyPortionEdits,
  async run(ctx, input) {
    const subject = await ctx.resolveSubject(input.subjectId);
    const analysis = await analyzeMeal(
      { text: input.description, mealTypeHint: input.mealType },
      { patientId: subject.id }
    );
    const meals = analysis.meals.filter((m) => m.ingredients?.length);
    if (!meals.length) return { result: { error: "I couldn't identify any food in that description — could you describe the meal again with the main items?" } };
    const date =
      input.date ??
      (analysis.dateReference && DAY_RE.test(analysis.dateReference) && analysis.dateReference <= ctx.today ? analysis.dateReference : ctx.today);
    const preview = { ...mealPreview(meals, date), subject: subject.name, subjectId: subject.id, analysis: { model: analysis.model, meals } };
    const totalKcal = preview.meals.reduce((a, m) => a + m.calories, 0);
    const summary = `${preview.meals.map((m) => `${m.mealType?.toLowerCase() ?? "meal"}: ${m.name} (${m.calories} kcal)`).join("; ")} on ${date}${subject.isSelf ? "" : ` for ${subject.name}`}`;
    return {
      result: { previewFor: subject.name, date, totalCalories: totalKcal, meals: preview.meals.map(({ ingredients, ...m }) => ({ ...m, ingredientCount: ingredients.length })) },
      proposal: { title: preview.meals.length === 1 ? `Log ${preview.meals[0].mealType?.toLowerCase() ?? "meal"}` : `Log ${preview.meals.length} meals`, summary, preview },
    };
  },
  async commit(ctx, input, preview: any) {
    // Re-analyse only if the stored preview is missing (edited input) — the
    // preview the user confirmed is the one that gets saved.
    let analysed: any[] = preview?.analysis?.meals ?? [];
    let subjectId: string = preview?.subjectId ?? (await ctx.resolveSubject(input.subjectId)).id;
    let date: string = preview?.date ?? input.date ?? ctx.today;
    if (!analysed.length) {
      const subject = await ctx.resolveSubject(input.subjectId);
      subjectId = subject.id;
      const analysis = await analyzeMeal({ text: input.description, mealTypeHint: input.mealType }, { patientId: subject.id });
      analysed = analysis.meals.filter((m) => m.ingredients?.length);
      date = input.date ?? (analysis.dateReference && DAY_RE.test(analysis.dateReference) ? analysis.dateReference : ctx.today);
    }
    if (!analysed.length) throw new Error("nothing to log");
    const when = moment.tz(date, "YYYY-MM-DD", ctx.timeZone).hour(12);
    const saved: any[] = [];
    for (const m of analysed) {
      const entries = [
        {
          description: m.mealName || "Meal",
          quantity: "1",
          calories: Math.round(sum(m.ingredients.map((i: any) => i.calories))),
          mealType: input.mealType ?? m.mealType,
          ingredients: m.ingredients, // server recomputes totals from these
          nutrients: {},
          glycemicLoad: m.glycemicLoad ?? 0,
        },
      ];
      const rows = await CaloriesService.createFoodEntry(subjectId, entries, when, ctx.timeZone);
      if (Array.isArray(rows)) saved.push(...rows);
    }
    const result = {
      logged: saved.map((e) => ({ id: e.id, description: e.description, mealType: e.mealType, calories: e.calories, ingredients: e.ingredients?.length ?? 0 })),
      date,
    };
    return { result, cards: [{ type: "meal_logged", title: "Logged", data: result }] };
  },
});

/* ------------------------------- log_vital ------------------------------- */

export const logVital = defineTool({
  name: "log_vital",
  description:
    "Record a vital the user reports: weight, body_fat, blood_pressure (systolic/diastolic, optional pulse) or glucose. Returns a preview; the user confirms in the app. Weight/body fat are saved for today; BP/glucose take an optional time.",
  schema: z
    .object({
      kind: z.enum(["weight", "body_fat", "blood_pressure", "glucose"]),
      value: z.number().optional().describe("weight, body fat %, or glucose value"),
      unit: z.enum(["kg", "lb", "%", "mg/dL", "mmol/L"]).optional(),
      systolic: z.number().int().min(50).max(300).optional(),
      diastolic: z.number().int().min(30).max(200).optional(),
      pulse: z.number().int().min(20).max(250).optional(),
      at: z.string().optional().describe("ISO date-time for BP/glucose, e.g. 2026-08-24T07:30. Omit for now."),
    })
    .superRefine((v, ctx) => {
      if (v.kind === "blood_pressure" && (v.systolic === undefined || v.diastolic === undefined))
        ctx.addIssue({ code: "custom", message: "systolic and diastolic are required for blood_pressure" });
      if (v.kind !== "blood_pressure" && v.value === undefined) ctx.addIssue({ code: "custom", message: `value is required for ${v.kind}` });
    }),
  risk: "write",
  async run(ctx, input) {
    const at = input.at ? moment.tz(input.at, ctx.timeZone) : moment.tz(ctx.timeZone);
    if (!at.isValid()) return { result: { error: "unreadable time; use ISO like 2026-08-24T07:30" } };
    const label =
      input.kind === "blood_pressure"
        ? `${input.systolic}/${input.diastolic}${input.pulse ? ` (pulse ${input.pulse})` : ""}`
        : `${input.value} ${input.unit ?? (input.kind === "weight" ? "kg" : input.kind === "body_fat" ? "%" : "mg/dL")}`;
    const preview = { kind: input.kind, label, at: at.toISOString(), atLocal: at.format("YYYY-MM-DD HH:mm") };
    return { result: { previewOf: preview }, proposal: { title: `Log ${input.kind.replace("_", " ")}`, summary: `${input.kind.replace("_", " ")} ${label} at ${preview.atLocal}`, preview } };
  },
  async commit(ctx, input) {
    const at = input.at ? moment.tz(input.at, ctx.timeZone) : moment.tz(ctx.timeZone);
    let saved: unknown;
    switch (input.kind) {
      case "weight":
        saved = await WeightService.createWeightEntry(ctx.patientId, input.value!, input.unit === "lb" ? "lb" : "kg");
        break;
      case "body_fat":
        saved = await BFPService.createBFPEntry(ctx.patientId, input.value!);
        break;
      case "blood_pressure":
        saved = await BloodPressureService.createBPEntry(ctx.patientId, at.toISOString(), input.systolic!, input.diastolic!, input.pulse);
        break;
      case "glucose":
        saved = await GlucoseService.createGlucoseEntry(ctx.patientId, at.toISOString(), input.value!);
        break;
    }
    const result = { saved: true, kind: input.kind, id: (saved as any)?.id ?? null };
    return { result, cards: [{ type: "vital_logged", title: "Saved", data: { ...result, at: at.toISOString() } }] };
  },
});

/* --------------------------- message_care_team --------------------------- */

const careTeamOf = async (patientId: string) => {
  const patient = await prisma.patient.findUnique({ where: { id: patientId }, select: { doctorIds: true, firstName: true, lastName: true } });
  const doctors = await prisma.user.findMany({
    where: { id: { in: patient?.doctorIds ?? [] } },
    select: { id: true, firstName: true, lastName: true, specialty: true },
  });
  return { patient, doctors };
};

export const messageCareTeam = defineTool({
  name: "message_care_team",
  description:
    "Send a message from the user to one of their clinicians on Ollo (e.g. share flagged labs, ask a medication question you cannot answer, report a symptom pattern). Draft the message in the user's voice with the relevant data; they confirm before it is sent. If the user has no care team yet, the tool says so.",
  schema: z.object({
    doctorId: z.string().optional().describe("From get_care_team. Omit if the user has exactly one clinician."),
    subject: z.string().min(3).max(120),
    body: z.string().min(10).max(2000).describe("The message, first person, plain text, with the data points"),
  }),
  risk: "write",
  async run(ctx, input) {
    const { doctors } = await careTeamOf(ctx.patientId);
    if (!doctors.length) return { result: { error: "no clinician linked to this account yet — the user can add one from the Care Team screen" } };
    const doctor = input.doctorId ? doctors.find((d) => d.id === input.doctorId) : doctors.length === 1 ? doctors[0] : null;
    if (!doctor) return { result: { error: "specify doctorId", doctors: doctors.map((d) => ({ id: d.id, name: `${d.firstName} ${d.lastName}`, specialty: d.specialty })) } };
    const preview = { doctorId: doctor.id, doctorName: `${doctor.firstName} ${doctor.lastName}`, subject: input.subject, body: input.body };
    return { result: { previewOf: preview }, proposal: { title: `Message Dr. ${doctor.lastName}`, summary: `"${input.subject}" to Dr. ${doctor.lastName}`, preview } };
  },
  async commit(ctx, input, preview: any) {
    const { doctors } = await careTeamOf(ctx.patientId);
    const doctorId = preview?.doctorId ?? input.doctorId ?? (doctors.length === 1 ? doctors[0].id : null);
    if (!doctorId || !doctors.some((d) => d.id === doctorId)) throw new Error("clinician not on this user's care team");
    const chat = await MessagingService.createChat(doctorId, ctx.patientId);
    const msg = await MessagingService.sendMessage(`${input.subject}\n\n${input.body}`, chat.id, ctx.patientId, "PATIENT");
    const result = { sent: true, chatId: chat.id, messageId: msg.id, doctorId };
    return { result, cards: [{ type: "message_sent", title: "Sent to your care team", data: result }] };
  },
});

/* ---------------------------- book_appointment --------------------------- */

export const bookAppointment = defineTool({
  name: "book_appointment",
  description:
    "Request an appointment with one of the user's clinicians on Ollo at a specific date and time (local). Creates a PENDING booking the clinic confirms. The user confirms in the app first.",
  schema: z.object({
    doctorId: z.string().optional().describe("From get_care_team. Omit if the user has exactly one clinician."),
    at: z.string().describe("Local date-time, ISO, e.g. 2026-09-02T10:30"),
    durationMinutes: z.number().int().min(10).max(120).optional(),
    reason: z.string().min(3).max(300),
  }),
  risk: "write",
  async run(ctx, input) {
    const { doctors } = await careTeamOf(ctx.patientId);
    if (!doctors.length) return { result: { error: "no clinician linked to this account yet — the user can add one from the Care Team screen" } };
    const doctor = input.doctorId ? doctors.find((d) => d.id === input.doctorId) : doctors.length === 1 ? doctors[0] : null;
    if (!doctor) return { result: { error: "specify doctorId", doctors: doctors.map((d) => ({ id: d.id, name: `${d.firstName} ${d.lastName}` })) } };
    const at = moment.tz(input.at, ctx.timeZone);
    if (!at.isValid() || at.isBefore(moment())) return { result: { error: "time must be a valid future local date-time" } };
    const preview = { doctorId: doctor.id, doctorName: `${doctor.firstName} ${doctor.lastName}`, at: at.toISOString(), atLocal: at.format("ddd D MMM YYYY, HH:mm"), durationMinutes: input.durationMinutes ?? 30, reason: input.reason };
    return { result: { previewOf: preview }, proposal: { title: `Book Dr. ${doctor.lastName}`, summary: `${preview.atLocal} — ${input.reason}`, preview } };
  },
  async commit(ctx, input, preview: any) {
    const { patient, doctors } = await careTeamOf(ctx.patientId);
    const doctorId = preview?.doctorId ?? input.doctorId ?? (doctors.length === 1 ? doctors[0].id : null);
    const doctor = doctors.find((d) => d.id === doctorId);
    if (!doctor) throw new Error("clinician not on this user's care team");
    const at = moment.tz(input.at, ctx.timeZone);
    const appointmentDate = at.format("MM-DD-YYYYTHH:mm:ss.SSS[+00:00]"); // the app's booking date shape
    const data = {
      doctorId: doctor.id,
      patientId: ctx.patientId,
      patientName: [patient?.firstName, patient?.lastName].filter(Boolean).join(" "),
      doctorName: `${doctor.firstName} ${doctor.lastName}`,
      appointmentDate,
      durationMinutes: input.durationMinutes ?? 30,
      reason: input.reason,
      status: "PENDING" as const,
    };
    let booking: any;
    try {
      booking = await BookingService.createBooking(data);
    } catch (e) {
      // createBooking also emails the parties; a mail failure must not hide a saved booking.
      booking = await prisma.booking.findFirst({ where: { patientId: ctx.patientId, doctorId: doctor.id, appointmentDate } });
      if (!booking) throw e;
    }
    const result = { requested: true, bookingId: booking.id, status: booking.status, at: at.toISOString() };
    return { result, cards: [{ type: "appointment_requested", title: "Appointment requested", data: { ...result, doctorName: data.doctorName } }] };
  },
});
