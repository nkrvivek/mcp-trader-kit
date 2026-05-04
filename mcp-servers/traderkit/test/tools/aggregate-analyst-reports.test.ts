import { describe, expect, it } from "vitest";
import { aggregateAnalystReportsHandler } from "../../src/tools/aggregate-analyst-reports.js";

describe("aggregateAnalystReportsHandler", () => {
  it("returns INSUFFICIENT_DATA when no reports provided", async () => {
    const r = await aggregateAnalystReportsHandler({ ticker: "SPY" });
    expect(r.confluence_summary).toMatch(/INSUFFICIENT_DATA/);
    expect(r.signal_score).toBe(50);
    expect(r.reports_present).toBe(0);
  });

  it("scores high when all 4 reports are bullish", async () => {
    const r = await aggregateAnalystReportsHandler({
      ticker: "AAPL",
      fundamentals_md: "Net Bias: + Magnitude: H Confidence: 0.8\nStrong revenue growth, margin expansion, and bullish guidance.",
      market_md: "Net Bias: + Magnitude: M Confidence: 0.7\nBullish breakout above 50-SMA, momentum strong.",
      news_md: "Net Bias: + Magnitude: M Confidence: 0.7\nPositive product launch, analyst upgrade.",
      sentiment_md: "Net Bias: + Magnitude: H Confidence: 0.8\nDarkpool accumulation, insider buys, bullish flow.",
    });
    expect(r.signal_score).toBeGreaterThanOrEqual(80);
    expect(r.confluence_summary).toMatch(/STRONG_CONFLUENCE/);
    expect(r.conflict_points).toHaveLength(0);
    expect(r.reports_present).toBe(4);
  });

  it("flags MIXED when fundamentals + sentiment disagree", async () => {
    const r = await aggregateAnalystReportsHandler({
      ticker: "TSLA",
      fundamentals_md: "Net Bias: - Magnitude: H Confidence: 0.8\nMargin compression, debt growing, bearish guidance miss, downgrade.",
      market_md: "Net Bias: 0 Magnitude: L Confidence: 0.5\nNeutral chop, no clear trend.",
      news_md: "Net Bias: 0 Magnitude: L Confidence: 0.4\nMixed news flow.",
      sentiment_md: "Net Bias: + Magnitude: H Confidence: 0.7\nDarkpool accumulation, bullish call flow, insider buys.",
    });
    expect(r.confluence_summary).toMatch(/MIXED/);
    expect(r.conflict_points.length).toBeGreaterThan(0);
    expect(r.conflict_points.some((c) => c.includes("fundamentals") && c.includes("sentiment"))).toBe(true);
  });

  it("extracts catalysts from news+fundamentals and risks from sentiment+fundamentals", async () => {
    const r = await aggregateAnalystReportsHandler({
      ticker: "NVDA",
      news_md: "Earnings beat, FOMC minutes dovish, guidance raised, partnership announced.",
      fundamentals_md: "Margin expansion, dividend buyback announced. Risk: high concentration in datacenter.",
      sentiment_md: "Risk: insider sell pattern, short interest rising, RED tier earnings IV.",
    });
    expect(r.top_catalysts.length).toBeGreaterThan(0);
    expect(r.top_risks.length).toBeGreaterThan(0);
  });
});
