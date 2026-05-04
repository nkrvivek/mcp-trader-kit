import { describe, expect, it } from "vitest";
import { synthesizeDebateHandler } from "../../src/tools/synthesize-debate.js";

describe("synthesizeDebateHandler", () => {
  it("returns Hold w/ low conviction when both args are empty", async () => {
    const r = await synthesizeDebateHandler({ ticker: "SPY" });
    expect(r.verdict).toBe("HOLD");
    expect(r.rating).toBe("Hold");
    expect(r.conviction).toBe(1);
    expect(r.warnings).toContain("both arguments thin — low-confidence verdict");
  });

  it("rates Buy when bull arg is rich + concrete and bear is thin", async () => {
    const bull = `Bull Analyst: ${"Strong fundamentals — revenue grew 18% YoY in 2026-Q1, gross margin expanded 320 bps. Per fundamentals: FCF up 25%. Per market: 50/200 SMA golden cross 2026-04-15, RSI 62. Per news: analyst upgrades from Goldman + JPM 2026-04-22. Per sentiment: $50M darkpool accumulation, congressional buys $200K. ".repeat(3)}`;
    const bear = "Bear: pricey.";
    const r = await synthesizeDebateHandler({ ticker: "AAPL", bull_argument: bull, bear_argument: bear });
    expect(r.rating).toMatch(/Buy|Overweight/);
    expect(r.verdict).toBe("BUY");
    expect(r.bull_score).toBeGreaterThan(r.bear_score);
    expect(r.conviction).toBeGreaterThanOrEqual(2);
  });

  it("respects HALT regime — caps at Hold/Underweight even with strong bull", async () => {
    const bull = `Per fundamentals: revenue 18% YoY. Per market: golden cross 2026-04-15. Per news: upgrades. Per sentiment: $50M darkpool. `.repeat(5);
    const r = await synthesizeDebateHandler({
      ticker: "AAPL",
      bull_argument: bull,
      bear_argument: "weak bear case",
      context: { regime_tier: "HALT" },
    });
    expect(["Hold", "Underweight"]).toContain(r.rating);
    expect(r.verdict).not.toBe("BUY");
  });

  it("blocks to Hold when r_violations present even with strong bull", async () => {
    const bull = `Per fundamentals: 18% YoY. Per market: golden cross 2026-04-15. `.repeat(8);
    const r = await synthesizeDebateHandler({
      ticker: "BBAI",
      bull_argument: bull,
      bear_argument: "R3 violation: short leg within 60min of expiry day",
      context: { r_violations: ["R3"] },
    });
    expect(r.rating).toBe("Hold");
    expect(r.position_sizing_notes).toMatch(/R3/);
  });

  it("extracts key_risks from bear argument bullets", async () => {
    const bear = `
- High concentration: AAPL 38% of NAV, no headroom
- R3 violation: short leg within 60min of expiry day
- Earnings IV RED tier — historical IV crush 45%
- Margin debit risk if assigned
- Wash-sale lookback unresolved
`.trim();
    const r = await synthesizeDebateHandler({ ticker: "AAPL", bull_argument: "thesis intact", bear_argument: bear });
    expect(r.key_risks.length).toBeGreaterThanOrEqual(3);
    expect(r.key_risks.some((k) => k.includes("R3"))).toBe(true);
  });

  it("rates Underweight when bear evidence dominates", async () => {
    const bull = "Bull: looks good.";
    const bear = `Per fundamentals: revenue declined 12% YoY 2026-Q1, debt ratio 4.5×, dividend cut announced 2026-03-10. Per market: 50/200 death cross 2026-04-01, RSI 28 oversold but trend negative. Per news: SEC investigation announced, Goldman downgrade 2026-04-15. Per sentiment: insider selling $30M last 90d, congress sells $500K. R-rule R7 violation: thesis not declared. R-rule R3 risk on short leg.`.repeat(2);
    const r = await synthesizeDebateHandler({ ticker: "WORST", bull_argument: bull, bear_argument: bear });
    expect(["Underweight", "Sell"]).toContain(r.rating);
    expect(r.verdict).toBe("SELL");
    expect(r.bear_r_rule_citations).toBeGreaterThan(0);
  });
});
