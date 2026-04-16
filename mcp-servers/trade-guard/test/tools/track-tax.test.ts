import { describe, expect, it } from "vitest";
import { trackTaxHandler } from "../../src/tools/track-tax.js";

describe("trackTaxHandler", () => {
  it("separates STCG and LTCG by hold_days", async () => {
    const r = await trackTaxHandler({
      trades: [
        { ticker: "AAPL", realized_pnl: 1000, hold_days: 30, date: "2026-03-01" },
        { ticker: "MSFT", realized_pnl: 2000, hold_days: 400, date: "2026-03-15" },
      ],
    });

    expect(r.summary.stcg.total_pnl).toBe(1000);
    expect(r.summary.ltcg.total_pnl).toBe(2000);
    expect(r.summary.stcg.count).toBe(1);
    expect(r.summary.ltcg.count).toBe(1);
  });

  it("computes reserves at correct rates", async () => {
    const r = await trackTaxHandler({
      trades: [
        { ticker: "AAPL", realized_pnl: 10000, hold_days: 30, date: "2026-03-01" },
      ],
      stcg_rate: 0.358,
    });

    expect(r.summary.stcg.reserve).toBe(3580);
    expect(r.summary.total_tax_reserve).toBe(3580);
  });

  it("handles losses correctly — no reserve on net loss", async () => {
    const r = await trackTaxHandler({
      trades: [
        { ticker: "AAPL", realized_pnl: -5000, hold_days: 30, date: "2026-03-01" },
        { ticker: "NVDA", realized_pnl: 2000, hold_days: 30, date: "2026-03-15" },
      ],
    });

    expect(r.summary.stcg.total_pnl).toBe(-3000);
    expect(r.summary.stcg.gain).toBe(2000);
    expect(r.summary.stcg.loss).toBe(-5000);
    expect(r.summary.stcg.reserve).toBe(0);
  });

  it("tracks wash_sale_adjusted count", async () => {
    const r = await trackTaxHandler({
      trades: [
        { ticker: "AG", realized_pnl: -500, hold_days: 30, date: "2026-03-01", wash_sale_adjusted: true },
        { ticker: "AAPL", realized_pnl: 1000, hold_days: 30, date: "2026-03-15" },
      ],
    });

    expect(r.wash_sale_count).toBe(1);
  });

  it("sorts breakdown by date", async () => {
    const r = await trackTaxHandler({
      trades: [
        { ticker: "MSFT", realized_pnl: 500, hold_days: 30, date: "2026-04-01" },
        { ticker: "AAPL", realized_pnl: 1000, hold_days: 30, date: "2026-01-15" },
      ],
    });

    expect(r.breakdown[0]!.ticker).toBe("AAPL");
    expect(r.breakdown[1]!.ticker).toBe("MSFT");
  });

  it("computes effective rate", async () => {
    const r = await trackTaxHandler({
      trades: [
        { ticker: "AAPL", realized_pnl: 5000, hold_days: 30, date: "2026-03-01" },
        { ticker: "MSFT", realized_pnl: 5000, hold_days: 400, date: "2026-03-15" },
      ],
      stcg_rate: 0.358,
      ltcg_rate: 0.188,
    });

    expect(r.summary.net_realized_pnl).toBe(10000);
    expect(r.summary.effective_rate).toBeGreaterThan(0.18);
    expect(r.summary.effective_rate).toBeLessThan(0.36);
  });

  it("handles empty trades", async () => {
    const r = await trackTaxHandler({ trades: [] });

    expect(r.summary.net_realized_pnl).toBe(0);
    expect(r.summary.total_tax_reserve).toBe(0);
    expect(r.breakdown).toHaveLength(0);
  });
});
