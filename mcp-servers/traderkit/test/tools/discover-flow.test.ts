import { describe, expect, it } from "vitest";
import { discoverFlowHandler, SCORING_WEIGHTS } from "../../src/tools/discover-flow.js";
import type { UWDarkpoolTrade, UWFlowAlert } from "../../src/clients/uw-client.js";

const mkTrade = (over: Partial<UWDarkpoolTrade> = {}): UWDarkpoolTrade => ({
  size: 100, price: 100, premium: 10000,
  nbbo_bid: 99.9, nbbo_ask: 100.1,
  canceled: false, raw: {}, ...over,
});

const mkAlert = (over: Partial<UWFlowAlert> = {}): UWFlowAlert => ({
  ticker: "AAPL", type: "CALL", is_call: true,
  premium: 100_000, total_premium: 100_000,
  volume: 100, open_interest: 1000, volume_oi_ratio: 0.1,
  has_sweep: false, is_floor: false, is_ask_side: false, is_bid_side: false,
  raw: {}, ...over,
});

describe("discoverFlowHandler", () => {
  const FRIDAY_AFTER_HOURS = new Date("2026-05-01T22:00:00Z");

  it("rejects targeted mode without tickers", async () => {
    await expect(
      discoverFlowHandler({ mode: "targeted" }),
    ).rejects.toThrow(/tickers required/);
  });

  it("returns empty result when market mode has no alerts", async () => {
    const r = await discoverFlowHandler(
      { mode: "market" },
      {
        fetchMarketAlerts: async () => [],
        fetchTickerAlerts: async () => [],
        fetchDarkpool: async () => [],
        now: () => FRIDAY_AFTER_HOURS,
      },
    );
    expect(r.candidates_found).toBe(0);
    expect(r.candidates).toHaveLength(0);
    expect(r.alerts_analyzed).toBe(0);
  });

  it("excludes index symbols when exclude_indices=true", async () => {
    const r = await discoverFlowHandler(
      { mode: "market", min_alerts: 1 },
      {
        fetchMarketAlerts: async () => [
          mkAlert({ ticker: "SPX", type: "CALL", is_call: true }),
          mkAlert({ ticker: "AAPL", type: "CALL", is_call: true }),
        ],
        fetchDarkpool: async () => [],
        now: () => FRIDAY_AFTER_HOURS,
      },
    );
    expect(r.candidates.map((c) => c.ticker)).toEqual(["AAPL"]);
  });

  it("respects excluded_tickers", async () => {
    const r = await discoverFlowHandler(
      { mode: "market", excluded_tickers: ["AAPL"], min_alerts: 1 },
      {
        fetchMarketAlerts: async () => [
          mkAlert({ ticker: "AAPL" }),
          mkAlert({ ticker: "MSFT" }),
        ],
        fetchDarkpool: async () => [],
        now: () => FRIDAY_AFTER_HOURS,
      },
    );
    expect(r.candidates.map((c) => c.ticker)).toEqual(["MSFT"]);
  });

  it("filters by min_alerts threshold", async () => {
    const r = await discoverFlowHandler(
      { mode: "market", min_alerts: 2 },
      {
        fetchMarketAlerts: async () => [
          mkAlert({ ticker: "AAPL" }),
          mkAlert({ ticker: "AAPL" }),
          mkAlert({ ticker: "MSFT" }),
        ],
        fetchDarkpool: async () => [],
        now: () => FRIDAY_AFTER_HOURS,
      },
    );
    expect(r.candidates.map((c) => c.ticker)).toEqual(["AAPL"]);
  });

  it("classifies options_bias from call/put split", async () => {
    const r = await discoverFlowHandler(
      { mode: "market", min_alerts: 1 },
      {
        fetchMarketAlerts: async () => [
          mkAlert({ ticker: "BULL", type: "CALL", is_call: true }),
          mkAlert({ ticker: "BULL", type: "CALL", is_call: true }),
          mkAlert({ ticker: "BEAR", type: "PUT", is_call: false }),
          mkAlert({ ticker: "BEAR", type: "PUT", is_call: false }),
          mkAlert({ ticker: "MIX", type: "CALL", is_call: true }),
          mkAlert({ ticker: "MIX", type: "PUT", is_call: false }),
        ],
        fetchDarkpool: async () => [],
        now: () => FRIDAY_AFTER_HOURS,
      },
    );
    const byTicker = Object.fromEntries(r.candidates.map((c) => [c.ticker, c.options_bias]));
    expect(byTicker.BULL).toBe("BULLISH");
    expect(byTicker.BEAR).toBe("BEARISH");
    expect(byTicker.MIX).toBe("MIXED");
  });

  it("flags confluence when DP accumulates and options bullish", async () => {
    const r = await discoverFlowHandler(
      { mode: "market", min_alerts: 1 },
      {
        fetchMarketAlerts: async () => [
          mkAlert({ ticker: "AAPL", type: "CALL", is_call: true }),
          mkAlert({ ticker: "AAPL", type: "CALL", is_call: true }),
        ],
        fetchDarkpool: async () => Array.from({ length: 10 }, () => mkTrade({ price: 100.05 })),
        now: () => FRIDAY_AFTER_HOURS,
      },
    );
    expect(r.candidates[0]!.confluence).toBe(true);
    expect(r.candidates[0]!.dp_direction).toBe("ACCUMULATION");
  });

  it("targeted mode fetches per-ticker alerts", async () => {
    const tickersFetched: string[] = [];
    const r = await discoverFlowHandler(
      { mode: "targeted", tickers: ["AAPL", "MSFT"], min_alerts: 1 },
      {
        fetchTickerAlerts: async (t) => {
          tickersFetched.push(t);
          return [mkAlert({ ticker: t })];
        },
        fetchDarkpool: async () => [],
        now: () => FRIDAY_AFTER_HOURS,
      },
    );
    expect(tickersFetched.sort()).toEqual(["AAPL", "MSFT"]);
    expect(r.tickers_scanned).toBe(2);
  });

  it("sorts candidates by score desc", async () => {
    const r = await discoverFlowHandler(
      { mode: "market", min_alerts: 1, top: 10 },
      {
        fetchMarketAlerts: async () => [
          // BULL gets confluence (calls + DP accum)
          mkAlert({ ticker: "BULL", type: "CALL", is_call: true, has_sweep: true, volume_oi_ratio: 5 }),
          mkAlert({ ticker: "BULL", type: "CALL", is_call: true, has_sweep: true, volume_oi_ratio: 5 }),
          // QUIET no signal
          mkAlert({ ticker: "QUIET", type: "CALL", is_call: true, volume_oi_ratio: 0.1 }),
        ],
        fetchDarkpool: async (t) =>
          t === "BULL" ? Array.from({ length: 20 }, () => mkTrade({ price: 100.05 })) : [mkTrade({})],
        now: () => FRIDAY_AFTER_HOURS,
      },
    );
    expect(r.candidates[0]!.ticker).toBe("BULL");
    expect(r.candidates[0]!.score).toBeGreaterThan(r.candidates[1]!.score);
  });

  it("respects top limit", async () => {
    const r = await discoverFlowHandler(
      { mode: "market", top: 1, min_alerts: 1 },
      {
        fetchMarketAlerts: async () => [
          mkAlert({ ticker: "AAA" }),
          mkAlert({ ticker: "BBB" }),
        ],
        fetchDarkpool: async () => [],
        now: () => FRIDAY_AFTER_HOURS,
      },
    );
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates_found).toBe(2);
  });

  it("exposes scoring_weights in result", async () => {
    const r = await discoverFlowHandler(
      { mode: "market" },
      { fetchMarketAlerts: async () => [], fetchDarkpool: async () => [], now: () => FRIDAY_AFTER_HOURS },
    );
    expect(r.scoring_weights).toEqual(SCORING_WEIGHTS);
  });
});
