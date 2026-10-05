import { turnEndNudge, TurnFacts } from "../../src/services/agent/turnChecks";

/** The words and the tool calls must agree. Each case is a reply that was actually sent. */

const facts = (over: Partial<Omit<TurnFacts, "checkin">> & { checkin?: Partial<TurnFacts["checkin"]> } = {}): TurnFacts => ({
  text: "",
  userMessage: "",
  proactive: null,
  usedTools: false,
  toolsCalled: [],
  proposed: false,
  generated: false,
  ...over,
  checkin: { inThread: false, active: false, historyComplete: false, flagged: false, rejected: null, ...(over.checkin ?? {}) },
});

describe("turnEndNudge", () => {
  it("is silent on an ordinary answer", () => {
    expect(turnEndNudge(facts({ text: "You have about 600 kcal left today." }))).toBeNull();
  });

  it("a card is described but nothing was prepared", () => {
    expect(turnEndNudge(facts({ text: "I've prepared a card to log your lunch — tap confirm." }))?.stage).toBe("claim_without_proposal");
    expect(turnEndNudge(facts({ text: "I've prepared a card to log your lunch — tap confirm.", proposed: true }))).toBeNull();
    // A generate tool's card is real.
    expect(turnEndNudge(facts({ text: "The card is ready — review and confirm when you like.", generated: true }))).toBeNull();
  });

  it("a weekly review written without reading the week", () => {
    expect(turnEndNudge(facts({ proactive: "weekly_review", text: "Last week you averaged 1,650 kcal." }))?.stage).toBe("weekly_review_without_reads");
    expect(turnEndNudge(facts({ proactive: "weekly_review", text: "Last week…", usedTools: true, toolsCalled: ["get_week_review"] }))).toBeNull();
  });

  describe("check-in: history complete, no assessment saved", () => {
    const live = { inThread: true, active: true, historyComplete: true };

    it("announced an assessment after the tool refused it", () => {
      const n = turnEndNudge(
        facts({ text: "I'll summarise what this could be. Give me a moment—here's what fits best.", usedTools: true, toolsCalled: ["record_checkin", "assess_checkin"], checkin: { ...live, rejected: '"should settle" is not allowed' } })
      );
      expect(n?.stage).toBe("checkin_complete_not_assessed");
      expect(n?.message).toContain('"should settle" is not allowed');
    });

    it("listed possibilities in its own words, with no tool at all", () => {
      expect(turnEndNudge(facts({ text: "Based on your answers, the most likely possibilities are a muscle strain or mechanical back pain.", checkin: live }))?.stage).toBe("checkin_complete_not_assessed");
    });

    it("stays out of the way: assessed (no longer active), a warning sign, an unrelated question, another tool's turn", () => {
      expect(turnEndNudge(facts({ text: "It could be a few things — the card has them.", usedTools: true, toolsCalled: ["assess_checkin"], checkin: { ...live, active: false } }))).toBeNull();
      expect(turnEndNudge(facts({ text: "That matches a published criterion…", usedTools: true, toolsCalled: ["record_checkin"], checkin: { ...live, flagged: true } }))).toBeNull();
      expect(turnEndNudge(facts({ text: "Your protein target is 120–150 g.", checkin: live }))).toBeNull();
      expect(turnEndNudge(facts({ text: "Here is what you ate today.", usedTools: true, toolsCalled: ["get_meals"], checkin: live }))).toBeNull();
    });

    it("says nothing while questions are still open", () => {
      expect(turnEndNudge(facts({ text: "When did this start?", usedTools: true, toolsCalled: ["record_checkin"], checkin: { ...live, historyComplete: false } }))).toBeNull();
    });
  });

  describe("check-in: a symptom, a question back, nothing opened", () => {
    const user = "My knee has been hurting when I go up stairs — can you give me some exercises to fix it?";

    it("nudges when the interview starts in the reply's own words", () => {
      expect(turnEndNudge(facts({ userMessage: user, text: "Let's go through your knee pain first. When did it start?" }))?.stage).toBe("checkin_not_opened");
    });

    it("not when a tool ran, when nothing is asked, or for training talk", () => {
      expect(turnEndNudge(facts({ userMessage: user, text: "When did it start?", usedTools: true, toolsCalled: ["start_checkin"], checkin: { inThread: true, active: true } }))).toBeNull();
      expect(turnEndNudge(facts({ userMessage: "Is back pain common in runners?", text: "It is one of the more common complaints in distance running." }))).toBeNull();
      expect(turnEndNudge(facts({ userMessage: "My legs are sore from Tuesday — should I train today?", text: "How heavy was Tuesday?" }))).toBeNull();
    });
  });

  describe("check-in: talked about, never opened", () => {
    const said = "Before we look at any training, let's go through a quick check-in. First, when did this knee pain start?";

    it("nudges to open it", () => {
      expect(turnEndNudge(facts({ text: said }))?.stage).toBe("checkin_not_opened");
    });

    it("not when one was opened this turn, or already exists in the conversation", () => {
      expect(turnEndNudge(facts({ text: said, usedTools: true, toolsCalled: ["start_checkin"], checkin: { inThread: true, active: true } }))).toBeNull();
      expect(turnEndNudge(facts({ text: "Your check-in from earlier is on the summary card.", checkin: { inThread: true } }))).toBeNull();
    });
  });
});
