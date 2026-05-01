import { describe, expect, it } from "vitest";
import {
  analyzeDarkpool,
  analyzeOptionsFlow,
  interpolateIntradayFlow,
  combineSignal,
  aggregateDailySignals,
  analyzeSignal,
  type DarkpoolAggregate,
} from "../../src/utils/flow.js";
import type { UWDarkpoolTrade, UWFlowAlert } from "../../src/clients/uw-client.js";

function dpTrade(over: Partial<UWDarkpoolTrade>): UWDarkpoolTrade {
  return {
    size: 100, price: 100, premium: 10000,
    nbbo_bid: 99.9, nbbo_ask: 100.1,
    canceled: false, raw: {},
    ...over,
  };
}

function alert(over: Partial<UWFlowAlert>): UWFlowAlert {
  return {
    ticker: "AAPL", type: "CALL", is_call: true,
    premium: 100_000, total_premium: 100_000,
    volume: 100, open_interest: 1000, volume_oi_ratio: 0.1,
    has_sweep: false, is_floor: false, is_ask_side: false, is_bid_side: false,
    raw: {},
    ...over,
  };
}

describe("analyzeDarkpool", () => {
  it("returns NO_DATA on empty trade list", () => {
    const r = analyzeDarkpool([]);
    expect(r.flow_direction).toBe("NO_DATA");
    expect(r.dp_buy_ratio).toBeNull();
    expect(r.num_prints).toBe(0);
  });

  it("classifies as ACCUMULATION when buys dominate", () => {
    const trades = [
      // 9 buys (price >= mid) of 100 shares
      ...Array.from({ length: 9 }, () => dpTrade({ price: 100.05 })),
      // 1 sell (price < mid) of 100 shares
      dpTrade({ price: 99.95 }),
    ];
    const r = analyzeDarkpool(trades);
    expect(r.dp_buy_ratio).toBeCloseTo(0.9, 2);
    expect(r.flow_direction).toBe("ACCUMULATION");
    expect(r.flow_strength).toBeCloseTo(80, 0);
    expect(r.num_prints).toBe(10);
  });

  it("classifies as DISTRIBUTION when sells dominate", () => {
    const trades = [
      ...Array.from({ length: 8 }, () => dpTrade({ price: 99.5 })),
      ...Array.from({ length: 2 }, () => dpTrade({ price: 100.5 })),
    ];
    const r = analyzeDarkpool(trades);
    expect(r.dp_buy_ratio).toBeCloseTo(0.2, 2);
    expect(r.flow_direction).toBe("DISTRIBUTION");
  });

  it("excludes canceled prints", () => {
    const trades = [
      dpTrade({ canceled: true }),
      dpTrade({ price: 100.05 }),
    ];
    const r = analyzeDarkpool(trades);
    expect(r.num_prints).toBe(1);
  });

  it("returns NEUTRAL between 0.45 and 0.55 buy_ratio", () => {
    const trades = [
      dpTrade({ price: 100.05 }),
      dpTrade({ price: 99.95 }),
    ];
    const r = analyzeDarkpool(trades);
    expect(r.dp_buy_ratio).toBeCloseTo(0.5, 2);
    expect(r.flow_direction).toBe("NEUTRAL");
    expect(r.flow_strength).toBe(0);
  });
});

