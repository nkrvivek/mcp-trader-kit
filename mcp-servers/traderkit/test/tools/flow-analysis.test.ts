import { describe, expect, it } from "vitest";
import { flowAnalysisHandler } from "../../src/tools/flow-analysis.js";
import type { FetchFlowResult } from "../../src/tools/fetch-flow.js";

const mkFlow = (over: Partial<FetchFlowResult> = {}): FetchFlowResult => ({
  ticker: over.ticker ?? "AAPL",
  fetched_at: "2026-05-01T20:00:00Z",
  lookback_trading_days: 5,
  trading_days_checked: ["2026-04-30", "2026-04-29"],
  market_status: "After hours",
  trading_day_progress: 1.0,
  is_market_hours: false,
  dark_pool: {
    aggregate_actual: {
      total_volume: 1000, total_premium: 100_000,
      buy_volume: 700, sell_volume: 300,
      dp_buy_ratio: 0.7, flow_direction: "ACCUMULATION",
      flow_strength: 60, num_prints: 200,
    },
    aggregate: {
      total_volume: 1000, total_premium: 100_000,
      buy_volume: 700, sell_volume: 300,
      dp_buy_ratio: 0.7, flow_direction: "ACCUMULATION",
      flow_strength: 60, num_prints: 200,
    },
    daily: [
      { date: "2026-04-30", total_volume: 500, total_premium: 50_000, buy_volume: 350, sell_volume: 150, dp_buy_ratio: 0.7, flow_direction: "ACCUMULATION", flow_strength: 60, num_prints: 100 },
      { date: "2026-04-29", total_volume: 500, total_premium: 50_000, buy_volume: 350, sell_volume: 150, dp_buy_ratio: 0.7, flow_direction: "ACCUMULATION", flow_strength: 60, num_prints: 100 },
    ],
  },
  options_flow: { total_alerts: 0, total_premium: 0, call_premium: 0, put_premium: 0, call_put_ratio: null, bias: "NO_DATA" },
  combined_signal: "DP_ACCUMULATION_ONLY",
  ...over,
});

describe("flowAnalysisHandler", () => {
  it("returns empty result for empty positions", async () => {
    const r = await flowAnalysisHandler({ positions: [] });
    expect(r.positions_scanned).toBe(0);
    expect(r.supports).toHaveLength(0);
    expect(r.against).toHaveLength(0);
  });

  it("classifies LONG + ACCUMULATION as supports", async () => {
    const r = await flowAnalysisHandler(
      { positions: [{ ticker: "AAPL", direction: "LONG", structure: "stock" }] },
      { fetchFlow: async () => mkFlow() },
    );
    expect(r.supports).toHaveLength(1);
    expect(r.supports[0]!.ticker).toBe("AAPL");
    expect(r.supports[0]!.flow_direction).toBe("ACCUMULATION");
    expect(r.supports[0]!.signal).toBe("STRONG");
  });

  it("classifies SHORT + ACCUMULATION as against", async () => {
    const r = await flowAnalysisHandler(
      { positions: [{ ticker: "AAPL", direction: "SHORT", structure: "short_call" }] },
      { fetchFlow: async () => mkFlow() },
    );
    expect(r.against).toHaveLength(1);
    expect(r.against[0]!.flow_direction).toBe("ACCUMULATION");
  });

  it("normalizes case-insensitive direction enums", async () => {
    const r = await flowAnalysisHandler(
      { positions: [{ ticker: "AAPL", direction: "long" }] },
      { fetchFlow: async () => mkFlow() },
    );
    expect(r.supports[0]!.direction).toBe("LONG");
  });

  it("treats DEBIT/BUY as long-equivalent", async () => {
    const r = await flowAnalysisHandler(
      { positions: [
        { ticker: "AAPL", direction: "DEBIT", structure: "long_call" },
        { ticker: "MSFT", direction: "BUY", structure: "stock" },
      ]},
      { fetchFlow: async () => mkFlow() },
    );
    expect(r.supports.map((s) => s.ticker).sort()).toEqual(["AAPL", "MSFT"]);
  });

  it("captures fetch errors per ticker", async () => {
    const r = await flowAnalysisHandler(
      { positions: [
        { ticker: "AAPL", direction: "LONG" },
        { ticker: "FAIL", direction: "LONG" },
      ]},
      {
        fetchFlow: async (t) => {
          if (t === "FAIL") throw new Error("UW down");
          return mkFlow();
        },
      },
    );
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toEqual({ ticker: "FAIL", error: "UW down" });
    expect(r.supports).toHaveLength(1);
  });

  it("sorts results by strength desc", async () => {
    const r = await flowAnalysisHandler(
      { positions: [
        { ticker: "AAA", direction: "LONG" },
        { ticker: "BBB", direction: "LONG" },
      ]},
      {
        fetchFlow: async (t) => {
          const base = mkFlow({ ticker: t });
          if (t === "BBB") base.dark_pool.aggregate.flow_strength = 90;
          return base;
        },
      },
    );
    expect(r.supports[0]!.ticker).toBe("BBB");
    expect(r.supports[1]!.ticker).toBe("AAA");
  });

  it("classifies WEAK conflicting recent as watch", async () => {
    const flow = mkFlow();
    // Make signal WEAK and recent direction differ from aggregate
    flow.dark_pool.aggregate.flow_strength = 20;
    flow.dark_pool.aggregate.num_prints = 30; // penalize score below 40
    flow.dark_pool.daily[0]!.flow_direction = "DISTRIBUTION";
    const r = await flowAnalysisHandler(
      { positions: [{ ticker: "AAPL", direction: "LONG" }] },
      { fetchFlow: async () => flow },
    );
    expect(r.watch.length + r.neutral.length).toBeGreaterThan(0);
  });

  it("classifies MODERATE conflicting recent as watch (radon parity)", async () => {
    // strength 70 - 30 (conflict penalty) = 40 → MODERATE
    const flow = mkFlow();
    flow.dark_pool.aggregate.flow_strength = 70;
    flow.dark_pool.aggregate.num_prints = 200;
    flow.dark_pool.daily[0]!.flow_direction = "DISTRIBUTION";
    const r = await flowAnalysisHandler(
      { positions: [{ ticker: "AAPL", direction: "LONG" }] },
      { fetchFlow: async () => flow },
    );
    expect(r.watch).toHaveLength(1);
    expect(r.watch[0]!.signal).toBe("MODERATE");
    expect(r.supports).toHaveLength(0);
  });

  it("includes daily_buy_ratios sorted ascending by date", async () => {
    const r = await flowAnalysisHandler(
      { positions: [{ ticker: "AAPL", direction: "LONG" }] },
      { fetchFlow: async () => mkFlow() },
    );
    const ratios = r.supports[0]!.daily_buy_ratios;
    expect(ratios[0]!.date < ratios[1]!.date).toBe(true);
  });
});
