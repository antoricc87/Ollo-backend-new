/**
 * Does a food line contain something the person is allergic to?
 *
 * Allergies are stored as the app's CATEGORIES ("Shellfish", "Tree nuts",
 * "Dairy", "Gluten" — see the app's data/allergies.tsx), while food lines name
 * foods ("150 g shrimp", "parmesan"). A plain word match found "soy" and little
 * else, so every category maps to the foods in it (the US major allergens,
 * FALCPA + sesame). Matching is a word PREFIX — "egg" finds "eggs", "almond"
 * finds "almonds" — and look-alikes that are not the allergen ("coconut milk",
 * "peanut butter" for dairy, "gluten-free pasta") are removed first.
 *
 * Errs toward flagging: a false flag costs a revision or one sentence; a miss
 * costs a reaction. Pure — tests in tests/utils/allergens.test.ts.
 */

const FAMILIES: [RegExp, string[]][] = [
  [/^shell ?fish|crustacean|mollus/, ["shrimp", "prawn", "crab", "lobster", "crayfish", "crawfish", "langoustine", "scampi", "clam", "mussel", "oyster", "scallop", "squid", "calamari", "octopus", "cuttlefish", "shellfish"]],
  [/^fish$|^fish\b|finfish/, ["fish", "salmon", "tuna", "cod", "tilapia", "trout", "halibut", "sardine", "anchov", "mackerel", "haddock", "sea bass", "branzino", "snapper", "swordfish", "pollock", "catfish", "herring", "mahi", "sole", "flounder", "hake", "bonito", "caviar", "roe"]],
  [/tree ?nut|^nuts?$/, ["almond", "walnut", "cashew", "pecan", "pistachio", "hazelnut", "macadamia", "brazil nut", "pine nut", "praline", "marzipan", "nutella", "gianduja", "mixed nuts", "nut butter"]],
  [/peanut/, ["peanut", "groundnut", "satay"]],
  [/dairy|^milk|lactose|casein/, ["milk", "cheese", "butter", "cream", "yogurt", "yoghurt", "whey", "casein", "parmesan", "parmigiano", "pecorino", "mozzarella", "ricotta", "feta", "cheddar", "burrata", "mascarpone", "ghee", "custard", "kefir", "latte", "cappuccino", "gelato", "ice cream", "paneer", "halloumi", "brie", "gouda", "skyr", "quark", "béchamel", "bechamel", "alfredo", "tzatziki"]],
  [/^eggs?$/, ["egg", "mayonnaise", "mayo", "aioli", "meringue", "frittata", "omelet", "omelette", "quiche", "carbonara", "custard", "hollandaise"]],
  [/gluten|wheat|coeliac|celiac/, ["wheat", "flour", "bread", "pasta", "spaghetti", "penne", "fusilli", "rigatoni", "linguine", "tagliatelle", "lasagn", "gnocchi", "noodle", "ramen", "udon", "couscous", "bulgur", "barley", "rye", "semolina", "farro", "spelt", "seitan", "cracker", "tortilla", "pizza", "bagel", "croissant", "pita", "naan", "breadcrumb", "panko", "crouton", "toast", "sandwich", "wrap", "burger bun", "hot dog bun", "brioche", "muffin", "pancake", "waffle", "cake", "cookie", "biscuit", "cereal", "granola", "beer", "soy sauce"]],
  [/^soy|soya/, ["soy", "soya", "tofu", "edamame", "tempeh", "miso", "tamari"]],
  [/sesame/, ["sesame", "tahini", "halva", "hummus"]],
];

/** Look-alikes that are NOT the allergen, removed before matching. */
const NOT: [RegExp, RegExp][] = [
  [/dairy|^milk|lactose|casein/, /\b(coconut|almond|oat|soy|soya|rice|cashew|hazelnut) (milk|cream|yogh?urt|cheese|butter)\b|\b(peanut|nut|almond|cashew|cocoa|shea|apple) butter\b|\bcream of tartar\b|\bdairy[- ]free\b|\bvegan (cheese|butter)\b|\bbutternut\b/gi],
  [/^eggs?$/, /\beggplants?\b|\begg[- ]free\b/gi],
  [/gluten|wheat|coeliac|celiac/, /\bgluten[- ]free [a-z]+\b|\b(rice|glass|soba|zucchini|konjac|shirataki) noodles?\b|\b(corn|maize) tortillas?\b|\b(chickpea|lentil|rice|bean) pasta\b|\brice (cake|cracker)s?\b|\btamari\b|\bbuckwheat\b|\btoasted\b|\bwrapped\b/gi],
  [/tree ?nut|^nuts?$/, /\b(coconut|nutmeg|butternut|doughnut|donut|water chestnut)\b/gi],
  [/^fish$|^fish\b|finfish/, /\b(shellfish)\b/gi],
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const norm = (s: string) => s.toLowerCase().trim();

/** Every food word that counts as this allergy, the allergy's own word first. */
export const allergenTerms = (allergy: string): string[] => {
  const a = norm(allergy);
  const own = [a, a.replace(/s$/, "")].filter((x) => x.length >= 3);
  const family = FAMILIES.filter(([re]) => re.test(a)).flatMap(([, terms]) => terms);
  return [...new Set([...own, ...family])];
};

/** The matching term, or null. `text` is one food line or dish name. */
export const findAllergen = (text: string, allergy: string): string | null => {
  const a = norm(allergy);
  let t = ` ${norm(text)} `;
  for (const [re, drop] of NOT) if (re.test(a)) t = t.replace(drop, " ");
  for (const term of allergenTerms(allergy)) if (new RegExp(`\\b${escape(term)}`, "i").test(t)) return term;
  return null;
};

/** Allergies (as stored) that any of these lines trip, each once. */
export const allergiesIn = (lines: string[], allergies: string[]): string[] =>
  [...new Set(allergies.filter((a) => lines.some((l) => findAllergen(l, a) != null)))];
