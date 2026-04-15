import { describe, expect, it } from "vitest";
import { composeCheckTrade } from "../../src/gates/compose.js";
import type { Profile } from "../../src/profiles/schema.js";

const BILDOF: Profile = {
  name: "bildof", broker: "snaptrade",
  account_id: "11111111-1111-1111-1111-111111111111",
  tax_entity: "llc-bildof",
  caps: { max_order_notional: 5000, max_single_name_pct: 10, forbidden_tools: [], forbidden_leg_shapes: [] },
};

describe("composeCheckTrade", () => {
  it("passes clean trade", async () => {
    const r = await composeCheckTrade({
      profile: BILDOF,
      allProfiles: [BILDOF],
      trade: {
        tool: "mleg_place", ticker: "AAPL",
        direction: "SELL_TO_OPEN", qty: 1, notional_usd: 3000,
        portfolio_total_usd: 100000, existing_ticker_exposure_usd: 0,
      },
      fetchActivities: async () => [],
    });
    expect(r.pass).toBe(true);
  });

  it("composes caps + wash-sale reasons", async () => {
    const r = await composeCheckTrade({
      profile: BILDOF,
      allProfiles: [BILDOF],
      trade: {
        tool: "equity_force_place", ticker: "AAPL",
        direction: "BUY", qty: 10, notional_usd: 20000,
        portfolio_total_usd: 100000, existing_ticker_exposure_usd: 0,
      },
      fetchActivities: async () => [
        { symbol: "AAPL", action: "SELL", quantity: 10, price: 150, realized_pnl: -500,
          trade_date: new Date().toISOString().slice(0, 10), account_id: BILDOF.account_id },
      ],
    });
    expect(r.pass).toBe(false);
    expect(r.reasons.some((x) => /notional/.test(x))).toBe(true);
    expect(r.reasons.some((x) => /wash/i.test(x))).toBe(true);
  });

  it("warns but passes when activities fetch fails and require=false", async () => {
    const r = await composeCheckTrade({
      profile: BILDOF,
      allProfiles: [BILDOF],
      trade: {
        tool: "equity_force_place", ticker: "AAPL", direction: "BUY",
        qty: 1, notional_usd: 100, portfolio_total_usd: 100000, existing_ticker_exposure_usd: 0,
      },
      fetchActivities: async () => { throw new Error("snaptrade-read down"); },
      requireWashSaleCheck: false,
    });
    expect(r.pass).toBe(true);
    expect(r.warnings.some((x) => /wash-sale check unavailable/.test(x))).toBe(true);
  });

  it("rejects when activities fetch fails and require=true", async () => {
    const r = await composeCheckTrade({
      profile: BILDOF,
      allProfiles: [BILDOF],
      trade: {
        tool: "equity_force_place", ticker: "AAPL", direction: "BUY",
        qty: 1, notional_usd: 100, portfolio_total_usd: 100000, existing_ticker_exposure_usd: 0,
      },
      fetchActivities: async () => { throw new Error("snaptrade-read down"); },
      requireWashSaleCheck: true,
    });
    expect(r.pass).toBe(false);
    expect(r.reasons[0]).toMatch(/wash-sale check required/);
  });
});
