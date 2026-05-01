import { describe, expect, it } from "vitest";
import { monitorPositionHandler } from "../../src/tools/monitor-position.js";

const AAPL_FIXTURE = {
  position_id: "aapl-295c-may22",
  ticker: "AAPL",
  structure: "covered_call" as const,
  strike: 295,
  expiry: "2026-05-22",
  contracts: 5,
  fill_price: 2.30,
  fill_spot: 283.43,
  fill_delta: 0.27,
  fill_iv: 22.5,
  current_spot: 282.32,
  current_delta: 0.2164,
  current_iv: 22.72,
  as_of: "2026-05-01T20:46:00Z",
};

describe("monitorPositionHandler", () => {
  it("classifies AAPL CC fixture as GREEN with hold action", async () => {
    const r = await monitorPositionHandler(AAPL_FIXTURE);
    expect(r.tier).toBe("GREEN");
    expect(r.action).toBe("hold");
    expect(r.tier_breakdown.by_delta).toBe("GREEN");
    expect(r.tier_breakdown.by_spot).toBe("GREEN");
    expect(r.message).toContain("GREEN");
    expect(r.message).toContain("AAPL 295C");
    expect(r.dte).toBe(21);
    expect(r.buffer_otm).toBeCloseTo(12.68, 2);
    expect(r.next_review_dte).toBe(14);
    expect(r.warnings).toHaveLength(0);
  });

  it("computes deltas_vs_fill from fill snapshot", async () => {
    const r = await monitorPositionHandler(AAPL_FIXTURE);
    expect(r.deltas_vs_fill).toBeDefined();
    expect(r.deltas_vs_fill!.spot).toBeCloseTo(-1.11, 2);
    expect(r.deltas_vs_fill!.delta).toBeCloseTo(-0.0536, 4);
    expect(r.deltas_vs_fill!.iv).toBeCloseTo(0.22, 2);
    expect(r.deltas_vs_fill!.buffer).toBeCloseTo(1.11, 2);
  });

  it("omits deltas_vs_fill when no fill snapshot supplied", async () => {
    const r = await monitorPositionHandler({
      ...AAPL_FIXTURE,
      fill_spot: undefined,
      fill_delta: undefined,
      fill_iv: undefined,
    });
    expect(r.deltas_vs_fill).toBeUndefined();
  });

  it("classifies YELLOW when |Δ| crosses 0.32 threshold", async () => {
    const r = await monitorPositionHandler({
      ...AAPL_FIXTURE,
      current_delta: 0.35,
    });
    expect(r.tier).toBe("YELLOW");
    expect(r.action).toBe("flag");
    expect(r.tier_breakdown.by_delta).toBe("YELLOW");
    expect(r.message).toContain("YELLOW");
  });

  it("classifies ORANGE when |Δ| crosses 0.42 threshold", async () => {
    const r = await monitorPositionHandler({
      ...AAPL_FIXTURE,
      current_delta: 0.45,
    });
    expect(r.tier).toBe("ORANGE");
    expect(r.action).toBe("alarm");
    expect(r.message).toContain("ORANGE");
  });

  it("classifies RED when |Δ| crosses 0.55 threshold", async () => {
    const r = await monitorPositionHandler({
      ...AAPL_FIXTURE,
      current_delta: 0.58,
    });
    expect(r.tier).toBe("RED");
    expect(r.action).toBe("urgent");
    expect(r.message).toContain("RED");
  });

  it("classifies CRITICAL when |Δ| crosses 0.65 threshold", async () => {
    const r = await monitorPositionHandler({
      ...AAPL_FIXTURE,
      current_delta: 0.72,
      current_spot: 300,
    });
    expect(r.tier).toBe("CRITICAL");
    expect(r.action).toBe("stop_everything");
    expect(r.message).toContain("CRITICAL");
    expect(r.message).toContain("CROWN JEWEL");
  });

  it("takes worst-of spot and delta tier", async () => {
    const r = await monitorPositionHandler({
      ...AAPL_FIXTURE,
      current_delta: 0.20,
      current_spot: 295.5,
      thresholds: {
        green: { spot_max: 290, delta_max: 0.32 },
        yellow: { spot_min: 290, delta_max: 0.42 },
        orange: { spot_min: 295, delta_max: 0.55 },
        red: { spot_min: 300, delta_max: 0.65 },
        critical: { spot_min: 305, delta_min: 0.65 },
      },
    });
    expect(r.tier_breakdown.by_delta).toBe("GREEN");
    expect(r.tier_breakdown.by_spot).toBe("ORANGE");
    expect(r.tier).toBe("ORANGE");
  });

  it("flags ITM warning on short call when spot >= strike", async () => {
    const r = await monitorPositionHandler({
      ...AAPL_FIXTURE,
      current_spot: 296.5,
      current_delta: 0.50,
    });
    expect(r.warnings.some((w) => w.includes("ITM"))).toBe(true);
    expect(r.buffer_otm).toBeCloseTo(-1.5, 2);
  });

  it("inverts spot logic for short_put / cash_secured_put", async () => {
    const r = await monitorPositionHandler({
      position_id: "iwm-csp-test",
      ticker: "IWM",
      structure: "cash_secured_put",
      strike: 200,
      expiry: "2026-05-22",
      contracts: 1,
      fill_price: 1.50,
      current_spot: 195,
      current_delta: -0.40,
      thresholds: {
        green: { spot_min: 205, delta_max: 0.32 },
        yellow: { spot_max: 205, delta_max: 0.42 },
        orange: { spot_max: 200, delta_max: 0.55 },
        red: { spot_max: 195, delta_max: 0.65 },
        critical: { spot_max: 190, delta_min: 0.65 },
      },
      as_of: "2026-05-01T20:00:00Z",
    });
    expect(r.tier_breakdown.by_spot).toBe("RED");
    expect(r.tier_breakdown.by_delta).toBe("YELLOW");
    expect(r.tier).toBe("RED");
    expect(r.warnings.some((w) => w.includes("short put ITM"))).toBe(true);
    expect(r.buffer_otm).toBeCloseTo(-5, 2);
  });

  it("uses absolute delta for short puts (negative current_delta)", async () => {
    const r = await monitorPositionHandler({
      position_id: "p1",
      ticker: "SPY",
      structure: "short_put",
      strike: 500,
      expiry: "2026-06-19",
      contracts: 1,
      fill_price: 2.00,
      current_spot: 510,
      current_delta: -0.45,
    });
    expect(r.delta).toBeCloseTo(0.45, 4);
    expect(r.tier_breakdown.by_delta).toBe("ORANGE");
  });

  it("emits 0-DTE final-day warning", async () => {
    const r = await monitorPositionHandler({
      ...AAPL_FIXTURE,
      expiry: "2026-05-01",
      as_of: "2026-05-01T15:00:00Z",
    });
    expect(r.dte).toBe(0);
    expect(r.warnings.some((w) => w.includes("expires today"))).toBe(true);
    expect(r.next_review_dte).toBeNull();
  });

  it("emits ≤1 DTE non-GREEN warning", async () => {
    const r = await monitorPositionHandler({
      ...AAPL_FIXTURE,
      current_delta: 0.40,
      expiry: "2026-05-02",
      as_of: "2026-05-01T15:00:00Z",
    });
    expect(r.dte).toBe(1);
    expect(r.warnings.some((w) => w.includes("≤1 DTE"))).toBe(true);
  });

  it("computes next_review_dte gates 14/7/3/1", async () => {
    const cases: Array<[string, number | null]> = [
      ["2026-05-30", 14],
      ["2026-05-15", 7],
      ["2026-05-10", 7],
      ["2026-05-06", 3],
      ["2026-05-03", 1],
      ["2026-05-02", null],
    ];
    for (const [expiry, expected] of cases) {
      const r = await monitorPositionHandler({
        ...AAPL_FIXTURE,
        expiry,
        as_of: "2026-05-01T15:00:00Z",
      });
      expect(r.next_review_dte).toBe(expected);
    }
  });

  it("respects custom thresholds override", async () => {
    const r = await monitorPositionHandler({
      ...AAPL_FIXTURE,
      current_delta: 0.20,
      thresholds: {
        green: { delta_max: 0.10 },
        yellow: { delta_max: 0.15 },
        orange: { delta_max: 0.20 },
        red: { delta_max: 0.25 },
        critical: { delta_min: 0.25 },
      },
    });
    expect(r.tier_breakdown.by_delta).toBe("RED");
    expect(r.tier).toBe("RED");
  });

  it("returns thresholds_used for caller transparency", async () => {
    const r = await monitorPositionHandler(AAPL_FIXTURE);
    expect(r.thresholds_used.green.delta_max).toBe(0.32);
    expect(r.thresholds_used.critical.delta_min).toBe(0.65);
  });

  it("rejects invalid args via zod", async () => {
    await expect(
      monitorPositionHandler({
        ...AAPL_FIXTURE,
        current_spot: -10,
      }),
    ).rejects.toThrow();
  });
});
