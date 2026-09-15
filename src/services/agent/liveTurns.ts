import { randomUUID } from "crypto";

/**
 * Turns that are still running (Sep 2026). A chat turn is NOT tied to its
 * HTTP connection: a phone that locks or loses signal mid-turn closes the
 * stream, but the turn finishes and saves its reply, which the app picks up
 * from `GET /threads/:id` (`answering` says one is still in flight). Only an
 * explicit cancel (the Stop button) or the hard cap ends a turn early.
 *
 * In-memory: correct for the single Railway instance. With several instances
 * `answering` / cancel would only see turns on the instance that got them.
 */

const TURN_MAX_MS = 5 * 60 * 1000;

type LiveTurn = { patientId: string; threadId: string | null; abort: AbortController; timer: NodeJS.Timeout };

const live = new Map<string, LiveTurn>();

/** Client-supplied ids are kept only if they look like ids. */
const cleanId = (raw: unknown) => (typeof raw === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(raw) ? raw : null);

export const liveTurns = {
  start(patientId: string, rawTurnId: unknown, threadId: string | null) {
    let turnId = cleanId(rawTurnId) ?? randomUUID();
    if (live.has(turnId)) turnId = randomUUID();
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), TURN_MAX_MS);
    const turn: LiveTurn = { patientId, threadId, abort, timer };
    live.set(turnId, turn);
    return {
      turnId,
      signal: abort.signal,
      setThread: (id: string) => {
        turn.threadId = id;
      },
      finish: () => {
        clearTimeout(timer);
        live.delete(turnId);
      },
    };
  },

  /** Stop the caller's turn, addressed by turnId or by the thread it runs on. */
  cancel(patientId: string, by: { turnId?: unknown; threadId?: unknown }) {
    let cancelled = 0;
    for (const [id, t] of live) {
      if (t.patientId !== patientId) continue;
      if ((by.turnId && id === by.turnId) || (by.threadId && t.threadId === by.threadId)) {
        t.abort.abort();
        cancelled += 1;
      }
    }
    return cancelled;
  },

  isAnswering(patientId: string, threadId: string) {
    for (const t of live.values()) if (t.patientId === patientId && t.threadId === threadId && !t.abort.signal.aborted) return true;
    return false;
  },
};
