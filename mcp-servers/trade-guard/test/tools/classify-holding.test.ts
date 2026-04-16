import { describe, expect, it } from "vitest";
import { classifyHoldingHandler } from "../../src/tools/classify-holding.js";

describe("classifyHoldingHandler", () => {
  it("classifies holdings by NAV weight", async () => {
    const r = await classifyHoldingHandler({
      holdings: [
        { ticker: "AAPL", market_value_usd: 30000, has_active_thesis: true },
        { ticker: "AG", market_value_usd: 5000, has_active_thesis: true },
        { ticker: "BBAI", market_value_usd: 1500, has_active_thesis: true },
        { ticker: "XYZZ", market_value_usd: 200, has_active_thesis: false },
      ],
      portfolio_total_usd: 100000,
    });

    const find = (t: string) => r.holdings.find((h: any) => h.ticker === t);
    expect(find("AAPL")!.tier).toBe("CORE");
    expect(find("AG")!.tier).toBe("OPPORTUNISTIC");
    expect(find("BBAI")!.tier).toBe("SPECULATIVE");
    expect(find("XYZZ")!.tier).toBe("PURE_SPECULATIVE");
  });

  it("floors options program members at OPPORTUNISTIC", async () => {
    const r = await classifyHoldingHandler({
      holdings: [
        { ticker: "SSL", market_value_usd: 500, has_active_thesis: false, in_options_program: true },
      ],
      portfolio_total_usd: 100000,
    });

    expect(r.holdings[0]!.tier).toBe("OPPORTUNISTIC");
    expect(r.holdings[0]!.rationale).toContain("program");
  });

  it("classifies penny stocks as PURE_SPECULATIVE", async () => {
    const r = await classifyHoldingHandler({
      holdings: [
        { ticker: "PENY", market_value_usd: 2000, is_penny_stock: true },
      ],
      portfolio_total_usd: 100000,
    });

    expect(r.holdings[0]!.tier).toBe("PURE_SPECULATIVE");
  });

  it("penny stock with thesis gets normal classification", async () => {
    const r = await classifyHoldingHandler({
      holdings: [
        { ticker: "PENY", market_value_usd: 5000, has_active_thesis: true, is_penny_stock: true },
      ],
      portfolio_total_usd: 100000,
    });

    expect(r.holdings[0]!.tier).toBe("OPPORTUNISTIC");
  });

  it("returns tier_summary grouped correctly", async () => {
    const r = await classifyHoldingHandler({
      holdings: [
        { ticker: "AAPL", market_value_usd: 30000, has_active_thesis: true },
        { ticker: "MSFT", market_value_usd: 15000, has_active_thesis: true },
        { ticker: "AG", market_value_usd: 5000, has_active_thesis: false },
      ],
      portfolio_total_usd: 100000,
    });

    const coreSummary = r.tier_summary.find((s: any) => s.tier === "CORE");
    expect(coreSummary!.count).toBe(2);
    expect(coreSummary!.tickers).toContain("AAPL");
    expect(coreSummary!.tickers).toContain("MSFT");
  });

  it("sorts holdings by NAV weight descending", async () => {
    const r = await classifyHoldingHandler({
      holdings: [
        { ticker: "C", market_value_usd: 1000 },
        { ticker: "A", market_value_usd: 50000, has_active_thesis: true },
        { ticker: "B", market_value_usd: 10000 },
      ],
      portfolio_total_usd: 100000,
    });

    expect(r.holdings.map((h: any) => h.ticker)).toEqual(["A", "B", "C"]);
  });

  it("respects custom tier thresholds", async () => {
    const r = await classifyHoldingHandler({
      holdings: [
        { ticker: "SMALL", market_value_usd: 6000, has_active_thesis: true },
      ],
      portfolio_total_usd: 100000,
      tier_thresholds: { core_min_pct: 5, opportunistic_min_pct: 2, speculative_min_pct: 0.5 },
    });

    expect(r.holdings[0]!.tier).toBe("CORE");
  });

  it("handles empty holdings", async () => {
    const r = await classifyHoldingHandler({
      holdings: [],
      portfolio_total_usd: 100000,
    });

    expect(r.holdings).toHaveLength(0);
    expect(r.tier_summary).toHaveLength(0);
  });
});
