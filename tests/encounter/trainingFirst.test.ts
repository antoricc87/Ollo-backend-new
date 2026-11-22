import { trainingFirst } from "../../src/services/encounter/domain/trainingFirst";

/* Ruling Nov 22 2026: a request for training gets the workout first; a warning sign still opens the check-in. */
describe("trainingFirst", () => {
  it.each([
    "Create a 45 min workout focused on upper body core and exercises for my lower back long term recovery",
    "My lower back hurts since soccer yesterday, give me a 30 min home workout",
    "Give me exercises to fix my knee pain when I climb stairs",
    "Can you plan my training week? My shoulder is a bit sore",
    "What exercises can I do for my lower back?",
  ])("designs first: %s", (m) => expect(trainingFirst(m).designFirst).toBe(true));

  it.each([
    "My lower back hurts and my left leg has felt numb since this morning. Give me a core workout.",
    "Give me a workout, I had chest pain on my run yesterday",
    "I fell off my bike and my wrist is swollen, can you make me a leg session?",
    "My back hurts and I can't control my bladder, plan my week",
  ])("warning sign — check-in first: %s", (m) => expect(trainingFirst(m)).toMatchObject({ trainingAsk: true, designFirst: false }));

  it.each([
    "My back hurts after the gym",
    "My knee hurts during exercise",
    "I've had a headache every afternoon this week",
    "My lower back hurts, what should I do?",
    "",
  ])("not a training request — symptom path unchanged: %s", (m) => expect(trainingFirst(m).designFirst).toBe(false));
});