describe("analyzeOptionsFlow", () => {
  it("returns NO_DATA on empty list", () => {
    const r = analyzeOptionsFlow([]);
    expect(r.bias).toBe("NO_DATA");
    expect(r.call_put_ratio).toBeNull();
  });

  it("returns ALL_CALLS when only calls are present", () => {
    const r = analyzeOptionsFlow([alert({ is_call: true, premium: 1000 })]);
    expect(r.bias).toBe("ALL_CALLS");
    expect(r.call_put_ratio).toBeNull();
  });

  it("classifies STRONGLY_BULLISH when c/p >= 2.0", () => {
    const r = analyzeOptionsFlow([
      alert({ is_call: true, premium: 200_000 }),
      alert({ is_call: false, premium: 100_000 }),
    ]);
    expect(r.bias).toBe("STRONGLY_BULLISH");
  });

  it("classifies STRONGLY_BEARISH when c/p <= 0.5", () => {
    const r = analyzeOptionsFlow([
      alert({ is_call: true, premium: 50_000 }),
      alert({ is_call: false, premium: 200_000 }),
    ]);
    expect(r.bias).toBe("STRONGLY_BEARISH");
  });

  it("classifies BULLISH between 1.2 and 2.0", () => {
    const r = analyzeOptionsFlow([
      alert({ is_call: true, premium: 150_000 }),
      alert({ is_call: false, premium: 100_000 }),
    ]);
    expect(r.bias).toBe("BULLISH");
  });

  it("classifies NEUTRAL between 0.8 and 1.2", () => {
    const r = analyzeOptionsFlow([
      alert({ is_call: true, premium: 100_000 }),
      alert({ is_call: false, premium: 100_000 }),
    ]);
    expect(r.bias).toBe("NEUTRAL");
  });
});

describe("interpolateIntradayFlow", () => {
  const mkAgg = (over: Partial<DarkpoolAggregate>): DarkpoolAggregate => ({
    total_volume: 1000, total_premium: 100_000,
    buy_volume: 600, sell_volume: 400,
    dp_buy_ratio: 0.6, flow_direction: "ACCUMULATION",
    flow_strength: 20, num_prints: 50,
    ...over,
  });

  it("returns HIGH confidence at progress >= 1.0", () => {
    const r = interpolateIntradayFlow(mkAgg({}), [], 1.0);
    expect(r.is_interpolated).toBe(false);
    expect(r.confidence).toBe("HIGH");
  });

  it("returns LOW confidence when progress is 0", () => {
    const r = interpolateIntradayFlow(mkAgg({}), [mkAgg({})], 0);
    expect(r.is_interpolated).toBe(false);
    expect(r.confidence).toBe("LOW");
  });

  it("returns LOW confidence when no prior days", () => {
    const r = interpolateIntradayFlow(mkAgg({}), [], 0.5);
    expect(r.is_interpolated).toBe(false);
  });

  it("interpolates at 50% with MEDIUM confidence", () => {
    const today = mkAgg({ total_volume: 500, buy_volume: 300, sell_volume: 200 });
    const prior = [mkAgg({ total_volume: 1000 })];
    const r = interpolateIntradayFlow(today, prior, 0.5);
    expect(r.is_interpolated).toBe(true);
    expect(r.confidence).toBe("MEDIUM");
    expect(r.interpolated.total_volume).toBe(1000);
    expect(r.blending_weights?.actual_weight).toBe(0.5);
  });

  it("returns VERY_LOW at progress < 0.25", () => {
    const r = interpolateIntradayFlow(mkAgg({}), [mkAgg({})], 0.1);
    expect(r.confidence).toBe("VERY_LOW");
  });

  it("returns HIGH at progress >= 0.75", () => {
    const r = interpolateIntradayFlow(mkAgg({}), [mkAgg({})], 0.8);
    expect(r.confidence).toBe("HIGH");
  });
});

describe("combineSignal", () => {
  it("returns STRONG_BULLISH_CONFLUENCE when DP accum + options bullish", () => {
    expect(combineSignal("ACCUMULATION", "BULLISH")).toBe("STRONG_BULLISH_CONFLUENCE");
    expect(combineSignal("ACCUMULATION", "STRONGLY_BULLISH")).toBe("STRONG_BULLISH_CONFLUENCE");
  });

  it("returns STRONG_BEARISH_CONFLUENCE when DP distrib + options bearish", () => {
    expect(combineSignal("DISTRIBUTION", "BEARISH")).toBe("STRONG_BEARISH_CONFLUENCE");
  });

  it("returns DP_*_ONLY when only DP is directional", () => {
    expect(combineSignal("ACCUMULATION", "NEUTRAL")).toBe("DP_ACCUMULATION_ONLY");
    expect(combineSignal("DISTRIBUTION", "NEUTRAL")).toBe("DP_DISTRIBUTION_ONLY");
  });

  it("returns OPTIONS_*_ONLY when only options are directional", () => {
    expect(combineSignal("NEUTRAL", "BULLISH")).toBe("OPTIONS_BULLISH_ONLY");
    expect(combineSignal("NO_DATA", "STRONGLY_BEARISH")).toBe("OPTIONS_STRONGLY_BEARISH_ONLY");
  });

  it("returns NO_SIGNAL when neither is directional", () => {
    expect(combineSignal("NEUTRAL", "NEUTRAL")).toBe("NO_SIGNAL");
    expect(combineSignal("NO_DATA", "NO_DATA")).toBe("NO_SIGNAL");
  });
});

