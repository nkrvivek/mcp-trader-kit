import { describe, expect, it } from "vitest";
import { explainPayoffHandler } from "../../src/tools/explain-payoff.js";

describe("explainPayoffHandler", () => {
  it("covered_call: narrates both outcomes + computes breakeven", async () => {
    const r: any = await explainPayoffHandler({
      ticker: "AAPL",
      structure: "covered_call",
      spot: 190,
      strike: 195,
      premium: 1.8,
      shares: 100,
      cost_basis: 185,
      dte: 30,
    });
    expect(r.structure).toBe("covered_call");
    expect(r.breakeven).toBe(183.2);
    expect(r.max_profit_usd).toBeGreaterThan(0);
    expect(r.capital_at_risk_usd).toBe(18500);
    expect(r.scenarios).toHaveLength(3);
    expect(r.narrative.join(" ")).toMatch(/Sell 1 call/);
  });

  it("cash_secured_put: max loss = (strike - premium) * 100 * contracts", async () => {
    const r: any = await explainPayoffHandler({
      ticker: "SLV",
      structure: "cash_secured_put",
      spot: 28,
      strike: 27,
      premium: 0.5,
      contracts: 5,
    });
    expect(r.max_loss_usd).toBe(13250);
    expect(r.max_profit_usd).toBe(250);
    expect(r.breakeven).toBe(26.5);
    expect(r.capital_at_risk_usd).toBe(13500);
  });

  it("put_credit_spread: rejects long_strike >= short_strike", async () => {
    await expect(
      explainPayoffHandler({
        ticker: "SPY",
        structure: "put_credit_spread",
        spot: 500,
        short_strike: 480,
        long_strike: 485,
        premium: 1.0,
      })
    ).rejects.toThrow(/long_strike must be below/);
  });

  it("put_credit_spread: max loss = width - credit", async () => {
    const r: any = await explainPayoffHandler({
      ticker: "SPY",
      structure: "put_credit_spread",
      spot: 500,
      short_strike: 480,
      long_strike: 475,
      premium: 1.0,
      contracts: 2,
    });
    expect(r.max_profit_usd).toBe(200);
    expect(r.max_loss_usd).toBe(800);
    expect(r.breakeven).toBe(479);
  });

  it("call_credit_spread: bearish narrative", async () => {
    const r: any = await explainPayoffHandler({
      ticker: "TSLA",
      structure: "call_credit_spread",
      spot: 240,
      short_strike: 250,
      long_strike: 260,
      premium: 2.0,
    });
    expect(r.breakeven).toBe(252);
    expect(r.narrative.join(" ")).toMatch(/Bearish/);
  });

  it("long_stock: explains upside + downside symmetrically", async () => {
    const r: any = await explainPayoffHandler({
      ticker: "MSFT",
      structure: "long_stock",
      spot: 430,
      shares: 50,
      cost_basis: 430,
    });
    expect(r.breakeven).toBe(430);
    expect(r.max_loss_usd).toBe(21500);
    expect(r.max_profit_usd).toBeNull();
  });
});
