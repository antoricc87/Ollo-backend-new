import moment from "moment-timezone";
import { z } from "zod";
import prisma from "../../../utility/prismaClient";
import {
  analyzeNarration,
  applyMealEdits,
  buildMealPreview,
  markDuplicates,
  missingSlots,
  normalizePreview,
  type BatchMeal,
  type ExistingEntry,
  type MealPreview,
} from "../../meal_analysis/mealBatch";
import CaloriesService from "../../calories_tracker/model/calories.model";
import WeightService from "../../weight_tracker/model/weight.model";
import BFPService from "../../bodyFatPercentage/model/bfp.model";
import BloodPressureService from "../../bp_tracker/model/bloodpressure.model";
import GlucoseService from "../../glucose_tracker/model/glucose.model";
import MessagingService from "../../messaging/model/messaging.model";
import BookingService from "../../bookings/model/bookings.model";
import { dayString, defineTool, subjectField } from "./registry";

/**
 * Confirm-gated write tools. `run` prepares a proposal (what will happen,
 * with a preview the app can show and edit); `commit` performs it through the
 * same service functions the app's own screens call, so trackers, summaries
 * and notifications stay consistent.
 */

const sum = (xs: (number | null | undefined)[]) => xs.reduce<number>((a, b) => a + (b ?? 0), 0);

/* ------------------------------- log_meal -------------------------------- */

const MEAL_TYPES = ["BREAKFAST", "LUNCH", "DINNER", "SNACK"] as const;

/** What is already logged on each of `dates` (for duplicate notes and gap questions). */
const existingMealsByDay = async (userId: string, dates: string[]): Promise<Record<string, ExistingEntry[]>> => {
  if (!dates.length) return {};
  const days = await prisma.dailyFood.findMany({
    where: { userId, OR: dates.map((d) => ({ date: { startsWith: d } })) },
    select: { date: true, foodEntries: { select: { mealType: true, description: true, calories: true } } },
  });
  const out: Record<string, ExistingEntry[]> = {};
  for (const d of days) (out[d.date.slice(0, 10)] ??= []).push(...d.foodEntries);
  return out;
};

const modelDays = (preview: MealPreview) =>
  preview.days.map((d) => ({
    date: d.date,
    label: d.label,
    meals: d.meals.map((m) => ({ mealType: m.mealType, name: m.name, calories: m.calories, included: m.included, ...(m.duplicateOf ? { alreadyLogged: m.duplicateOf } : {}) })),
  }));

