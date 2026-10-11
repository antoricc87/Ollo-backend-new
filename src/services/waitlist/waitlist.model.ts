import { z } from "zod";

/**
 * Landing-page waitlist — pure helpers (no DB), unit-tested in
 * tests/waitlist/waitlist.test.ts.
 */

export const waitlistSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .email(),
  source: z
    .string()
    .trim()
    .max(40)
    .regex(/^[a-z0-9_-]+$/i)
    .optional(),
});

export type WaitlistInput = z.infer<typeof waitlistSchema>;

export function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * In-memory fixed-window limiter per key (client IP). Good enough for one
 * Railway instance; move to Redis if the service ever scales out.
 */
export function createRateLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return function allow(key: string, now = Date.now()): boolean {
    const entry = hits.get(key);
    if (!entry || now >= entry.resetAt) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      if (hits.size > 10_000) {
        for (const [k, v] of hits) if (now >= v.resetAt) hits.delete(k);
      }
      return true;
    }
    entry.count += 1;
    return entry.count <= limit;
  };
}
