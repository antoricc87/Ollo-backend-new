/**
 * Slice 3 live smoke: write tools → proposals → confirm/cancel → DB rows.
 *   npx ts-node --transpile-only scripts/agent-write-smoke.ts [email]
 * Cleans up everything it creates.
 */
import "dotenv/config";
import assert from "assert";
import prisma from "../src/utility/prismaClient";
import { runTurnCollect } from "../src/services/agent/agent.service";
import proposalStore from "../src/services/agent/memory/proposals.store";
import threadStore from "../src/services/agent/memory/thread.store";
import CaloriesService from "../src/services/calories_tracker/model/calories.model";
import { seedDoctorFor, unlinkDoctor } from "./seed-dev-doctor";

const log = (s: string) => console.log(s);

async function main() {
  const email = process.argv.slice(2).find((a) => a.includes("@")) ?? "antoricciardelli@gmail.com";
  const p = await prisma.patient.findUnique({ where: { email }, select: { id: true } });
  assert(p, "patient missing");
  const pid = p.id;
  const createdEntryIds: string[] = [];
  let threadId: string | null = null;
  let bpEntryId: string | null = null;
  let bpDaily: string | null = null;
  const t0 = Date.now();

  const cleanup = async () => {
    // Through the service so DailyCalories / DailyNutrients / weekly totals are decremented too.
    for (const id of createdEntryIds) await CaloriesService.deleteFoodEntry(pid, id).catch(() => null);
    if (bpEntryId) await prisma.bloodPressureEntry.delete({ where: { id: bpEntryId } }).catch(() => null);
    if (bpDaily && (await prisma.bloodPressureEntry.count({ where: { dailyTrackerId: bpDaily } })) === 0)
      await prisma.dailyBloodPressure.delete({ where: { id: bpDaily } }).catch(() => null);
    await unlinkDoctor(pid).catch(() => null);
    // Only THIS run's proposals/audit rows — never the account's whole history.
    if (threadId) {
      await prisma.agentProposal.deleteMany({ where: { patientId: pid, threadId } });
      await prisma.agentAuditLog.deleteMany({ where: { patientId: pid, threadId } });
      await threadStore.remove(pid, threadId).catch(() => null);
    }
    log("cleaned up");
  };

  const turn = async (message: string) => {
    const r = await runTurnCollect({ patientId: pid, threadId, message });
    threadId = r.threadId;
    const tools = r.events.filter((e): e is any => e.type === "tool_start").map((e) => e.name);
    const proposals = r.events.filter((e): e is any => e.type === "proposal");
    const cards = r.events.filter((e): e is any => e.type === "card").map((e) => e.card.type);
    log(`\n> ${message}\n  tools=${JSON.stringify(tools)} cards=${JSON.stringify(cards)} safety=${JSON.stringify(r.safety)}${r.error ? " ERROR " + r.error : ""}`);
    log("  " + (r.done?.text ?? "").split("\n").join("\n  "));
    return { ...r, proposals };
  };

  try {
  /* 1. log a meal → proposal → confirm → FoodEntry + ingredients exist */
  const a = await turn("I just had lunch: a chicken caesar salad with a small bread roll and a black coffee.");
  assert.equal(a.proposals.length, 1, "one proposal expected");
  const prop = a.proposals[0];
  assert.equal(prop.toolName, "log_meal");
  assert(!/logged|saved/i.test(a.done!.text) || /confirm/i.test(a.done!.text), "must not claim it is logged before confirmation");
  log(`  proposal ${prop.proposalId}: ${prop.title} — ${prop.summary}`);
  // Preview shape (multi-day log_meal): `days[].meals[]` rows, `index` addresses `analysis.meals`.
  const preview: any = prop.preview;
  const rows: any[] = preview.days.flatMap((d: any) => d.meals);
  assert(rows.length >= 1 && rows[0].ingredients.length >= 2, "ingredients in preview");
  const pending = await proposalStore.list(pid, { status: "PENDING" });
  assert(pending.some((x) => x.id === prop.proposalId));

  // A lunch already logged today makes the duplicate check untick this one —
  // tick it back on, as the user would on the card.
  const c = await proposalStore.confirm(pid, prop.proposalId, null, rows[0].included ? undefined : { meals: [{ index: rows[0].index, included: true }] });
  assert.equal(c.status, 200, JSON.stringify(c));
  const logged = (c as any).result.logged;
  assert(logged.length >= 1);
  createdEntryIds.push(...logged.map((e: any) => e.id));
  const row = await prisma.foodEntry.findUnique({ where: { id: logged[0].id }, include: { ingredients: true } });
  assert(row && row.ingredients.length >= 2, "ingredient rows persisted");
  log(`  ✓ confirmed → FoodEntry ${row!.id} "${row!.description}" ${row!.calories} kcal, ${row!.ingredients.length} ingredients, mealType=${row!.mealType}`);
  const again = await proposalStore.confirm(pid, prop.proposalId);
  assert.equal(again.status, 409, "double confirm rejected");

  /* 2. next turn sees the confirmation note */
  const b = await turn("Great — so what have I logged today in total?");
  assert(/caesar|salad/i.test(b.done!.text), "follow-up should reference the confirmed meal");

  /* 3. vital with edits: propose 128/82, user edits diastolic before confirming */
  const v = await turn("Log my blood pressure: 128 over 82, pulse 64, taken this morning at 7:30.");
  assert.equal(v.proposals.length, 1);
  assert.equal(v.proposals[0].toolName, "log_vital");
  const vc = await proposalStore.confirm(pid, v.proposals[0].proposalId, { diastolic: 84 });
  assert.equal(vc.status, 200, JSON.stringify(vc));
  const bp = await prisma.bloodPressureEntry.findUnique({ where: { id: (vc as any).result.id } });
  assert(bp && bp.diastolic === 84 && bp.systolic === 128, "edited value saved");
  log(`  ✓ BP saved ${bp!.systolic}/${bp!.diastolic} (edited) at ${bp!.createdAt}`);
  bpEntryId = bp!.id;
  bpDaily = bp!.dailyTrackerId;

  /* 4. cancel path */
  const w = await turn("Also log my weight at 77.4 kg.");
  assert.equal(w.proposals[0]?.toolName, "log_vital");
  const cx = await proposalStore.cancel(pid, w.proposals[0].proposalId);
  assert.equal(cx.status, 200);
  const after = await turn("Did you save my weight?");
  assert(!/saved|logged/i.test(after.done!.text) || /not|didn|declin|cancel/i.test(after.done!.text), "should know the weight was declined");

  /* 5. no care team → graceful, no proposal */
  const m = await turn("Message my doctor and ask whether I should be worried about my cholesterol.");
  assert.equal(m.proposals.length, 0, "no proposal without a care team");
  assert(/care team|clinician|doctor/i.test(m.done!.text));

  /* 5b. with a doctor linked: message → confirm → Message row; booking → confirm → Booking row */
  const { doctorId } = await seedDoctorFor(email);
  const msg = await turn("Now that Dr. Rossi is on my care team, send her a message asking whether my cholesterol results look ok to her.");
  assert.equal(msg.proposals[0]?.toolName, "message_care_team", "message proposal");
  const mc: any = await proposalStore.confirm(pid, msg.proposals[0].proposalId);
  assert.equal(mc.status, 200, JSON.stringify(mc));
  const sent = await prisma.message.findUnique({ where: { id: mc.result.messageId } });
  assert(sent && sent.senderType === "PATIENT" && sent.senderId === pid, "message persisted as PATIENT");
  log(`  ✓ message sent to doctor ${doctorId}: "${sent!.content.split("\n")[0]}"`);
  const bk = await turn("Book me 30 minutes with Dr. Rossi next Tuesday at 10:30 to go over my cholesterol.");
  assert.equal(bk.proposals[0]?.toolName, "book_appointment", "booking proposal");
  const bc: any = await proposalStore.confirm(pid, bk.proposals[0].proposalId);
  assert.equal(bc.status, 200, JSON.stringify(bc));
  const booking = await prisma.booking.findUnique({ where: { id: bc.result.bookingId } });
  assert(booking && booking.status === "PENDING" && booking.doctorId === doctorId, "booking persisted");
  log(`  ✓ booking ${booking!.id} PENDING at ${booking!.appointmentDate}`);
  await unlinkDoctor(pid);

  /* 5c. portion edit on a meal preview: halve the first ingredient, drop the last → calories scale */
  const pe = await turn("Log a snack: a handful of almonds and a small apple.");
  assert.equal(pe.proposals[0]?.toolName, "log_meal");
  const pv: any = pe.proposals[0].preview;
  const snack: any = pv.days.flatMap((d: any) => d.meals)[0];
  const ings = snack.ingredients;
  assert(ings.length >= 2, "two ingredients expected");
  const half = Math.round(ings[0].grams / 2);
  const edited: any = await proposalStore.confirm(pid, pe.proposals[0].proposalId, null, { meals: [{ index: snack.index, included: true, ingredients: [{ index: 0, grams: half }, { index: ings.length - 1, grams: null }] }] });
  assert.equal(edited.status, 200, JSON.stringify(edited));
  const row2 = await prisma.foodEntry.findUnique({ where: { id: edited.result.logged[0].id }, include: { ingredients: true } });
  createdEntryIds.push(row2!.id);
  assert.equal(row2!.ingredients.length, ings.length - 1, "one ingredient removed");
  assert(Math.abs(row2!.ingredients[0].grams - half) < 1, "grams edited");
  assert(row2!.calories < snack.calories, "calories dropped after edits");
  log(`  ✓ portion edits applied: ${snack.calories} → ${row2!.calories} kcal, ${row2!.ingredients.length} ingredients`);

  /* 6. generation: meal plan then grocery list */
  const g = await turn("Make me a 2-day meal plan, Mediterranean, quick weeknight dinners.");
  assert(g.events.some((e: any) => e.type === "card" && e.card.type === "meal_plan"), "meal_plan card");
  const gl = await turn("Turn that into a shopping list.");
  assert(gl.events.some((e: any) => e.type === "card" && e.card.type === "grocery_list"), "grocery_list card");

  /* 7. bad edits rejected; invalid proposal id 404 */
  const bad = await proposalStore.confirm(pid, "00000000-0000-0000-0000-000000000000");
  assert.equal(bad.status, 404);

  log(`\nall write-path checks passed in ${Math.round((Date.now() - t0) / 1000)} s`);
  } finally {
    await cleanup();
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
