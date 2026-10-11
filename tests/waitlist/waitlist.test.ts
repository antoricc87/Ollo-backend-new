import { createRateLimiter, escapeHtml, waitlistSchema } from "../../src/services/waitlist/waitlist.model";

describe("waitlist — input", () => {
  it("normalizes the email so repeats hit the unique index", () => {
    const r = waitlistSchema.parse({ email: "  Jane.Doe@Example.COM ", source: "hero" });
    expect(r).toEqual({ email: "jane.doe@example.com", source: "hero" });
  });

  it("source is optional", () => {
    expect(waitlistSchema.parse({ email: "a@b.co" })).toEqual({ email: "a@b.co" });
  });

  it.each([[{}], [{ email: "" }], [{ email: "not-an-email" }], [{ email: `${"a".repeat(250)}@b.co` }]])(
    "rejects a bad email %j",
    (body) => {
      expect(waitlistSchema.safeParse(body).success).toBe(false);
    }
  );

  it("rejects a source with markup", () => {
    expect(waitlistSchema.safeParse({ email: "a@b.co", source: "<script>" }).success).toBe(false);
  });
});

describe("waitlist — escapeHtml", () => {
  it("escapes markup for the notification email", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });
});

describe("waitlist — rate limiter", () => {
  it("allows `limit` hits per window, per key, then resets", () => {
    const allow = createRateLimiter(2, 1000);
    expect(allow("ip1", 0)).toBe(true);
    expect(allow("ip1", 10)).toBe(true);
    expect(allow("ip1", 20)).toBe(false);
    expect(allow("ip2", 20)).toBe(true);
    expect(allow("ip1", 1000)).toBe(true);
  });
});
