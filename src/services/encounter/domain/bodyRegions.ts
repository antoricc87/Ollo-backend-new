/**
 * THE BODY MAP — the tappable figure that stands in for the "where is it?"
 * question (user mockup Oct 9 2026: artboards 5a FRONT, 41 regions, and
 * 5b BACK, 31). The figure's geometry lives in the app; the region KEYS and
 * their labels live here, because the record and the clinician handout are
 * built from them.
 *
 * Pure data and pure functions. Nothing here says what a location means.
 *
 * Sides are the PERSON's: `_r` is their right. On the front figure their
 * right is on the viewer's left; on the back figure their left is on the left.
 * Shoulders, arms, elbows, forearms and hands carry one key in both views.
 */

export type BodyView = "front" | "back";
/** How much of the figure the question shows, so the cells are big enough to tap. */
export type BodyFocus = "head" | "torso" | "full";

type Region = { label: string; views: BodyView[] };

const sided = (keys: Record<string, [string, BodyView[]]>): Record<string, Region> => {
  const out: Record<string, Region> = {};
  for (const [stem, [phrase, views]] of Object.entries(keys)) {
    out[`${stem}_r`] = { label: phrase.replace("{side}", "right").replace("{Side}", "Right"), views };
    out[`${stem}_l`] = { label: phrase.replace("{side}", "left").replace("{Side}", "Left"), views };
  }
  return out;
};

export const BODY_REGIONS: Record<string, Region> = {
  // head, front
  forehead: { label: "Forehead", views: ["front"] },
  nose: { label: "Nose", views: ["front"] },
  jaw: { label: "Jaw", views: ["front"] },
  neck: { label: "Front of neck", views: ["front"] },
  // head, back
  crown: { label: "Top of head", views: ["back"] },
  base_of_skull: { label: "Base of skull", views: ["back"] },
  neck_back: { label: "Back of neck", views: ["back"] },
  // abdomen: the nine-region grid, named by the person's side
  abdomen_upper_right: { label: "Upper right abdomen", views: ["front"] },
  abdomen_upper_center: { label: "Upper middle abdomen", views: ["front"] },
  abdomen_upper_left: { label: "Upper left abdomen", views: ["front"] },
  abdomen_mid_right: { label: "Right side of abdomen", views: ["front"] },
  abdomen_mid_center: { label: "Around the navel", views: ["front"] },
  abdomen_mid_left: { label: "Left side of abdomen", views: ["front"] },
  abdomen_lower_right: { label: "Lower right abdomen", views: ["front"] },
  abdomen_lower_center: { label: "Lower middle abdomen", views: ["front"] },
  abdomen_lower_left: { label: "Lower left abdomen", views: ["front"] },
  ...sided({
    eye: ["{Side} eye", ["front"]],
    cheek: ["{Side} cheek", ["front"]],
    ear: ["{Side} ear", ["front"]],
    chest: ["{Side} side of chest", ["front"]],
    groin: ["{Side} groin", ["front"]],
    thigh: ["Front of {side} thigh", ["front"]],
    knee: ["{Side} knee", ["front"]],
    shin: ["{Side} shin", ["front"]],
    foot: ["{Side} foot", ["front"]],
    shoulder: ["{Side} shoulder", ["front", "back"]],
    upper_arm: ["{Side} upper arm", ["front", "back"]],
    elbow: ["{Side} elbow", ["front", "back"]],
    forearm: ["{Side} forearm", ["front", "back"]],
    hand: ["{Side} hand", ["front", "back"]],
    back_of_head: ["Back of head ({side})", ["back"]],
    ear_back: ["Behind {side} ear", ["back"]],
    upper_back: ["Upper back ({side})", ["back"]],
    lower_back: ["Lower back ({side})", ["back"]],
    buttock: ["{Side} buttock", ["back"]],
    hamstring: ["Back of {side} thigh", ["back"]],
    knee_back: ["Back of {side} knee", ["back"]],
    calf: ["{Side} calf", ["back"]],
    heel: ["{Side} heel", ["back"]],
  }),
};

/**
 * Which questions show the figure (ruling Oct 9 2026): only a protocol's own
 * "where" question. Fever, breathlessness, tiredness, dizziness, low mood and
 * the fallback never do — they have no such question.
 */
const BODY_QUESTIONS: Record<string, { view: BodyView; focus: BodyFocus }> = {
  "chest_discomfort.location": { view: "front", focus: "torso" },
  "headache.location": { view: "front", focus: "head" },
  "abdominal_pain.location": { view: "front", focus: "torso" },
  "back_pain.location": { view: "back", focus: "torso" },
  "rash.location": { view: "front", focus: "full" },
  "joint_pain.which_joints": { view: "front", focus: "full" },
};

export type BodyQuestion = { view: BodyView; focus: BodyFocus; regions: { id: string; label: string; views: BodyView[] }[] };

/** The figure for one question, or null when that question is answered in words only. */
export const bodyFor = (protocolKey: string, slotKey: string): BodyQuestion | null => {
  const q = BODY_QUESTIONS[`${protocolKey}.${slotKey}`];
  return q ? { ...q, regions: Object.entries(BODY_REGIONS).map(([id, r]) => ({ id, label: r.label, views: r.views })) } : null;
};

export const MAX_REGIONS = 12;

/** Only keys that exist, each once, in the order tapped, capped. */
export const sanitizeRegions = (input: unknown): string[] => {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const id of input) if (typeof id === "string" && BODY_REGIONS[id] && out.indexOf(id) < 0) out.push(id);
  return out.slice(0, MAX_REGIONS);
};

/** Where a slot's tapped regions are kept on the record, beside its answer. */
export const regionsKey = (slotKey: string) => `${slotKey}_regions`;

/** "Lower back (left), Left buttock" — a restatement of what was tapped, nothing more. */
export const regionsLine = (ids: unknown): string =>
  (Array.isArray(ids) ? ids : [])
    .map((id) => BODY_REGIONS[String(id)]?.label)
    .filter(Boolean)
    .join(", ");
