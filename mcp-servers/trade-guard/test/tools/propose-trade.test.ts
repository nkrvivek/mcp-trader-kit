import { describe, expect, it } from "vitest";
import { proposeTradeHandler } from "../../src/tools/propose-trade.js";
import type { Profile } from "../../src/profiles/schema.js";

const PROFILE: Profile = {
  name: "personal", broker: "snaptrade",
  account_id: "22222222-2222-2222-2222-222222222222",
  tax_entity: "personal",
  caps: { max_order_notional: 10000, max_single_name_pct: 25, forbidden_tools: [], forbidden_leg_shapes: [] },
};

const deps = { allProfiles: [PROFILE] };

describe("proposeTradeHandler", () => {
  it("produces a CANDIDATE with correct sizing", async () => {
    const r = await proposeTradeHandler({
      profile: "personal",
      ticker: "NVDA",
      direction: "BUY",
      current_price: 100,
      portfolio_total_usd: 100000,
      existing_ticker_exposure_usd: 10000,
    }, deps);

    expect(r.status).toBe("CANDIDATE");
    expect(r.shares).toBeGreaterThan(0);
    expect(r.sizing.headroom_pct).toBe(15);
    expect(r.sizing.regime_multiplier).toBe(1.0);
    expect(r.concentration.current_pct).toBe(10);
    expect(r.concentration.label).toBe("HEADROOM");
  });

  it("applies regime multiplier in CAUTION", async () => {
    const clear = await proposeTradeHandler({
      profile: "personal", ticker: "NVDA", direction: "BUY",
      current_price: 100, portfolio_total_usd: 100000,
      existing_ticker_exposure_usd: 0, regime_tier: "CLEAR",
    }, deps);

    const caution = await proposeTradeHandler({
      profile: "personal", ticker: "NVDA", direction: "BUY",
      current_price: 100, portfolio_total_usd: 100000,
      existing_ticker_exposure_usd: 0, regime_tier: "CAUTION",
    }, deps);

    expect(caution.sizing.adjusted_size_usd).toBeLessThan(clear.sizing.adjusted_size_usd);
    expect(caution.sizing.regime_multiplier).toBe(0.75);
  });

  it("rejects BUY in DEFENSIVE regime", async () => {
    const r = await proposeTradeHandler({
      profile: "personal", ticker: "NVDA", direction: "BUY",
      current_price: 100, portfolio_total_usd: 100000,
      regime_tier: "DEFENSIVE",
    }, deps);

    expect(r.status).toBe("REJECTED");
    expect(r.reason).toContain("blocked");
  });

  it("rejects when over cap", async () => {
    const r = await proposeTradeHandler({
      profile: "personal", ticker: "AAPL", direction: "BUY",
      current_price: 200, portfolio_total_usd: 100000,
      existing_ticker_exposure_usd: 30000,
    }, deps);

    expect(r.status).toBe("REJECTED");
    expect(r.reason).toContain("exceeds");
    expect(r.concentration.label).toBe("OVER-CAP");
  });

  it("caps notional at max_order_notional", async () => {
    const r = await proposeTradeHandler({
      profile: "personal", ticker: "SPY", direction: "BUY",
      current_price: 10, portfolio_total_usd: 1000000,
      existing_ticker_exposure_usd: 0,
    }, deps);

    expect(r.status).toBe("CANDIDATE");
    expect(r.notional_usd).toBeLessThanOrEqual(10000);
    expect(r.cap_check).toBe("PASS");
  });

  it("rejects unknown profile", async () => {
    const r = await proposeTradeHandler({
      profile: "unknown", ticker: "NVDA", direction: "BUY",
      current_price: 100, portfolio_total_usd: 100000,
    }, deps);

    expect(r.status).toBe("REJECTED");
    expect(r.reason).toContain("unknown profile");
  });

  it("allows SELL in any regime", async () => {
    const r = await proposeTradeHandler({
      profile: "personal", ticker: "NVDA", direction: "SELL",
      current_price: 100, portfolio_total_usd: 100000,
      existing_ticker_exposure_usd: 20000, regime_tier: "HALT",
    }, deps);

    expect(r.status).toBe("CANDIDATE");
  });

  it("includes thesis_ref and signal_summary when provided", async () => {
    const r = await proposeTradeHandler({
      profile: "personal", ticker: "AG", direction: "BUY",
      current_price: 25, portfolio_total_usd: 100000,
      thesis_ref: "silver-inflation-hedge",
      signal_summary: "UW flow spike + darkpool block",
    }, deps);

    expect(r.thesis_ref).toBe("silver-inflation-hedge");
    expect(r.signal_summary).toBe("UW flow spike + darkpool block");
  });
});
