import { describe, expect, it } from "vitest";
import { rviGapHandler } from "../../src/tools/rvi-gap.js";

describe("rviGapHandler", () => {
  it("computes gap + ratio when no history supplied", async () => {
    const r = await rviGapHandler({
      ticker: "AAPL",
      iv_30d: 0.30,
      hv_30d: 0.20,
    });
    expect(r.rvi_gap).toBe(0.1);
    expect(r.rvi_ratio).toBe(1.5);
    expect(r.z_score).toBeNull();
  });

  it("flags SELL_PREMIUM when z >= 1.2", async () => {
    const r = await rviGapHandler({
      ticker: "NVDA",
      iv_30d: 0.50,
      hv_30d: 0.25,
      iv_history_mean: 0.30,
      iv_history_stdev: 0.08,
    });
    expect(r.z_score).toBe(2.5);
    expect(r.action).toBe("SELL_PREMIUM");
    expect(r.signal_for_confluence.direction).toBe("BEARISH");
  });

  it("flags BUY_PREMIUM when z <= -1.2", async () => {
    const r = await rviGapHandler({
      ticker: "SPY",
      iv_30d: 0.10,
      hv_30d: 0.12,
      iv_history_mean: 0.18,
      iv_history_stdev: 0.05,
    });
    expect(r.z_score).toBe(-1.6);
    expect(r.action).toBe("BUY_PREMIUM");
    expect(r.signal_for_confluence.direction).toBe("BULLISH");
  });

  it("returns NEUTRAL when |z| < 1.2", async () => {
    const r = await rviGapHandler({
      ticker: "QQQ",
      iv_30d: 0.20,
      hv_30d: 0.18,
      iv_history_mean: 0.19,
      iv_history_stdev: 0.05,
    });
    expect(r.action).toBe("NEUTRAL");
    expect(r.signal_for_confluence.direction).toBe("NEUTRAL");
  });

  it("falls back to ratio thresholds w/o history (>=1.5 → SELL)", async () => {
    const r = await rviGapHandler({
      ticker: "AG",
      iv_30d: 0.60,
      hv_30d: 0.30,
    });
    expect(r.action).toBe("SELL_PREMIUM");
  });

  it("falls back to ratio thresholds w/o history (<=0.8 → BUY)", async () => {
    const r = await rviGapHandler({
      ticker: "TLT",
      iv_30d: 0.10,
      hv_30d: 0.15,
    });
    expect(r.action).toBe("BUY_PREMIUM");
  });

  it("emits signal_for_confluence shape compatible w/ signal_rank", async () => {
    const r = await rviGapHandler({
      ticker: "AAPL",
      iv_30d: 0.40,
      hv_30d: 0.20,
      iv_history_mean: 0.25,
      iv_history_stdev: 0.05,
    });
    expect(r.signal_for_confluence.group).toBe("VOLATILITY");
    expect(r.signal_for_confluence.source).toBe("rvi_gap");
    expect(r.signal_for_confluence.confidence).toBeGreaterThan(0);
    expect(r.signal_for_confluence.confidence).toBeLessThanOrEqual(1.0);
    expect(r.signal_for_confluence.detail.length).toBeGreaterThan(0);
  });

  it("custom thresholds override defaults", async () => {
    const r = await rviGapHandler({
      ticker: "AAPL",
      iv_30d: 0.30,
      hv_30d: 0.20,
      iv_history_mean: 0.25,
      iv_history_stdev: 0.05,
      rich_threshold_z: 0.5,
    });
    expect(r.z_score).toBe(1);
    expect(r.action).toBe("SELL_PREMIUM");
  });
});