export const logMeal = defineTool({
  name: "log_meal",
  description:
    "Log food the user ate (their own or a family member's) — a single meal or a catch-up over several days ('yesterday I had…, Tuesday dinner was…'). Pass the user's words verbatim in ONE call: foods, portions, brand names and every day/time reference. The tool analyses them into dated meals with calories and macros and returns a PREVIEW the user confirms in the app (ticking meals on/off, editing portions) before anything is saved. Meals whose day it cannot pin down come back as heldBack: ask the user which day and call the tool again for those with `date` set. Do not call it for hypothetical meals or meal ideas.",
  schema: z.object({
    description: z.string().min(3).max(4000).describe("What was eaten, verbatim from the user, incl. portions and day references"),
    mealType: z.enum(MEAL_TYPES).optional().describe("Only for a single meal, if the user said or it is obvious from time of day"),
    date: dayString.optional().describe("Day ALL meals in this call were eaten. Omit when the description carries its own day words ('yesterday', 'Monday'); set it when re-sending a held-back meal after the user said which day"),
    subjectId: subjectField,
  }),
  risk: "write",
  applyPreviewEdits: applyMealEdits,
  async run(ctx, input) {
    const subject = await ctx.resolveSubject(input.subjectId);
    if (input.date && input.date > ctx.today) return { result: { error: "That day is in the future — meals can only be logged for today or earlier." } };
    const analysis = await analyzeNarration(input.description, {
      patientId: subject.id,
      today: ctx.today,
      timeZone: ctx.timeZone,
      mealTypeHint: input.mealType,
      dateOverride: input.date,
    });
    if (!analysis.meals.length && !analysis.heldBack.length)
      return { result: { error: "I couldn't identify any food in that description — could you describe the meal again with the main items?" } };

    const existing = await existingMealsByDay(subject.id, [...new Set(analysis.meals.map((m) => m.date))]);
    const meals = markDuplicates(analysis.meals, existing);
    const preview = buildMealPreview(meals, { today: ctx.today, timeZone: ctx.timeZone, subject: subject.name, subjectId: subject.id, model: analysis.model, heldBack: analysis.heldBack });
    const missing = missingSlots(meals, existing);

    if (!meals.length) {
      return {
        result: {
          proposed: false,
          heldBack: analysis.heldBack,
          note: "Nothing proposed: I couldn't tell which day these were eaten. Ask the user which day, then call log_meal again with `date` set and the description below.",
        },
      };
    }
    const forWhom = subject.isSelf ? "" : ` for ${subject.name}`;
    const summary =
      preview.days.length === 1
        ? `${preview.days[0].meals.map((m) => `${m.mealType.toLowerCase()}: ${m.name} (${m.calories} kcal)`).join("; ")} on ${preview.days[0].date}${forWhom}`
        : `${preview.totals.included} meals over ${preview.days.length} days (${preview.days[0].date} → ${preview.days[preview.days.length - 1].date})${forWhom}`;
    const title =
      preview.days.length > 1 ? `Log ${preview.totals.meals} meals · ${preview.days.length} days` : preview.totals.meals === 1 ? `Log ${preview.days[0].meals[0].mealType.toLowerCase()}` : `Log ${preview.totals.meals} meals`;
    const duplicates = meals.filter((m) => m.duplicateOf).length;
    return {
      result: {
        previewFor: subject.name,
        days: modelDays(preview),
        totalCalories: preview.totals.calories,
        ...(duplicates ? { note: `${duplicates} meal(s) look already logged for that slot and are unticked by default — mention it briefly; the user can tick them back.` } : {}),
        ...(analysis.heldBack.length ? { heldBack: analysis.heldBack, heldBackNote: "Not in the card: I couldn't tell which day. Ask the user, then call log_meal again with `date` and the description given." } : {}),
        ...(Object.keys(missing).length ? { missingSlots: missing, missingNote: "Slots with nothing logged or proposed. Ask about at most one, only if it seems useful; never invent meals." } : {}),
      },
      proposal: { title, summary, preview },
    };
  },
  async commit(ctx, input, rawPreview: any) {
    // Re-analyse only if the stored preview is missing (edited input) — the
    // preview the user confirmed is the one that gets saved.
    let preview: MealPreview | null = rawPreview?.analysis?.meals?.length ? normalizePreview(rawPreview) : null;
    let subjectId: string = preview?.subjectId ?? (await ctx.resolveSubject(input.subjectId)).id;
    if (!preview) {
      const subject = await ctx.resolveSubject(input.subjectId);
      subjectId = subject.id;
      const analysis = await analyzeNarration(input.description, { patientId: subject.id, today: ctx.today, timeZone: ctx.timeZone, mealTypeHint: input.mealType, dateOverride: input.date });
      preview = buildMealPreview(analysis.meals, { today: ctx.today, timeZone: ctx.timeZone, subject: subject.name, subjectId, model: analysis.model, heldBack: analysis.heldBack });
    }
    const toSave = preview.analysis.meals.filter((m) => m.included && m.ingredients?.length);
    if (!toSave.length) throw new Error("nothing to log — every meal is unticked");
    const byDay = new Map<string, BatchMeal[]>();
    for (const m of toSave) (byDay.get(m.date) ?? byDay.set(m.date, []).get(m.date)!).push(m);
    const days: { date: string; meals: { id: string; description: string; mealType: string; calories: number; ingredients: number }[] }[] = [];
    for (const [date, meals] of [...byDay.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const when = moment.tz(date, "YYYY-MM-DD", ctx.timeZone).hour(12);
      const entries = meals.map((m) => ({
        description: m.mealName || "Meal",
        quantity: "1",
        calories: Math.round(sum(m.ingredients.map((i: any) => i.calories))),
        mealType: m.mealType,
        ingredients: m.ingredients, // server recomputes totals from these
        nutrients: {},
        glycemicLoad: m.glycemicLoad ?? 0,
      }));
      const rows = await CaloriesService.createFoodEntry(subjectId, entries, when, ctx.timeZone);
      days.push({ date, meals: (Array.isArray(rows) ? rows : []).map((e: any) => ({ id: e.id, description: e.description, mealType: e.mealType, calories: e.calories, ingredients: e.ingredients?.length ?? 0 })) });
    }
    const logged = days.flatMap((d) => d.meals.map((m) => ({ ...m, date: d.date })));
    const result = { logged, days, date: days.length === 1 ? days[0].date : undefined, totalCalories: logged.reduce((a, m) => a + (m.calories ?? 0), 0) };
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
