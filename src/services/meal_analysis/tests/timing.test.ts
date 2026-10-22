import { timed, withMealTiming } from "../timing";

describe("meal timing log", () => {
  it("prints one line with each step, including parallel lookups", async () => {
    const lines: string[] = [];
    const spy = jest.spyOn(console, "log").mockImplementation((l: string) => void lines.push(l));
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const out = await withMealTiming("analyzeMeal", async () => {
      await timed("model", () => wait(5));
      await Promise.all([timed("usda", () => wait(5)), timed("usda", () => wait(5)), timed("rerank", () => wait(5))]);
      return 42;
    });
    spy.mockRestore();
    expect(out).toBe(42);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[meal-timing\] analyzeMeal total .*model 1× .*usda 2× .*rerank 1× .*portions 0$/);
  });

  it("does nothing outside an analysis", async () => {
    await expect(timed("usda", async () => "ok")).resolves.toBe("ok");
  });
});
