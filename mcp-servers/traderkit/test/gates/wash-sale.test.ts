import { describe, expect, it } from "vitest";
import { checkWashSale, type WashSaleContext } from "../../src/gates/wash-sale.js";
import type { Profile } from "../../src/profiles/schema.js";
import type { Activity } from "../../src/mcp/snaptrade-read-client.js";

const BILDOF: Profile = {
  name: "bildof", broker: "snaptrade",
  account_id: "11111111-1111-1111-1111-111111111111",
  tax_entity: "llc-bildof",
  caps: { max_order_notional: 5000, max_single_name_pct: 10, forbidden_tools: [], forbidden_leg_shapes: [] },
};
const PERSONAL: Profile = {
  ...BILDOF, name: "personal", tax_entity: "personal",
  account_id: "22222222-2222-2222-2222-222222222222",
};
const PERSONAL2: Profile = {
  ...BILDOF, name: "personal-ira", tax_entity: "personal",
  account_id: "33333333-3333-3333-3333-333333333333",
};

const NOW = new Date("2026-04-14T12:00:00Z");

const LOSS_SELL_AAPL_IN_PERSONAL: Activity = {
  symbol: "AAPL", action: "SELL", quantity: 10, price: 150, realized_pnl: -500,
  trade_date: "2026-04-01", account_id: PERSONAL.account_id,
};
const GAIN_SELL_AAPL_IN_PERSONAL: Activity = {
  ...LOSS_SELL_AAPL_IN_PERSONAL, realized_pnl: 100, trade_date: "2026-04-05",
};
const LOSS_SELL_AAPL_IN_BILDOF: Activity = {
  ...LOSS_SELL_AAPL_IN_PERSONAL, account_id: BILDOF.account_id,
};
const LOSS_SELL_AAPL_35D_AGO: Activity = {
  ...LOSS_SELL_AAPL_IN_PERSONAL, trade_date: "2026-03-10",
};

describe("checkWashSale", () => {
  const ctxBuy = (activities: Activity[], profile: Profile = PERSONAL): WashSaleContext => ({
    action: "BUY",
    ticker: "AAPL",
    tradeDate: NOW,
    activeProfile: profile,
    allProfiles: [PERSONAL, PERSONAL2, BILDOF],
    activities,
  });

  it("flags BUY when same-entity loss sell within ±30d", () => {
    const r = checkWashSale(ctxBuy([LOSS_SELL_AAPL_IN_PERSONAL]));
    expect(r.flagged).toBe(true);
    expect(r.detail).toMatch(/AAPL/);
  });

  it("does NOT flag BUY when loss sell is in different tax entity", () => {
    const r = checkWashSale(ctxBuy([LOSS_SELL_AAPL_IN_BILDOF]));
    expect(r.flagged).toBe(false);
  });

  it("does NOT flag BUY when prior sell was a gain", () => {
    const r = checkWashSale(ctxBuy([GAIN_SELL_AAPL_IN_PERSONAL]));
    expect(r.flagged).toBe(false);
  });

  it("does NOT flag BUY when loss sell > 30 days ago", () => {
    const r = checkWashSale(ctxBuy([LOSS_SELL_AAPL_35D_AGO]));
    expect(r.flagged).toBe(false);
  });

  it("pools same-tax-entity accounts for BUY check", () => {
    const other: Activity = { ...LOSS_SELL_AAPL_IN_PERSONAL, account_id: PERSONAL2.account_id };
    const r = checkWashSale(ctxBuy([other]));
    expect(r.flagged).toBe(true);
    expect(r.detail).toMatch(/personal-ira|personal/);
  });

  it("flags SELL at loss when recent BUY within ±30d same entity", () => {
    const buy: Activity = {
      symbol: "AAPL", action: "BUY", quantity: 10, price: 200,
      trade_date: "2026-04-10", account_id: PERSONAL.account_id,
    };
    const r = checkWashSale({
      action: "SELL", ticker: "AAPL", tradeDate: NOW,
      activeProfile: PERSONAL, allProfiles: [PERSONAL, PERSONAL2, BILDOF],
      activities: [buy], sellAtLoss: true,
    });
    expect(r.flagged).toBe(true);
  });

  it("does NOT flag SELL at gain regardless of prior activity", () => {
    const buy: Activity = {
      symbol: "AAPL", action: "BUY", quantity: 10, price: 200,
      trade_date: "2026-04-10", account_id: PERSONAL.account_id,
    };
    const r = checkWashSale({
      action: "SELL", ticker: "AAPL", tradeDate: NOW,
      activeProfile: PERSONAL, allProfiles: [PERSONAL, PERSONAL2, BILDOF],
      activities: [buy], sellAtLoss: false,
    });
    expect(r.flagged).toBe(false);
  });

  it("matches options on same underlying as substantially identical", () => {
    const optLoss: Activity = {
      symbol: "AAPL 2026-06-19 150 C", underlying_symbol: "AAPL",
      action: "SELL", quantity: 1, price: 2.5, realized_pnl: -200,
      trade_date: "2026-04-01", account_id: PERSONAL.account_id,
    };
    const r = checkWashSale(ctxBuy([optLoss]));
    expect(r.flagged).toBe(true);
  });
});
