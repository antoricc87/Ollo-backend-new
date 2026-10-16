import moment from "moment-timezone";
import { z } from "zod";
import { dayString, defineTool } from "./registry";
import { isoWeekRange } from "../memory/dates";
import { weekReviewFor, weekStatFor } from "../../review/model/weekReview.model";
import { statLine } from "../../review/domain/weekStats";

/**
 * The weekly review card. The numbers, the coverage of each row and the title
 * are decided in code (review/domain/weekReview.ts); the model gets the same
 * facts the card shows and writes the words around them.
 */
export const getWeekReview = defineTool({
  name: "get_week_review",
  description:
    "One finished Monday–Sunday week against the week before: sleep, HRV, training sessions, calories, protein and body weight, each with how much of the week was actually recorded. Shows the weekly review card. Default: last week. Use for the weekly review and for 'how was my week / last week'. For the week still in progress use the snapshot and the other tools instead.",
  schema: z.object({ weekOf: dayString.optional().describe("Any day inside the week to review. Omit for last week.") }),
  risk: "read",
  // The card IS the review — it shows even when other tools ran in the turn.
  cardRole: "result",
  async run(ctx, input) {
    const thisWeek = isoWeekRange(ctx.timeZone);
    const lastWeek = isoWeekRange(ctx.timeZone, moment.tz(thisWeek.start, ctx.timeZone).subtract(1, "week"));
    const asked = input.weekOf ? isoWeekRange(ctx.timeZone, moment.tz(input.weekOf, ctx.timeZone)) : lastWeek;
    // A week still running has nothing to average yet — review the last finished one.
    const week = asked.start >= thisWeek.start ? lastWeek : asked;
    const [review, stat] = await Promise.all([weekReviewFor(ctx.patientId, week.start, ctx.timeZone), weekStatFor(ctx.patientId, week.start, ctx.timeZone).catch(() => null)]);
    return {
      result: {
        ...(week.start !== asked.start ? { note: `That week is not over yet — this is the last finished one (${week.start} → ${week.end}).` } : {}),
        ...review,
        ...(stat
          ? {
              worthKnowing: {
                fact: statLine(stat),
                note: "A pattern code found in their own last four weeks, not on the card. Say it once, in one sentence, with both numbers and how many days each covers. It is a difference between two averages — never say one thing causes the other, never give advice from it.",
              },
            }
          : {}),
        howToRead:
          "The card already shows this table — do not recite it. A row with value null was NOT recorded enough to average: say so plainly using its `sub` line, never estimate it, never judge it and never compare it with last week. A null delta means last week had too little to compare against. Averages cover logged days only. Rows that are absent (see notJudged) had no data source this week.",
      },
      cards: [{ type: "week_review", title: `Weekly review · ${review.range}`, data: review }],
    };
  },
});
