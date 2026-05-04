import { describe, expect, it } from "vitest";
import { reflectTradesHandler } from "../../src/tools/reflect-trades.js";

describe("reflectTradesHandler", () => {
  it("returns empty summary when no trades provided", async () => {
    const r = await reflectTradesHandler({ book: "personal", lookback_days: 30, trades: [] });
    expect(r.summary.total_trades).toBe(0);
    expect(r.lessons).toHaveLength(0);
    expect(r.r_rule_breaches).toHaveLength(0);
  });

  it("aggregates win-rate + total P&L correctly", async () => {
    const r = await reflectTradesHandler({
      book: "bildof",
      lookback_days: 30,
      trades: [
        { ticker: "AAPL", structure: "covered_call", outcome: "WIN_MANAGED", pnl_usd: 250 },
        { ticker: "PLTR", structure: "cash_secured_put", outcome: "WIN_EXPIRED", pnl_usd: 150 },
        { ticker: "BBAI", structure: "short_put", outcome: "LOSS_ASSIGNED", pnl_usd: -800 },
      ],
    });
    expect(r.summary.total_trades).toBe(3);
    expect(r.summary.wins).toBe(2);
    expect(r.summary.losses).toBe(1);
    expect(r.summary.win_rate_pct).toBeCloseTo(66.7, 0);
    expect(r.summary.total_pnl_usd).toBe(-400);
  });

  it("surfaces R-rule breaches w/ examples + severity", async () => {
    const r = await reflectTradesHandler({
      book: "personal",
      lookback_days: 30,
      trades: [
        { ticker: "BBAI", outcome: "LOSS_ASSIGNED", pnl_usd: -500, r_rule_breaches: ["R3"], closed_at: "2026-04-17" },
        { ticker: "PLTR", outcome: "LOSS_ROLLED", pnl_usd: -200, r_rule_breaches: ["R3"], closed_at: "2026-04-20" },
        { ticker: "AAPL", outcome: "LOSS_ASSIGNED", pnl_usd: -100, r_rule_breaches: ["R3", "R7"], closed_at: "2026-04-25" },
      ],
    });
    const r3 = r.r_rule_breaches.find((b) => b.rule === "R3");
    expect(r3).toBeDefined();
    expect(r3!.count).toBe(3);
    expect(r3!.examples.length).toBeGreaterThan(0);
    expect(r.lessons.find((l) => l.id === "lesson-R3")?.severity).toBe("high");
  });

  it("flags revenge roll pattern", async () => {
    const r = await reflectTradesHandler({
      book: "personal",
      lookback_days: 30,
      trades: [
        { ticker: "BBAI", structure: "short_put", outcome: "LOSS_ROLLED", pnl_usd: -300, roll_count: 3 },
        { ticker: "BBAI", structure: "short_put", outcome: "LOSS_ASSIGNED", pnl_usd: -800, roll_count: 4 },
      ],
    });
    expect(r.summary.revenge_roll_count).toBe(2);
    expect(r.lessons.some((l) => l.category === "revenge_roll")).toBe(true);
  });

  it("flags HALT-regime entries", async () => {
    const r = await reflectTradesHandler({
      book: "personal",
      lookback_days: 30,
      trades: [
        { ticker: "X", outcome: "LOSS_STOPPED", pnl_usd: -500, regime_tier_at_open: "HALT" },
      ],
    });
    expect(r.summary.halt_regime_entries).toBe(1);
    expect(r.pattern_drift_alerts.some((a) => a.includes("HALT"))).toBe(true);
  });

  it("detects ticker concentration in losses", async () => {
    const r = await reflectTradesHandler({
      book: "personal",
      lookback_days: 30,
      trades: [
        { ticker: "BBAI", outcome: "LOSS_ASSIGNED", pnl_usd: -200 },
        { ticker: "BBAI", outcome: "LOSS_STOPPED", pnl_usd: -300 },
        { ticker: "BBAI", outcome: "LOSS_ROLLED", pnl_usd: -150 },
      ],
    });
    expect(r.pattern_drift_alerts.some((a) => a.includes("BBAI") && a.includes("3 losses"))).toBe(true);
  });
});
