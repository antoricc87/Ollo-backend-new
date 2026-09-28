/**
 * Saved meals through Ollie, live: log a breakfast, save it as the usual breakfast →
 * log "my usual lunch" with a change → no false match on an unsaved usual →
 * forget it. Runs on the eval fixture (eval-ollie@ollo.test), destroyed after.
 *   npx ts-node --transpile-only scripts/agent-favorite-smoke.ts
 */
import "dotenv/config";
import assert from "assert";
import prisma from "../src/utility/prismaClient";
import { runTurnCollect } from "../src/services/agent/agent.service";
import proposalStore from "../src/services/agent/memory/proposals.store";
import { createFixture, destroyFixture } from "../tests/agent/fixture";

const log = (s: string) => console.log(s);

async function main() {
  await destroyFixture();
  const { patientId: pid } = await createFixture();
  let threadId: string | null = null;
  const turn = async (message: string) => {
    const r = await runTurnCollect({ patientId: pid, threadId, message });
    threadId = r.threadId;
    const calls = r.events.filter((e): e is any => e.type === "tool_start");
    const proposals = r.events.filter((e): e is any => e.type === "proposal");
    log(`\n> ${message}\n  tools=${JSON.stringify(calls.map((c) => c.name))}${r.error ? " ERROR " + r.error : ""}`);
    log("  " + (r.done?.text ?? "").split("\n").join("\n  "));
    return { ...r, calls, proposals };
  };

  try {
    /* 1. log a real breakfast, then save it from the log */
    const a0 = await turn("For breakfast I had 60 g of oats with 200 ml of semi-skimmed milk, a banana and an espresso.");
    const first = a0.proposals.find((p) => p.toolName === "log_meal");
    assert(first, "breakfast proposal");
    const fc: any = await proposalStore.confirm(pid, first.proposalId);
    assert.equal(fc.status, 200, JSON.stringify(fc));
    const a = await turn("Save that as my usual breakfast.");
    const save = a.proposals.find((p) => p.toolName === "save_favorite");
    assert(save, "save_favorite proposal");
    assert.equal((save.preview as any).slot, "BREAKFAST");
    assert.equal((save.preview as any).from, "logged", "saved from the logged entry, not re-analysed");
    const sc: any = await proposalStore.confirm(pid, save.proposalId);
    assert.equal(sc.status, 200, JSON.stringify(sc));
    const fav = await prisma.favMeal.findFirst({ where: { userId: pid }, include: { ingredients: { orderBy: { sortOrder: "asc" } } } });
    assert(fav && fav.slot === "BREAKFAST" && fav.ingredients.length >= 3);
    log(`  ✓ saved "${fav!.description}" ${fav!.calories} kcal — ${fav!.ingredients.map((i) => i.name).join(", ")}`);

    /* 2. log it by reference, with a change */
    const b = await turn("Log my usual breakfast for yesterday, but no banana, and I added a teaspoon of honey.");
    const logCall = b.calls.find((c) => c.name === "log_meal");
    assert(logCall, "log_meal called");
    const refs = (logCall.input as any).favorites ?? [];
    assert.equal(refs.length, 1, `favorites used: ${JSON.stringify(logCall.input)}`);
    assert.equal(refs[0].favoriteId, fav!.id);
    const prop = b.proposals.find((p) => p.toolName === "log_meal");
    const row = (prop!.preview as any).days.flatMap((d: any) => d.meals)[0];
    assert(row.favorite?.id === fav!.id, "row tagged with the saved meal");
    assert(!row.ingredients.some((i: any) => /banana/i.test(i.name)), "banana removed");
    assert(row.ingredients.some((i: any) => /honey/i.test(i.name)), "honey added");
    const oats = (rs: any[]) => rs.find((i: any) => /oat/i.test(i.name))?.grams;
    assert.equal(oats(row.ingredients), Math.round(fav!.ingredients.find((i) => /oat/i.test(i.name))!.grams), "saved amounts copied as-is");
    log(`  ✓ proposal: ${row.name} · ${row.calories} kcal · ${row.favorite.changes}`);
    const lc: any = await proposalStore.confirm(pid, prop!.proposalId);
    assert.equal(lc.status, 200, JSON.stringify(lc));
    const after = await prisma.favMeal.findUnique({ where: { id: fav!.id } });
    assert.equal(after!.useCount, 1, "use counted");
    // The saved meal itself is untouched by this time's changes.
    assert.equal(await prisma.favMealIngredient.count({ where: { favMealId: fav!.id } }), fav!.ingredients.length);
    log(`  ✓ logged ${lc.result.logged.map((e: any) => `${e.description} ${e.calories} kcal on ${e.date}`).join("; ")}`);

    /* 2b. just the name, bigger */
    const b2 = await turn("Two days ago I had my usual breakfast too, a bigger one.");
    const c2 = b2.calls.find((c) => c.name === "log_meal");
    assert(c2 && ((c2.input as any).favorites ?? [])[0]?.portion === "hearty", `hearty favourite: ${JSON.stringify(c2?.input)}`);
    const row2 = (b2.proposals.find((p) => p.toolName === "log_meal")!.preview as any).days.flatMap((d: any) => d.meals)[0];
    assert(row2.calories >= fav!.calories! * 1.1, "the whole saved meal grows, not just the assumed items");
    log(`  ✓ proposal: ${row2.name} · ${row2.calories} kcal (saved ${fav!.calories}) on ${row2.date}`);

    /* 3. an unsaved "usual" is never matched to the saved one */
    const c = await turn("Log my usual dinner.");
    const wrong = c.calls.find((x) => x.name === "log_meal" && ((x.input as any).favorites ?? []).length);
    assert(!wrong, "must not log a saved meal for a dinner that isn't saved");
    log("  ✓ no saved dinner → no favourite used");

    /* 4. forget it */
    const d = await turn("Forget my usual breakfast, I don't eat that anymore.");
    const del = d.proposals.find((p) => p.toolName === "delete_favorite");
    assert(del, "delete_favorite proposal");
    const dc: any = await proposalStore.confirm(pid, del.proposalId);
    assert.equal(dc.status, 200, JSON.stringify(dc));
    assert.equal(await prisma.favMeal.count({ where: { userId: pid } }), 0);
    assert((await prisma.foodEntry.count({ where: { dailyFood: { userId: pid } } })) >= 2, "logged meals outlive the favourite");
    log("  ✓ forgotten; the log keeps its meals");
    log("\nALL PASS");
  } finally {
    await destroyFixture();
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
