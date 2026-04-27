import { describe, expect, it } from "vitest";
import { macroOverlayHandler } from "../../src/tools/macro-overlay.js";

describe("macroOverlayHandler", () => {
  it("emits BULL bias when DXY falling + credit tightening", async () => {
    const r = await macroOverlayHandler({
      dxy_spot: 100, dxy_50dma: 102, dxy_200dma: 104,
      hyg_lqd_ratio: 0.85, hyg_lqd_20dma: 0.84,
    });
    expect(r.macro_bias).toBe("BULL");
    expect(r.regime_size_modifier).toBe(1.0);
    expect(r.signal_for_confluence.direction).toBe("BULLISH");
  });

  it("emits BEAR bias when DXY rising + credit widening", async () => {
    const r = await macroOverlayHandler({
      dxy_spot: 106, dxy_50dma: 104, dxy_200dma: 102,
      hyg_lqd_ratio: 0.82, hyg_lqd_20dma: 0.84,
    });
    expect(r.macro_bias).toBe("BEAR");
    expect(r.regime_size_modifier).toBeLessThanOrEqual(0.5);
    expect(r.tail_risk).not.toBe("NONE");
  });

  it("emits NEUTRAL bias on mixed signals", async () => {
    const r = await macroOverlayHandler({
      dxy_spot: 102, dxy_50dma: 102, dxy_200dma: 100,
      hyg_lqd_ratio: 0.84, hyg_lqd_20dma: 0.84,
    });
    expect(r.macro_bias).toBe("NEUTRAL");
    expect(r.regime_size_modifier).toBe(0.75);
  });

  it("flags ELEVATED tail risk when VIX >= 22", async () => {
    const r = await macroOverlayHandler({
      dxy_spot: 100, dxy_50dma: 100, dxy_200dma: 100,
      hyg_lqd_ratio: 0.84, hyg_lqd_20dma: 0.84,
      vix_spot: 25,
    });
    expect(r.tail_risk).toBe("ELEVATED");
    expect(r.regime_size_modifier).toBeLessThanOrEqual(0.5);
  });

  it("flags EXTREME tail risk when VIX >= 30", async () => {
    const r = await macroOverlayHandler({
      dxy_spot: 100, dxy_50dma: 100, dxy_200dma: 100,
      hyg_lqd_ratio: 0.84, hyg_lqd_20dma: 0.84,
      vix_spot: 35,
    });
    expect(r.tail_risk).toBe("EXTREME");
    expect(r.regime_size_modifier).toBeLessThanOrEqual(0.25);
  });

  it("escalates tail risk on inverted VIX term structure", async () => {
    const r = await macroOverlayHandler({
      dxy_spot: 100, dxy_50dma: 100, dxy_200dma: 100,
      hyg_lqd_ratio: 0.84, hyg_lqd_20dma: 0.84,
      vix_spot: 25, vix_term_slope: -1.5,
    });
    expect(r.tail_risk).toBe("EXTREME");
  });

  it("includes commodity sector overlay when DXY falling", async () => {
    const r = await macroOverlayHandler({
      dxy_spot: 98, dxy_50dma: 100, dxy_200dma: 102,
      hyg_lqd_ratio: 0.85, hyg_lqd_20dma: 0.84,
    });
    const commodityRow = r.sector_overlay.find((s) => s.sector === "commodities");
    expect(commodityRow).toBeDefined();
    expect(commodityRow!.bias).toBe("BULL");
  });

  it("includes credit-stress overlay when HYG/LQD widening", async () => {
    const r = await macroOverlayHandler({
      dxy_spot: 100, dxy_50dma: 100, dxy_200dma: 100,
      hyg_lqd_ratio: 0.80, hyg_lqd_20dma: 0.85,
    });
    const credit = r.sector_overlay.find((s) => s.sector === "high_yield_credit");
    expect(credit).toBeDefined();
    expect(credit!.bias).toBe("BEAR");
    const small = r.sector_overlay.find((s) => s.sector === "small_caps");
    expect(small!.bias).toBe("BEAR");
  });

  it("emits signal_for_confluence shape compatible w/ signal_rank MACRO group", async () => {
    const r = await macroOverlayHandler({
      dxy_spot: 100, dxy_50dma: 102, dxy_200dma: 104,
      hyg_lqd_ratio: 0.85, hyg_lqd_20dma: 0.84,
    });
    expect(r.signal_for_confluence.group).toBe("MACRO");
    expect(r.signal_for_confluence.source).toBe("macro_overlay");
    expect(r.signal_for_confluence.confidence).toBeGreaterThan(0);
  });
});
