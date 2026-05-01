import { describe, expect, it } from "vitest";
import { kelly, kellyBatch } from "../../src/utils/kelly.js";

describe("kelly", () => {
  it("returns DO NOT BET when odds <= 0", () => {
    const r = kelly(0.6, 0);
    expect(r.recommendation).toBe("DO NOT BET");
    expect(r.edge_exists).toBe(false);
    expect(r.full_kelly_pct).toBe(0);
    expect(r.fractional_kelly_pct).toBe(0);
  });

  it("returns DO NOT BET when full kelly is non-positive", () => {
    // p=0.4, b=1 → 0.4 - 0.6/1 = -0.2
    const r = kelly(0.4, 1);
    expect(r.full_kelly_pct).toBeCloseTo(-20, 2);
    expect(r.edge_exists).toBe(false);
    expect(r.recommendation).toBe("DO NOT BET");
  });

  it("classifies STRONG when full kelly > 10%", () => {
    // p=0.7, b=2 → 0.7 - 0.3/2 = 0.55 (55%)
    const r = kelly(0.7, 2);
    expect(r.recommendation).toBe("STRONG");
    expect(r.fractional_kelly_pct).toBeCloseTo(55 * 0.25, 1);
  });

  it("classifies MARGINAL between 2.5% and 10%", () => {
    // p=0.55, b=1 → 0.55 - 0.45/1 = 0.10 (10% — boundary, > 10% required for STRONG, so MARGINAL)
    // pick something cleanly inside: p=0.52, b=1 → 0.04 (4%)
    const r = kelly(0.52, 1);
    expect(r.full_kelly_pct).toBeCloseTo(4, 1);
    expect(r.recommendation).toBe("MARGINAL");
  });

  it("classifies WEAK when 0 < full kelly <= 2.5%", () => {
    // p=0.51, b=1 → 0.02 (2%)
    const r = kelly(0.51, 1);
    expect(r.full_kelly_pct).toBeCloseTo(2, 1);
    expect(r.recommendation).toBe("WEAK");
  });

  it("respects fraction param (default 0.25)", () => {
    const a = kelly(0.7, 2);
    const b = kelly(0.7, 2, 0.5);
    expect(b.fractional_kelly_pct).toBeCloseTo(a.fractional_kelly_pct * 2, 2);
  });
});

describe("kellyBatch", () => {
  it("caps dollar size at maxPct of bankroll", () => {
    const r = kellyBatch([{ probWin: 0.95, odds: 5 }], 100_000, 0.25, 0.025);
    expect(r[0]!.capped).toBe(true);
    expect(r[0]!.dollar_size).toBeCloseTo(2_500, 2);
  });

  it("does not cap when fractional kelly is below maxPct", () => {
    const r = kellyBatch([{ probWin: 0.51, odds: 1 }], 100_000, 0.25, 0.025);
    expect(r[0]!.capped).toBe(false);
    expect(r[0]!.dollar_size).toBeGreaterThan(0);
    expect(r[0]!.dollar_size).toBeLessThan(2_500);
  });

  it("returns 0 dollar when DO NOT BET", () => {
    const r = kellyBatch([{ probWin: 0.4, odds: 1 }], 100_000);
    expect(r[0]!.dollar_size).toBe(0);
    expect(r[0]!.recommendation).toBe("DO NOT BET");
  });
});
