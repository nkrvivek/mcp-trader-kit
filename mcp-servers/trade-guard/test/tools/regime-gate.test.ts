import { describe, expect, it } from "vitest";
import { regimeGateHandler } from "../../src/tools/regime-gate.js";

describe("regimeGateHandler", () => {
  it("passes BUY in CLEAR regime with full size", async () => {
    const r = await regimeGateHandler({
      regime_tier: "CLEAR",
      direction: "BUY",
      notional_usd: 10000,
    });
    expect(r.pass).toBe(true);
    expect(r.size_multiplier).toBe(1.0);
    expect(r.adjusted_notional_usd).toBe(10000);
    expect(r.reasons).toHaveLength(0);
  });

  it("reduces size in CAUTION regime", async () => {
    const r = await regimeGateHandler({
      regime_tier: "CAUTION",
      direction: "BUY",
      notional_usd: 10000,
    });
    expect(r.pass).toBe(true);
    expect(r.size_multiplier).toBe(0.75);
    expect(r.adjusted_notional_usd).toBe(7500);
    expect(r.warnings.some((w: string) => w.includes("0.75x"))).toBe(true);
  });

  it("blocks BUY in DEFENSIVE regime", async () => {
    const r = await regimeGateHandler({
      regime_tier: "DEFENSIVE",
      direction: "BUY",
      notional_usd: 10000,
    });
    expect(r.pass).toBe(false);
    expect(r.reasons[0]).toContain("BUY blocked in DEFENSIVE");
  });

  it("allows SELL in DEFENSIVE regime", async () => {
    const r = await regimeGateHandler({
      regime_tier: "DEFENSIVE",
      direction: "SELL",
      notional_usd: 10000,
    });
    expect(r.pass).toBe(true);
    expect(r.size_multiplier).toBe(0.5);
  });

  it("blocks BUY_TO_OPEN in HALT regime", async () => {
    const r = await regimeGateHandler({
      regime_tier: "HALT",
      direction: "BUY_TO_OPEN",
      notional_usd: 5000,
    });
    expect(r.pass).toBe(false);
    expect(r.reasons[0]).toContain("HALT");
    expect(r.size_multiplier).toBe(0.25);
  });

  it("blocks SELL_TO_OPEN in HALT regime", async () => {
    const r = await regimeGateHandler({
      regime_tier: "HALT",
      direction: "SELL_TO_OPEN",
      notional_usd: 5000,
    });
    expect(r.pass).toBe(false);
  });

  it("warns on non-preferred structure", async () => {
    const r = await regimeGateHandler({
      regime_tier: "CAUTION",
      direction: "BUY_TO_OPEN",
      structure: "naked_call",
      notional_usd: 5000,
    });
    expect(r.structure_aligned).toBe(false);
    expect(r.warnings.some((w: string) => w.includes("naked_call"))).toBe(true);
  });

  it("confirms preferred structure", async () => {
    const r = await regimeGateHandler({
      regime_tier: "CLEAR",
      direction: "SELL_TO_OPEN",
      structure: "covered_call",
      notional_usd: 5000,
    });
    expect(r.structure_aligned).toBe(true);
  });

  it("returns max_dte per tier", async () => {
    const clear = await regimeGateHandler({ regime_tier: "CLEAR", direction: "BUY", notional_usd: 1000 });
    const caution = await regimeGateHandler({ regime_tier: "CAUTION", direction: "BUY", notional_usd: 1000 });
    const halt = await regimeGateHandler({ regime_tier: "HALT", direction: "SELL", notional_usd: 1000 });

    expect(clear.max_dte).toBeNull();
    expect(caution.max_dte).toBe(45);
    expect(halt.max_dte).toBe(14);
  });
});
