import { describe, expect, it } from "vitest";
import { performanceMetricsHandler } from "../../src/tools/performance-metrics.js";

describe("performanceMetricsHandler", () => {
  const dailyReturns = Array.from({ length: 30 }, (_, i) => (i % 3 === 0 ? -0.005 : 0.008));

  it("computes all metrics for sufficient data", async () => {
    const r: any = await performanceMetricsHandler({ returns: dailyReturns });
    expect(r.observations).toBe(30);
    expect(r.sharpe_ratio).toBeTypeOf("number");
    expect(r.sortino_ratio).toBeTypeOf("number");
    expect(r.max_drawdown).toBeGreaterThanOrEqual(0);
    expect(r.max_drawdown).toBeLessThanOrEqual(1);
    expect(r.win_rate).toBeGreaterThan(0);
    expect(r.win_rate).toBeLessThanOrEqual(1);
    expect(r.calmar_ratio).toBeTypeOf("number");
  });

  it("rejects insufficient observations", async () => {
    const r: any = await performanceMetricsHandler({ returns: [0.01, 0.02, 0.03] });
    expect(r.error).toMatch(/insufficient/);
  });

  it("allows custom min_observations", async () => {
    const r: any = await performanceMetricsHandler({ returns: [0.01, 0.02, 0.03], min_observations: 2 });
    expect(r.observations).toBe(3);
    expect(r.sharpe_ratio).toBeTypeOf("number");
  });

  it("handles all-positive returns", async () => {
    const r: any = await performanceMetricsHandler({
      returns: Array.from({ length: 25 }, () => 0.01),
      min_observations: 20,
    });
    expect(r.max_drawdown).toBe(0);
    expect(r.win_rate).toBe(1);
    expect(r.sortino_ratio).toBeNull();
  });

  it("handles all-negative returns", async () => {
    const r: any = await performanceMetricsHandler({
      returns: Array.from({ length: 25 }, () => -0.01),
      min_observations: 20,
    });
    expect(r.win_rate).toBe(0);
    expect(r.max_drawdown).toBeGreaterThan(0);
  });

  it("uses custom risk-free rate", async () => {
    const r: any = await performanceMetricsHandler({ returns: dailyReturns, risk_free_rate: 0.0 });
    expect(r.risk_free_rate).toBe(0);
  });

  it("returns annualized volatility", async () => {
    const r: any = await performanceMetricsHandler({ returns: dailyReturns });
    expect(r.annualized_volatility).toBeGreaterThan(0);
  });
});
