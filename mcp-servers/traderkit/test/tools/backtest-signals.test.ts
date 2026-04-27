import { describe, expect, it } from "vitest";
import { backtestSignalsHandler } from "../../src/tools/backtest-signals.js";

describe("backtestSignalsHandler", () => {
  it("computes per-tier hit rate + avg pnl", async () => {
    const r = await backtestSignalsHandler({
      history: [
        { ticker: "AAPL", entry_date: "2026-01-15", tier_at_entry: "CORE", realized_pnl_usd: 200 },
        { ticker: "NVDA", entry_date: "2026-01-20", tier_at_entry: "CORE", realized_pnl_usd: 300 },
        { ticker: "TSLA", entry_date: "2026-02-01", tier_at_entry: "CORE", realized_pnl_usd: -100 },
        { ticker: "MSFT", entry_date: "2026-02-10", tier_at_entry: "TIER-1", realized_pnl_usd: 50 },
        { ticker: "GOOG", entry_date: "2026-02-15", tier_at_entry: "TIER-1", realized_pnl_usd: -80 },
      ],
    });
    const core = r.tier_stats.find((t) => t.tier === "CORE")!;
    expect(core.trade_count).toBe(3);
    expect(core.win_count).toBe(2);
    expect(core.loss_count).toBe(1);
    expect(core.hit_rate).toBeCloseTo(0.67, 1);
    expect(core.total_pnl_usd).toBe(400);
  });

  it("flags calibration warning when lower tier outperforms higher", async () => {
    const r = await backtestSignalsHandler({
      history: [
        { ticker: "A", entry_date: "2026-01-01", tier_at_entry: "CORE", realized_pnl_usd: -100 },
        { ticker: "B", entry_date: "2026-01-02", tier_at_entry: "CORE", realized_pnl_usd: -100 },
        { ticker: "C", entry_date: "2026-01-03", tier_at_entry: "CORE", realized_pnl_usd: 50 },
        { ticker: "D", entry_date: "2026-01-04", tier_at_entry: "TIER-1", realized_pnl_usd: 100 },
        { ticker: "E", entry_date: "2026-01-05", tier_at_entry: "TIER-1", realized_pnl_usd: 100 },
        { ticker: "F", entry_date: "2026-01-06", tier_at_entry: "TIER-1", realized_pnl_usd: 100 },
      ],
    });
    expect(r.calibration_warnings.length).toBeGreaterThan(0);
    expect(r.interpretation).toContain("Calibration issues");
  });

  it("computes tier-gate impact (pnl saved by skipping WATCH/NOISE)", async () => {
    const r = await backtestSignalsHandler({
      history: [
        { ticker: "A", entry_date: "2026-01-01", tier_at_entry: "CORE", realized_pnl_usd: 200 },
        { ticker: "B", entry_date: "2026-01-02", tier_at_entry: "TIER-1", realized_pnl_usd: 100 },
        { ticker: "C", entry_date: "2026-01-03", tier_at_entry: "WATCH", realized_pnl_usd: -50 },
        { ticker: "D", entry_date: "2026-01-04", tier_at_entry: "NOISE", realized_pnl_usd: -100 },
      ],
    });
    expect(r.tier_gate_impact.tier_eligible_count).toBe(2);
    expect(r.tier_gate_impact.tier_eligible_pnl_usd).toBe(300);
    expect(r.tier_gate_impact.watch_noise_count).toBe(2);
    expect(r.tier_gate_impact.watch_noise_pnl_usd).toBe(-150);
    expect(r.tier_gate_impact.gate_pnl_savings_usd).toBe(150);
  });

  it("computes direction accuracy when predicted+realized supplied", async () => {
    const r = await backtestSignalsHandler({
      history: [
        { ticker: "A", entry_date: "2026-01-01", tier_at_entry: "CORE",
          realized_pnl_usd: 100, predicted_direction: "BULLISH", realized_direction: "BULLISH" },
        { ticker: "B", entry_date: "2026-01-02", tier_at_entry: "CORE",
          realized_pnl_usd: 50, predicted_direction: "BULLISH", realized_direction: "BULLISH" },
        { ticker: "C", entry_date: "2026-01-03", tier_at_entry: "CORE",
          realized_pnl_usd: -50, predicted_direction: "BULLISH", realized_direction: "BEARISH" },
      ],
    });
    const core = r.tier_stats.find((t) => t.tier === "CORE")!;
    expect(core.direction_accuracy).toBeCloseTo(0.67, 1);
  });

  it("computes avg return pct when supplied", async () => {
    const r = await backtestSignalsHandler({
      history: [
        { ticker: "A", entry_date: "2026-01-01", tier_at_entry: "CORE",
          realized_pnl_usd: 100, realized_return_pct: 5 },
        { ticker: "B", entry_date: "2026-01-02", tier_at_entry: "CORE",
          realized_pnl_usd: 200, realized_return_pct: 10 },
      ],
    });
    const core = r.tier_stats.find((t) => t.tier === "CORE")!;
    expect(core.avg_return_pct).toBe(7.5);
  });

  it("handles empty tiers gracefully", async () => {
    const r = await backtestSignalsHandler({
      history: [
        { ticker: "A", entry_date: "2026-01-01", tier_at_entry: "CORE", realized_pnl_usd: 100 },
      ],
    });
    const noise = r.tier_stats.find((t) => t.tier === "NOISE")!;
    expect(noise.trade_count).toBe(0);
    expect(noise.hit_rate).toBe(0);
    expect(noise.avg_return_pct).toBeNull();
  });

  it("interprets monotonic tiers as well-calibrated", async () => {
    const r = await backtestSignalsHandler({
      history: [
        { ticker: "A", entry_date: "2026-01-01", tier_at_entry: "CORE", realized_pnl_usd: 100 },
        { ticker: "B", entry_date: "2026-01-02", tier_at_entry: "CORE", realized_pnl_usd: 100 },
        { ticker: "C", entry_date: "2026-01-03", tier_at_entry: "CORE", realized_pnl_usd: 100 },
        { ticker: "D", entry_date: "2026-01-04", tier_at_entry: "TIER-1", realized_pnl_usd: 50 },
        { ticker: "E", entry_date: "2026-01-05", tier_at_entry: "TIER-1", realized_pnl_usd: 50 },
        { ticker: "F", entry_date: "2026-01-06", tier_at_entry: "TIER-1", realized_pnl_usd: -10 },
      ],
    });
    expect(r.calibration_warnings).toHaveLength(0);
    expect(r.interpretation).toContain("monotonic");
  });

  it("respects custom win_threshold_usd", async () => {
    const r = await backtestSignalsHandler({
      history: [
        { ticker: "A", entry_date: "2026-01-01", tier_at_entry: "CORE", realized_pnl_usd: 5 },
        { ticker: "B", entry_date: "2026-01-02", tier_at_entry: "CORE", realized_pnl_usd: 50 },
      ],
      win_threshold_usd: 25,
    });
    const core = r.tier_stats.find((t) => t.tier === "CORE")!;
    expect(core.win_count).toBe(1);
  });
});
