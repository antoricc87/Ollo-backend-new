import { AsyncLocalStorage } from "async_hooks";

/**
 * Where a meal analysis spends its time (Oct 19 2026): a dinner suggestion took 47 s in production and
 * nothing said which step. One log line per analysis — the model call, each USDA search, each entry pick
 * (rerank), each portion lookup — so the slow step shows in the Railway logs of a real request.
 */
type Kind = "model" | "usda" | "rerank" | "portions";
type Timing = Record<Kind, number[]>;
const store = new AsyncLocalStorage<Timing>();

/** Time one step of the current analysis (no-op outside one). */
export const timed = async <T>(kind: Kind, fn: () => Promise<T>): Promise<T> => {
  const s = Date.now();
  try {
    return await fn();
  } finally {
    store.getStore()?.[kind].push(Date.now() - s);
  }
};

const fmt = (xs: number[]) => (xs.length ? `${xs.length}× ${(xs.reduce((a, b) => a + b, 0) / 1000).toFixed(1)}s (max ${(Math.max(...xs) / 1000).toFixed(1)}s)` : "0");

/** Run one analysis and log where its time went. */
export const withMealTiming = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
  const t: Timing = { model: [], usda: [], rerank: [], portions: [] };
  const s = Date.now();
  try {
    return await store.run(t, fn);
  } finally {
    console.log(`[meal-timing] ${label} total ${((Date.now() - s) / 1000).toFixed(1)}s · model ${fmt(t.model)} · usda ${fmt(t.usda)} · rerank ${fmt(t.rerank)} · portions ${fmt(t.portions)}`);
  }
};
