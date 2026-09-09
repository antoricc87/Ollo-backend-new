import { Protocol, Slot, SlotOption, PanelSource } from "./types";

/**
 * History-taking as DATA, on the OLDCARTS frame (onset, location, character,
 * severity, timing, modifying factors, associated symptoms).
 *
 * The point of writing questions down rather than letting a model invent them:
 * the set of things we ask is reviewable, versioned, and identical for every
 * patient with the same complaint. A model may rephrase a prompt to suit the
 * conversation; it can never introduce a question nobody approved.
 *
 * VERSIONING: bump a protocol's `version` whenever its slots change. Old
 * encounters store the version they were taken under, because a change to the
 * questions changes what the answers meant.
 *
 * SOURCES: `source` names the history-taking frame the slot set follows. These
 * are structural citations (what a clinician would ask), NOT clinical claims —
 * the red-flag criteria in redflags.ts are the ones that must be verified
 * against their guideline before launch.
 */

const BATES: PanelSource = { org: "Bates' Guide to Physical Examination — history taking", year: 2023 };
const NICE_CKS: PanelSource = { org: "NICE Clinical Knowledge Summaries", year: 2025, url: "https://cks.nice.org.uk/" };

/* --------------------------- shared OLDCARTS slots --------------------------- */

/** Option values are derived from their labels, so redflags.ts can reference a rule by the words the user saw. */
export const slug = (label: string): string => label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

const opt = (...values: string[]): SlotOption[] => values.map((v) => ({ value: slug(v), label: v }));

const ONSET: Slot = {
  key: "onset",
  kind: "single",
  prompt: "When did this start?",
  required: true,
  options: opt("Today", "In the last few days", "One to two weeks ago", "A month or more ago"),
};

const PATTERN: Slot = {
  key: "pattern",
  kind: "single",
  prompt: "How has it behaved since then?",
  required: true,
  options: opt("Constant", "Comes and goes", "Getting worse", "Getting better"),
};

const SEVERITY: Slot = {
  key: "severity",
  kind: "scale",
  prompt: "At its worst, how bad has it been?",
  required: true,
  range: [0, 10],
};

const ANYTHING_ELSE: Slot = {
  key: "anything_else",
  kind: "freetext",
  prompt: "Anything else you want written down before you see someone?",
  required: false,
};

/** Every protocol ends the same way: severity, then a free-text catch-all. */
const tail = (associated: Slot, extra: Slot[] = []): Slot[] => [ONSET, PATTERN, ...extra, associated, SEVERITY, ANYTHING_ELSE];

const associated = (prompt: string, ...values: string[]): Slot => ({
  key: "associated",
  kind: "multi",
  prompt,
  required: true,
  options: [...opt(...values), { value: "none_of_these", label: "None of these" }],
});

/* -------------------------------- protocols -------------------------------- */

