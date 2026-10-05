/**
 * Last repair before the fixed fallback: cut the sentences that were flagged
 * and keep the rest.
 *
 * Before this (Oct 5 2026) one flagged sentence cost the whole answer — a lab
 * report explanation was replaced by "I can't give advice on that part"
 * because of "harmless" and "which is a good sign". The cut is deterministic
 * and can only REMOVE text, and the caller runs the full check again on what
 * is left, so this cannot let anything through that the check would not.
 */

/** Shown under a trimmed answer, so the gap is never silent. */
export const TRIM_NOTE = "I left out a part I can't speak to — that piece is a question for your doctor.";

/** Below this there is no answer left worth showing. */
const MIN_LEFT_CHARS = 80;

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[*_`#>]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s\-–—•\d.)]+/, "")
    .replace(/[\s.!?;:,"']+$/, "")
    .trim();

/** A quote may be abridged with an ellipsis ("Most other values... are in range"): every piece must appear, in order. */
const quoteParts = (quote: string) =>
  quote
    .split(/\.{3,}|…/)
    .map(norm)
    .filter((p) => p.length >= 8);

const containsInOrder = (haystack: string, parts: string[]) => {
  let from = 0;
  for (const p of parts) {
    const at = haystack.indexOf(p, from);
    if (at < 0) return false;
    from = at + p.length;
  }
  return true;
};

const isFlagged = (sentence: string, quotes: string[][]) => {
  const s = norm(sentence);
  if (!s) return false;
  return quotes.some((parts) => containsInOrder(s, parts) || (s.length >= 12 && parts.length === 1 && parts[0].includes(s)));
};

const BULLET = /^(\s*(?:[-–—•*]|\d+[.)])\s+)(.*)$/;
/** A line that only introduces what follows: "**Flagged (outside the lab's range):**". */
const isHeading = (line: string) => /^#{1,6}\s/.test(line.trim()) || /:\**\s*$/.test(line.trim());

/**
 * Removes every sentence matching a quote. Returns null when nothing matched
 * (the flag cannot be located, so cutting is not a repair) or when too little
 * is left to be an answer.
 */
export const trimFlagged = (answer: string, flaggedQuotes: string[]): { text: string; removed: string[] } | null => {
  const quotes = flaggedQuotes.map(quoteParts).filter((p) => p.length);
  if (!quotes.length) return null;

  const source = answer.split("\n");
  const removed: string[] = [];
  const kept: { line: string; from: number }[] = [];
  source.forEach((line, from) => {
    if (!line.trim()) return void kept.push({ line: "", from });
    const bullet = line.match(BULLET);
    const lead = bullet ? bullet[1] : "";
    const body = bullet ? bullet[2] : line;
    const left = body
      // Closing emphasis or a quote mark may sit between the full stop and the space.
      .split(/(?<=[.!?][*_"'”’)\]]{0,3})\s+/)
      .filter((sentence) => {
        if (!isFlagged(sentence, quotes)) return true;
        removed.push(sentence.trim());
        return false;
      })
      .join(" ")
      .trim();
    if (left) kept.push({ line: lead + left, from });
  });
  if (!removed.length) return null;

  // A heading that HAD lines under it and lost them all goes too.
  const hasBody = (all: string[], i: number) => {
    const next = all.slice(i + 1).find((l) => l.trim());
    return !!next && !isHeading(next);
  };
  const keptLines = kept.map((k) => k.line);
  const lines = keptLines.filter((line, i) => !line.trim() || !isHeading(line) || hasBody(keptLines, i) || !hasBody(source, kept[i].from));
  const text = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();

  const substance = lines.filter((l) => l.trim() && !isHeading(l)).join(" ");
  if (norm(substance).length < MIN_LEFT_CHARS) return null;
  return { text, removed };
};