describe("aggregateDailySignals", () => {
  it("returns NO_DATA on empty list", () => {
    const r = aggregateDailySignals([]);
    expect(r.flow_direction).toBe("NO_DATA");
    expect(r.dp_buy_ratio).toBeNull();
  });

  it("sums daily aggregates correctly", () => {
    const r = aggregateDailySignals([
      { date: "2026-04-30", total_volume: 1000, total_premium: 100, buy_volume: 600, sell_volume: 400, dp_buy_ratio: 0.6, flow_direction: "ACCUMULATION", flow_strength: 20, num_prints: 50 },
      { date: "2026-04-29", total_volume: 500, total_premium: 50, buy_volume: 400, sell_volume: 100, dp_buy_ratio: 0.8, flow_direction: "ACCUMULATION", flow_strength: 60, num_prints: 25 },
    ]);
    expect(r.total_volume).toBe(1500);
    expect(r.buy_volume).toBe(1000);
    expect(r.sell_volume).toBe(500);
    expect(r.dp_buy_ratio).toBeCloseTo(0.6667, 3);
    expect(r.flow_direction).toBe("ACCUMULATION");
    expect(r.num_prints).toBe(75);
  });
});

describe("analyzeSignal", () => {
  const mkFlow = (over: object = {}) => ({
    dark_pool: {
      aggregate: {
        flow_direction: "ACCUMULATION" as const,
        flow_strength: 50,
        dp_buy_ratio: 0.65,
        num_prints: 200,
      },
      daily: [
        { date: "2026-04-30", flow_direction: "ACCUMULATION" as const, flow_strength: 60, num_prints: 100 },
        { date: "2026-04-29", flow_direction: "ACCUMULATION" as const, flow_strength: 55, num_prints: 100 },
        { date: "2026-04-28", flow_direction: "ACCUMULATION" as const, flow_strength: 50, num_prints: 100 },
      ],
    },
    ...over,
  });

  it("returns ERROR signal when flow has error", () => {
    const r = analyzeSignal({ error: "API down" });
    expect(r.signal).toBe("ERROR");
    expect(r.error).toBe("API down");
  });

  it("returns STRONG signal when score >= 60 and directional", () => {
    const r = analyzeSignal(mkFlow());
    expect(r.signal).toBe("STRONG");
    expect(r.direction).toBe("ACCUMULATION");
    expect(r.sustained_days).toBeGreaterThanOrEqual(2);
  });

  it("returns NONE for non-directional flow", () => {
    const r = analyzeSignal({
      dark_pool: { aggregate: { flow_direction: "NEUTRAL", flow_strength: 0, num_prints: 200 }, daily: [] },
    });
    expect(r.signal).toBe("NONE");
  });

  it("penalizes for options conflict", () => {
    const base = analyzeSignal(mkFlow());
    const conflicting = analyzeSignal(mkFlow({ options_flow: { bias: "BEARISH" } }));
    expect(conflicting.options_conflict).toBe(true);
    expect(conflicting.score).toBeLessThan(base.score);
  });

  it("penalizes when num_prints < 50", () => {
    const sparse = analyzeSignal({
      dark_pool: {
        aggregate: { flow_direction: "ACCUMULATION", flow_strength: 50, dp_buy_ratio: 0.65, num_prints: 30 },
        daily: [{ date: "2026-04-30", flow_direction: "ACCUMULATION", flow_strength: 50, num_prints: 30 }],
      },
    });
    expect(sparse.score).toBeLessThan(50);
  });
});
