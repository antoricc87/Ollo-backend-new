import { FoodCandidate } from "./foodResolver.types";

/**
 * Deterministic candidate scoring for food-database matches. Pure — unit tested.
 * Score ∈ [0, ~1.1]: coverage of the query tokens by the description, minus
 * penalties for qualifiers that make the entry more specific than the query,
 * plus a small data-type preference.
 */

const STOP = new Set(["of", "the", "a", "an", "and", "with", "in", "on", "or", "to", "ns", "as", "nfs"]);

const SYNONYMS: Record<string, string> = {
  bananas: "banana",
  eggs: "egg",
  tomatoes: "tomato",
  potatoes: "potato",
  strawberries: "strawberry",
  blueberries: "blueberry",
  raspberries: "raspberry",
  cherries: "cherry",
  grilled: "grill",
  roasted: "roast",
  baked: "bake",
  fried: "fry",
  boiled: "boil",
  scrambled: "scramble",
  steamed: "steam",
  whole: "whole",
  "semi-skimmed": "reduced",
  skimmed: "nonfat",
  skim: "nonfat",
  "2%": "reduced",
  "1%": "lowfat",
  wholemeal: "wheat",
  wholewheat: "wheat",
  spaghetti: "pasta",
  noodles: "pasta",
  sliced: "slice",
  slices: "slice",
  toasted: "toast",
  pcs: "piece",
};

export function tokenize(s: string): string[] {
  return (s || "")
    .toLowerCase()
    .replace(/[(),;:/]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t && !STOP.has(t))
    .map((t) => SYNONYMS[t] ?? t)
    .map((t) => (t.length > 4 && t.endsWith("s") ? t.slice(0, -1) : t)); // crude plural strip
}

/** Description qualifiers that make an entry narrower than a generic query. */
const NARROWING = [
  "baby food",
  "infant",
  "toddler",
  "dehydrated",
  "dried",
  "powder",
  "canned",
  "frozen",
  "glutinous",
  "as ingredient",
  "made with oil",
  "made with butter",
  "made with margarine",
  "fat added",
  "unprepared",
  "dry mix",
  "restaurant",
  "fast food",
  "school",
  "reduced sodium",
  "low sodium",
  "sugar free",
  "unsweetened",
  "sweetened",
  "fortified",
  "with salt",
  "without salt",
  // different product, not a qualifier of the same one
  "chocolate",
  "flavored",
  "flavoured",
  "vanilla",
  "strawberry",
  "stuffing",
  "buttermilk",
  "blended",
  "drink",
  "smoothie",
  "cooler",
  "non-alcoholic",
  "nonalcoholic",
  "substitute",
  "imitation",
  "mix",
];

/** Qualifiers that mark the generic entry we prefer for an unqualified query. */
const GENERIC_MARKERS = ["ns as to", "nfs", "no added fat", "not further specified"];

const DATA_TYPE_BONUS: Record<string, number> = {
  Foundation: 0.06,
  "SR Legacy": 0.05,
  "Survey (FNDDS)": 0.04,
  Branded: 0,
};

/** Description tokens that do not appear in the query (qualifiers we did not ask for). */
export function extraTokens(query: string, c: FoodCandidate): string[] {
  const q = new Set(tokenize(query));
  return tokenize(c.description).filter((t) => !q.has(t) && !GENERIC_TOKENS.has(t));
}

const GENERIC_TOKENS = new Set(["raw", "cooked", "plain", "regular", "nfs", "ns", "fat", "unspecified", "specified", "further", "not"]);

export function scoreCandidate(query: string, c: FoodCandidate): number {
  const q = tokenize(query);
  const dTokens = tokenize(c.description);
  if (!q.length || !dTokens.length) return 0;
  const dSet = new Set(dTokens);
  const covered = q.filter((t) => dSet.has(t) || dTokens.some((d) => d.startsWith(t) || t.startsWith(d))).length;
  const coverage = covered / q.length;

  const desc = c.description.toLowerCase();
  let penalty = 0;
  for (const n of NARROWING) if (desc.includes(n) && !query.toLowerCase().includes(n)) penalty += 0.15;
  const extra = dTokens.filter((t) => !q.includes(t)).length;
  penalty += Math.min(0.3, extra * 0.04);

  let bonus = DATA_TYPE_BONUS[c.dataType] ?? 0;
  if (GENERIC_MARKERS.some((m) => desc.includes(m))) bonus += 0.05;
  // Exact-ish match: description starts with the query's first token
  if (dTokens[0] === q[0]) bonus += 0.05;

  return Math.max(0, coverage - penalty + bonus);
}

export function rankCandidates(query: string, candidates: FoodCandidate[]) {
  return candidates
    .map((c) => ({
      candidate: c,
      score: Math.round(scoreCandidate(query, c) * 1000) / 1000,
      extra: extraTokens(query, c),
    }))
    .sort((a, b) => b.score - a.score);
}

/** Plausibility of a DB match given the model's own kcal estimate for the same grams. */
export function isPlausible(dbKcal: number, llmKcal: number): boolean {
  if (llmKcal <= 5 && dbKcal <= 15) return true; // water, black coffee, etc.
  if (llmKcal <= 0) return true;
  const ratio = dbKcal / llmKcal;
  return ratio >= 0.5 && ratio <= 2.0;
}
