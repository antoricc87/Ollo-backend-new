import prisma from "../../src/utility/prismaClient";
import { loadPlan, planForAgent, setOptional } from "../../src/services/preventive/model/preventive.model";

/**
 * The saved plan against the database (P1): built on first read, an added test
 * kept, words written once and not again until the items move. The model is
 * never called here (`words: false`, and getLLM is mocked to fail loudly).
 */
jest.mock("../../src/services/agent/llm/openai.client", () => ({ getLLM: () => ({ json: async () => { throw new Error("no model in tests"); } }) }));

describe("saved preventive plan", () => {
  let patientId = "";
  beforeAll(async () => {
    const p = await prisma.patient.create({ data: { email: `plan-test-${Date.now()}@ollo.local`, password: "x", gender: "male", dob: new Date("1987-05-10"), onBoardingComplete: true } as any });
    patientId = p.id;
  });
  afterAll(async () => {
    await prisma.patient.delete({ where: { id: patientId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it("first read builds and saves it, with words that never come back empty", async () => {
    const plan = await loadPlan(patientId, { words: false });
    expect(plan?.groups.map((g) => g.type)).toEqual(expect.arrayContaining(["lab", "vaccine", "check"]));
    expect(plan?.headline.length).toBeGreaterThan(10);
    expect(await prisma.preventivePlanItem.count({ where: { plan: { patientId } } })).toBeGreaterThan(8);
  });

  it("an added optional test shows in its group and leaves the optional list; removing it puts it back", async () => {
    const added = await setOptional(patientId, "cac", true, { words: false });
    const diag = added?.groups.find((g) => g.type === "diagnostic");
    expect(diag?.items.map((i: any) => i.key)).toContain("cac");
    expect(added?.optional.map((o) => o.key)).not.toContain("cac");
    expect(added?.counts.added).toBe(1);
    const again = await loadPlan(patientId, { words: false });
    expect(again?.groups.find((g) => g.type === "diagnostic")?.items.map((i: any) => i.key)).toContain("cac");
    const removed = await setOptional(patientId, "cac", false, { words: false });
    expect(removed?.optional.map((o) => o.key)).toContain("cac");
  });

  it("an unknown test is refused", async () => {
    expect(await setOptional(patientId, "nope", true, { words: false })).toBeNull();
  });

  it("a model failure keeps the code's words", async () => {
    await setOptional(patientId, "apob", true, { words: true }); // items moved → words rewritten → model throws → fallback
    const row = await prisma.preventivePlan.findUnique({ where: { patientId } });
    expect(row?.headline).toMatch(/items in your plan/);
  });

  it("Ollie reads it in one line", async () => {
    const line = await planForAgent(patientId);
    expect(line).toMatch(/^preventive plan: .*Cholesterol panel/);
    expect(line).toMatch(/ApoB/);
  });
});
