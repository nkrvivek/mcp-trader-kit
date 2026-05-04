import { describe, expect, it } from "vitest";
import { riskDebate3StanceHandler } from "../../src/tools/risk-debate-3stance.js";

describe("riskDebate3StanceHandler", () => {
  it("BLOCKs all 3 stances when R-violations present", async () => {
    const r = await riskDebate3StanceHandler({
      proposal: { ticker: "BBAI", structure: "short_put", direction: "SELL_TO_OPEN", notional_usd: 5000, contracts: 1 },
      regime_tier: "CLEAR",
      r_violations: ["R3"],
    });
    expect(r.consensus_verdict).toBe("BLOCK");
    expect(r.size_multiplier).toBe(0);
    expect(r.aggressive.verdict).toBe("BLOCK");
    expect(r.conservative.verdict).toBe("BLOCK");
    expect(r.neutral.verdict).toBe("BLOCK");
    expect(r.hard_blocks.some((h) => h.includes("R3"))).toBe(true);
  });

  it("BLOCKs new opening buy under HALT regime", async () => {
    const r = await riskDebate3StanceHandler({
      proposal: { ticker: "AAPL", structure: "long_stock", direction: "BUY_TO_OPEN", notional_usd: 10000, contracts: 0 },
      regime_tier: "HALT",
    });
    expect(r.consensus_verdict).toBe("BLOCK");
    expect(r.hard_blocks).toContain("REGIME_HALT_OPENING_BUY");
  });

  it("BLOCKs when margin debit detected", async () => {
    const r = await riskDebate3StanceHandler({
      proposal: { ticker: "AAPL", direction: "BUY_TO_OPEN", notional_usd: 10000, contracts: 0 },
      portfolio_state: { margin_drawn_usd: 500 },
      regime_tier: "CLEAR",
    });
    expect(r.consensus_verdict).toBe("BLOCK");
    expect(r.hard_blocks.some((h) => h.startsWith("MARGIN_DEBIT"))).toBe(true);
  });

  it("APPROVEs CLEAR + Buy/4 + headroom + no violations near full size", async () => {
    const r = await riskDebate3StanceHandler({
      proposal: { ticker: "PLTR", structure: "covered_call", direction: "SELL_TO_OPEN", notional_usd: 5000, contracts: 1 },
      portfolio_state: { ticker_pct: 4.5, tier_cap_pct: 10 },
      regime_tier: "CLEAR",
      research_manager: { rating: "Buy", conviction: 4, signal_score: 65 },
    });
    expect(r.consensus_verdict).not.toBe("BLOCK");
    expect(r.size_multiplier).toBeGreaterThan(0.5);
    expect(r.aggressive.verdict).toBe("APPROVE");
  });

  it("MODIFYs sizing in CAUTION regime + tight headroom", async () => {
    const r = await riskDebate3StanceHandler({
      proposal: { ticker: "AAPL", structure: "covered_call", direction: "SELL_TO_OPEN", notional_usd: 5000, contracts: 1 },
      portfolio_state: { ticker_pct: 38, tier_cap_pct: 40 },
      regime_tier: "CAUTION",
      research_manager: { rating: "Overweight", conviction: 3, signal_score: 55 },
    });
    expect(["MODIFY", "BLOCK"]).toContain(r.consensus_verdict);
    expect(r.size_multiplier).toBeLessThan(0.85);
    expect(r.conservative.size_multiplier).toBeLessThanOrEqual(0.5);
  });

  it("BLOCKs when signal score is sub-TIER-1", async () => {
    const r = await riskDebate3StanceHandler({
      proposal: { ticker: "X", direction: "BUY_TO_OPEN", notional_usd: 1000, contracts: 0 },
      regime_tier: "CLEAR",
      research_manager: { rating: "Buy", conviction: 5, signal_score: 25 },
    });
    expect(r.consensus_verdict).toBe("BLOCK");
    expect(r.size_multiplier).toBe(0);
  });

  it("BLOCKs over-cap concentration", async () => {
    const r = await riskDebate3StanceHandler({
      proposal: { ticker: "AAPL", direction: "BUY_TO_OPEN", notional_usd: 5000, contracts: 0 },
      portfolio_state: { ticker_pct: 42, tier_cap_pct: 40 },
      regime_tier: "CLEAR",
    });
    expect(r.consensus_verdict).toBe("BLOCK");
    expect(r.hard_blocks.some((h) => h.includes("OVER_CAP"))).toBe(true);
  });
});
