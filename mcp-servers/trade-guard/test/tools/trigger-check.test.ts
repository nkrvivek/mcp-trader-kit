import { describe, expect, it } from "vitest";
import { triggerCheckHandler } from "../../src/tools/trigger-check.js";

describe("triggerCheckHandler", () => {
  it("fires NAV_MOVE on >=2% drop", async () => {
    const r = await triggerCheckHandler({
      current_nav: 98000,
      previous_nav: 100000,
      current_regime_tier: "CLEAR",
    });

    expect(r.triggered).toBe(true);
    expect(r.events).toHaveLength(1);
    expect(r.events[0]!.kind).toBe("NAV_MOVE");
    expect(r.events[0]!.severity).toBe("WARNING");
    expect(r.events[0]!.detail).toContain("down");
  });

  it("fires CRITICAL on >=4% NAV move", async () => {
    const r = await triggerCheckHandler({
      current_nav: 95000,
      previous_nav: 100000,
      current_regime_tier: "CAUTION",
    });

    const navEvent = r.events.find((e: any) => e.kind === "NAV_MOVE");
    expect(navEvent!.severity).toBe("CRITICAL");
  });

  it("fires REGIME_SHIFT on tier change", async () => {
    const r = await triggerCheckHandler({
      current_nav: 100000,
      previous_nav: 100000,
      current_regime_tier: "DEFENSIVE",
      previous_regime_tier: "CLEAR",
    });

    expect(r.triggered).toBe(true);
    const shift = r.events.find((e: any) => e.kind === "REGIME_SHIFT");
    expect(shift).toBeDefined();
    expect(shift!.severity).toBe("CRITICAL");
    expect(shift!.detail).toContain("deteriorated");
  });

  it("fires INFO on regime improvement", async () => {
    const r = await triggerCheckHandler({
      current_nav: 100000,
      previous_nav: 100000,
      current_regime_tier: "CLEAR",
      previous_regime_tier: "CAUTION",
    });

    const shift = r.events.find((e: any) => e.kind === "REGIME_SHIFT");
    expect(shift!.severity).toBe("INFO");
    expect(shift!.detail).toContain("improved");
  });

  it("fires CONCENTRATION_BREACH on over-cap positions", async () => {
    const r = await triggerCheckHandler({
      current_nav: 100000,
      previous_nav: 100000,
      current_regime_tier: "CLEAR",
      positions: [
        { ticker: "AAPL", market_value_usd: 35000 },
        { ticker: "NVDA", market_value_usd: 20000 },
      ],
      portfolio_total_usd: 100000,
      concentration_cap_pct: 25,
    });

    expect(r.triggered).toBe(true);
    const breach = r.events.find((e: any) => e.kind === "CONCENTRATION_BREACH");
    expect(breach).toBeDefined();
    expect(breach!.detail).toContain("AAPL");
    expect(breach!.detail).toContain("35");
  });

  it("returns no events when everything is stable", async () => {
    const r = await triggerCheckHandler({
      current_nav: 100500,
      previous_nav: 100000,
      current_regime_tier: "CLEAR",
    });

    expect(r.triggered).toBe(false);
    expect(r.events).toHaveLength(0);
  });

  it("sorts events by severity (CRITICAL first)", async () => {
    const r = await triggerCheckHandler({
      current_nav: 95000,
      previous_nav: 100000,
      current_regime_tier: "DEFENSIVE",
      previous_regime_tier: "CLEAR",
      positions: [{ ticker: "AAPL", market_value_usd: 30000 }],
      portfolio_total_usd: 95000,
      concentration_cap_pct: 25,
    });

    expect(r.events.length).toBeGreaterThanOrEqual(2);
    expect(r.events[0]!.severity).toBe("CRITICAL");
  });

  it("respects custom nav_move_threshold_pct", async () => {
    const r = await triggerCheckHandler({
      current_nav: 99000,
      previous_nav: 100000,
      current_regime_tier: "CLEAR",
      nav_move_threshold_pct: 0.5,
    });

    expect(r.triggered).toBe(true);
    expect(r.events[0]!.kind).toBe("NAV_MOVE");
  });
});