export const PROTOCOLS: Protocol[] = [
  {
    key: "chest_discomfort",
    version: 1,
    title: "Chest discomfort",
    opener: "I'll take this down properly. First, a few things that mean this shouldn't wait.",
    source: BATES,
    slots: tail(
      associated(
        "Is any of this happening as well?",
        "Spreading to my arm, jaw, neck or back",
        "Short of breath",
        "Cold sweat",
        "Feeling sick",
        "Light-headed or faint"
      ),
      [
        { key: "location", kind: "single", prompt: "Where do you feel it?", required: true, options: opt("Centre of my chest", "Left side", "Right side", "Across the whole chest") },
        { key: "character", kind: "multi", prompt: "What does it feel like?", required: true, options: opt("Pressure or tightness", "Sharp", "Burning", "Aching", "Hard to describe") },
        { key: "trigger", kind: "single", prompt: "When does it come on?", required: true, options: opt("At rest", "When I exert myself", "When I breathe in", "After eating", "No pattern I can see") },
      ]
    ),
  },
  {
    key: "breathlessness",
    version: 1,
    title: "Shortness of breath",
    opener: "Let's get this written down. A few checks first.",
    source: BATES,
    slots: tail(
      associated("Is any of this happening as well?", "Chest pain", "Swollen ankles", "Coughing up blood", "Wheezing", "Fever"),
      [
        { key: "trigger", kind: "single", prompt: "When are you short of breath?", required: true, options: opt("At rest", "Walking on the flat", "Stairs or hills", "Lying flat", "Only with hard exercise") },
        { key: "speed", kind: "single", prompt: "Did it come on suddenly or build up?", required: true, options: opt("Suddenly, within minutes", "Over hours", "Over days or weeks") },
      ]
    ),
  },
  {
    key: "headache",
    version: 1,
    title: "Headache",
    opener: "I'll take the details. A few safety checks first.",
    source: NICE_CKS,
    slots: tail(
      associated(
        "Is any of this happening as well?",
        "Came on like a thunderclap",
        "Fever and a stiff neck",
        "Change in my vision",
        "Weakness or numbness on one side",
        "Confusion",
        "Rash that doesn't fade when pressed"
      ),
      [
        { key: "location", kind: "single", prompt: "Where is it?", required: true, options: opt("One side", "Both sides", "Behind my eyes", "Back of my head", "All over") },
        { key: "character", kind: "multi", prompt: "What does it feel like?", required: true, options: opt("Throbbing", "Pressing or tight", "Stabbing", "Dull") },
        { key: "worse_with", kind: "multi", prompt: "Does anything make it worse?", required: false, options: opt("Light", "Noise", "Movement", "Coughing or bending", "Screens", "Nothing I've noticed") },
      ]
    ),
  },
  {
    key: "abdominal_pain",
    version: 1,
    title: "Stomach or abdominal pain",
    opener: "Let's write this down properly.",
    source: BATES,
    slots: tail(
      associated("Is any of this happening as well?", "Vomiting blood", "Black or bloody stools", "Fever", "Can't keep fluids down", "Yellow skin or eyes", "Belly is rigid to touch"),
      [
        { key: "location", kind: "single", prompt: "Where is the pain?", required: true, options: opt("Upper right", "Upper middle", "Upper left", "Around the navel", "Lower right", "Lower middle", "Lower left", "It moves") },
        { key: "relation_to_food", kind: "single", prompt: "Does eating change it?", required: false, options: opt("Worse after eating", "Better after eating", "No difference") },
      ]
    ),
  },
  {
    key: "back_pain",
    version: 1,
    title: "Back pain",
    opener: "I'll take the details.",
    source: NICE_CKS,
    slots: tail(
      associated(
        "Is any of this happening as well?",
        "Numbness around the groin or inner thighs",
        "Trouble controlling my bladder or bowels",
        "Weakness in a leg",
        "Fever",
        "Unexplained weight loss",
        "It followed a fall or an accident"
      ),
      [
        { key: "location", kind: "single", prompt: "Where in your back?", required: true, options: opt("Neck", "Upper back", "Lower back", "Across one side") },
        { key: "radiates", kind: "single", prompt: "Does it travel anywhere?", required: true, options: opt("Down one leg", "Down both legs", "Into an arm", "It stays put") },
      ]
    ),
  },
  {
    key: "fatigue",
    version: 1,
    title: "Tiredness",
    opener: "Worth writing this down — tiredness is hard to describe on the spot in a room.",
    source: NICE_CKS,
    slots: tail(
      associated("Is any of this happening as well?", "Unexplained weight loss", "Night sweats", "Breathless doing ordinary things", "Fever that keeps coming back", "New lumps or swelling"),
      [{ key: "sleep_change", kind: "single", prompt: "Has your sleep changed?", required: true, options: opt("Sleeping less", "Sleeping more", "Broken sleep", "No change") }]
    ),
  },
  {
    key: "cough_fever",
    version: 1,
    title: "Cough or fever",
    opener: "Let's get the details down.",
    source: NICE_CKS,
    slots: tail(
      associated("Is any of this happening as well?", "Coughing up blood", "Chest pain when I breathe", "Short of breath at rest", "Confusion", "Fever above 39°C that won't come down"),
      [{ key: "productive", kind: "single", prompt: "Is the cough bringing anything up?", required: false, options: opt("Dry", "Clear phlegm", "Coloured phlegm") }]
    ),
  },
  {
    key: "dizziness",
    version: 1,
    title: "Dizziness",
    opener: "I'll take this down. A few checks first.",
    source: BATES,
    slots: tail(
      associated("Is any of this happening as well?", "Slurred speech", "Weakness on one side", "Double vision", "Fainted or nearly fainted", "Chest pain", "A very fast or irregular heartbeat"),
      [{ key: "character", kind: "single", prompt: "Which is closer to it?", required: true, options: opt("The room spins", "Light-headed, like I might faint", "Unsteady on my feet") }]
    ),
  },
  {
    key: "rash",
    version: 1,
    title: "Rash or skin change",
    opener: "Let's write it down — and a photo at the time helps more than a description later.",
    source: NICE_CKS,
    slots: tail(
      associated("Is any of this happening as well?", "Doesn't fade when pressed with a glass", "Swelling of my lips, tongue or face", "Trouble breathing", "Fever", "Blistering or peeling", "It's spreading quickly"),
      [{ key: "location", kind: "multi", prompt: "Where is it?", required: true, options: opt("Face", "Trunk", "Arms", "Legs", "Hands or feet", "All over") }]
    ),
  },
  {
    key: "joint_pain",
    version: 1,
    title: "Joint pain",
    opener: "I'll take the details.",
    source: NICE_CKS,
    slots: tail(
      associated("Is any of this happening as well?", "The joint is hot and red", "Fever", "It followed an injury", "I can't put weight on it", "Swelling in several joints at once"),
      [{ key: "which_joints", kind: "multi", prompt: "Which joints?", required: true, options: opt("Knee", "Hip", "Shoulder", "Hand or wrist", "Foot or ankle", "Back", "Several") }]
    ),
  },
  {
    key: "low_mood",
    version: 1,
    title: "Low mood",
    opener: "Thank you for telling me. I'll take this down carefully.",
    source: NICE_CKS,
    slots: [
      ONSET,
      PATTERN,
      { key: "impact", kind: "multi", prompt: "What has it been getting in the way of?", required: true, options: opt("Sleep", "Eating", "Work or study", "Seeing people", "Getting out of bed", "Nothing yet") },
      {
        key: "safety",
        kind: "single",
        prompt: "Have you had thoughts of harming yourself?",
        required: true,
        options: opt("Yes, right now", "Yes, recently", "No"),
      },
      ANYTHING_ELSE,
    ],
  },
  {
    key: "general_unwell",
    version: 1,
    title: "Something else",
    opener: "Tell me what's going on and I'll get it written down.",
    source: BATES,
    slots: tail(
      associated("Is any of this happening as well?", "Fever", "Unexplained weight loss", "Short of breath", "Chest pain", "Fainting", "None of these"),
      [{ key: "what", kind: "freetext", prompt: "In your own words, what's bothering you most?", required: true }]
    ),
  },
];

export const byKey = (key: string): Protocol | null => PROTOCOLS.find((p) => p.key === key) ?? null;

/** The fallback when the opening text matches no protocol. Never returns null. */
export const resolveProtocol = (key: string | null | undefined): Protocol =>
  (key ? byKey(key) : null) ?? (byKey("general_unwell") as Protocol);

export const requiredSlots = (p: Protocol): Slot[] => p.slots.filter((s) => s.required);

/** The closed vocabulary a classifier may choose from. Anything else is general_unwell. */
export const COMPLAINT_KEYS = PROTOCOLS.map((p) => p.key);
