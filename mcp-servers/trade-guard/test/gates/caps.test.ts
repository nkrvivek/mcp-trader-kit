import { describe, expect, it } from "vitest";
import { checkCaps, type TradeProposal } from "../../src/gates/caps.js";
import type { Profile } from "../../src/profiles/schema.js";

const BILDOF: Profile = {
  name: "bildof", broker: "snaptrade",
  account_id: "11111111-1111-1111-1111-111111111111",
  tax_entity: "llc-bildof",
  caps: { max_order_notional: 5000, max_single_name_pct: 10, forbidden_tools: [], forbidden_leg_shapes: ["naked_put"] },
};

const TRADE: TradeProposal = {
  tool: "mleg_place",
  ticker: "AAPL",
  direction: "SELL_TO_OPEN",
  qty: 1,
  notional_usd: 3000,
  leg_shape: "covered_call",
  portfolio_total_usd: 100000,
  existing_ticker_exposure_usd: 0,
};

describe("checkCaps", () => {
  it("passes when under all caps", () => {
    expect(checkCaps(BILDOF, TRADE)).toEqual({ pass: true, reasons: [], warnings: [] });
  });

  it("rejects when notional exceeds cap", () => {
    const r = checkCaps(BILDOF, { ...TRADE, notional_usd: 6000 });
    expect(r.pass).toBe(false);
    expect(r.reasons[0]).toMatch(/notional \$6,000 > cap \$5,000/);
  });

  it("rejects when post-trade single-name pct exceeds cap", () => {
    const r = checkCaps(BILDOF, { ...TRADE, existing_ticker_exposure_usd: 9000, notional_usd: 2000 });
    expect(r.pass).toBe(false);
    expect(r.reasons.some((x) => /single-name/.test(x))).toBe(true);
  });

  it("rejects when tool is forbidden", () => {
    const p = { ...BILDOF, caps: { ...BILDOF.caps, forbidden_tools: ["mleg_place"] } };
    const r = checkCaps(p, TRADE);
    expect(r.pass).toBe(false);
    expect(r.reasons[0]).toMatch(/forbidden tool/);
  });

  it("rejects when leg shape is forbidden", () => {
    const r = checkCaps(BILDOF, { ...TRADE, leg_shape: "naked_put" });
    expect(r.pass).toBe(false);
    expect(r.reasons[0]).toMatch(/naked_put/);
  });

  it("accumulates multiple failures", () => {
    const r = checkCaps(BILDOF, { ...TRADE, notional_usd: 6000, leg_shape: "naked_put" });
    expect(r.pass).toBe(false);
    expect(r.reasons.length).toBeGreaterThanOrEqual(2);
  });

  it("passes when no portfolio total provided (skips concentration)", () => {
    const r = checkCaps(BILDOF, { ...TRADE, portfolio_total_usd: 0 });
    expect(r.pass).toBe(true);
    expect(r.warnings[0]).toMatch(/portfolio total missing/);
  });
});
