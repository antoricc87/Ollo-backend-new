import { z } from "zod";
import { defineTool } from "./registry";

/**
 * "Undo that" (Oct 7 2026): reverses the last log the agent saved — a meal
 * or a workout — within UNDO_WINDOW_HOURS. Built for the hands-free path,
 * where meals and workouts are saved without a confirmation step and the
 * person is told "say undo if that's wrong"; it works in chat too, where it
 * is an ordinary confirm-gated write. The reversal itself is the logging
 * tool's own `undo` (registry.ts), run by proposals.store.undo.
 *
 * proposals.store imports the registry, so it is loaded lazily here to keep
 * the module graph acyclic.
 */
export const UNDO_WINDOW_HOURS = 24;

const store = () => import("../memory/proposals.store").then((m) => m.default);

export const undoLastLog = defineTool({
  name: "undo_last_log",
  description:
    "Reverse the most recent meal or workout the user logged through you (within the last day) — when they say 'undo', 'that's wrong', 'delete that' or correct what they just logged. Returns what will be removed. Call it BEFORE logging a corrected version, so the wrong entry does not stay.",
  schema: z.object({}),
  risk: "write",
  async run(ctx) {
    const last = await (await store()).latestUndoable(ctx.patientId, UNDO_WINDOW_HOURS * 3600 * 1000);
    if (!last) return { result: { error: "Nothing logged through me in the last day that can be undone." } };
    return {
      result: { undoes: last.summary, loggedAt: last.confirmedAt?.toISOString() ?? null },
      proposal: { title: "Undo", summary: `Undo "${last.title}" — ${last.summary}`, preview: { proposalId: last.id, summary: last.summary } },
    };
  },
  async commit(ctx, _input, preview: any) {
    const r = await (await store()).undo(ctx.patientId, String(preview?.proposalId ?? ""));
    if (r.status !== 200) throw new Error(r.error);
    return { result: { undone: r.undone } };
  },
});
