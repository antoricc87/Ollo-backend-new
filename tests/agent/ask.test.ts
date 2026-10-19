import { buildSystemPrompt } from "../../src/services/agent/prompt/system";
import { heldBackQuestion } from "../../src/services/agent/tools/write.tools";

/** R3 "Ask" (Oct 2026): one asking rule for every area; tools ask back through one field. */
describe("the one asking rule", () => {
  const prompt = buildSystemPrompt({ snapshotText: "" });
  const voice = buildSystemPrompt({ snapshotText: "", voice: true });

  it("is stated once, in Before you act", () => {
    expect(prompt.match(/the ONE asking rule/g)).toHaveLength(1);
    expect(prompt).toMatch(/When a tool result carries askThis, that IS the question/);
  });

  it("no rule elsewhere contradicts it", () => {
    for (const p of [prompt, voice]) {
      expect(p).not.toMatch(/If you're unsure what they mean, ask one question/);
      expect(p).not.toMatch(/Never ask a question before designing/);
      expect(p).not.toMatch(/If one detail is missing and you cannot guess it well/);
      expect(p).not.toMatch(/ask which day those were/);
      expect(p).not.toMatch(/candidate watch workouts, ask which one/);
    }
  });
});

describe("a tool's question is built in code", () => {
  it("names the meals and the words that left the day open", () => {
    const q = heldBackQuestion([{ name: "Pizza", whenSaid: "the other day" } as any, { name: "Tiramisu", whenSaid: "" } as any]);
    expect(q.text).toBe('Which day did you have the pizza ("the other day") and the tiramisu?');
    expect(q.resumeWith).toMatch(/log_meal again/);
  });
});
