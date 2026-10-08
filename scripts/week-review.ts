import moment from "moment-timezone";
import prisma from "../src/utility/prismaClient";
import { weekReviewFor } from "../src/services/review/model/weekReview.model";
import { isoWeekRange, safeTz } from "../src/services/agent/memory/dates";

/**
 * The weekly review card's data for one account, without the agent:
 *   npx ts-node --transpile-only scripts/week-review.ts <email> [any day in the week] [--json]
 * Default week: the last finished one.
 */
(async () => {
  const [email, day] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const p = await prisma.patient.findFirst({ where: { email }, select: { id: true, timeZone: true } });
  if (!p) throw new Error(`no patient ${email}`);
  const tz = safeTz(p.timeZone);
  const week = isoWeekRange(tz, day ? moment.tz(day, tz) : moment().tz(tz).subtract(1, "week"));
  const r = await weekReviewFor(p.id, week.start, tz);
  if (process.argv.includes("--json")) console.log(JSON.stringify(r, null, 2));
  else {
    console.log(`${r.range} · ${r.logged.days} of ${r.logged.of} days logged${r.logged.partDays ? ` (+${r.logged.partDays} part)` : ""}\n${r.title}${r.flags.length ? `  [${r.flags.map((f) => f.text).join(", ")}]` : ""}`);
    for (const x of r.rows) console.log(`  ${x.label.padEnd(6)} ${(x.value ?? "—").padStart(9)} ${(x.delta ?? "").padStart(7)}  ${x.name} — ${x.sub}`);
    console.log(`  ${r.strip.map((d) => ({ on: "●", off: "○", part: "◌", none: "–" })[d.state]).join(" ")}\n  not judged: ${r.notJudged.join("; ") || "nothing"}`);
  }
  await prisma.$disconnect();
})();
