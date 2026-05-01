import { describe, expect, it } from "vitest";
import { fetchFlowHandler } from "../../src/tools/fetch-flow.js";
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

describe("fetchFlowHandler", () => {
  // Use after-hours Friday — getLastNTradingDays returns [Apr-30, Apr-29, ...]
  // and isTradingDay(Friday) → today is added to the front for the today-branch test.
  const FRIDAY_AFTER_HOURS = new Date("2026-05-01T22:00:00Z"); // 18:00 ET (after close)
  const SATURDAY = new Date("2026-05-02T17:00:00Z");

  it("fetches darkpool per trading day and aggregates", async () => {
    const buys = Array.from({ length: 10 }, () => mkTrade({ price: 100.05 }));
    const r = await fetchFlowHandler(
      { ticker: "AAPL", lookback_days: 3, skip_options_flow: true },
      {
        fetchDarkpool: async () => buys,
        fetchAlerts: async () => [],
        now: () => FRIDAY_AFTER_HOURS,
      },
    );
    expect(r.ticker).toBe("AAPL");
    expect(r.dark_pool.daily).toHaveLength(4); // 3 prior + today (Friday is trading day)
    expect(r.dark_pool.aggregate.flow_direction).toBe("ACCUMULATION");
    expect(r.options_flow.total_alerts).toBe(0);
  });

  it("does not include today when not a trading day", async () => {
    const r = await fetchFlowHandler(
      { ticker: "AAPL", lookback_days: 2, skip_options_flow: true },
      {
        fetchDarkpool: async () => [mkTrade({ price: 100.05 })],
        fetchAlerts: async () => [],
        now: () => SATURDAY,
      },
    );
    expect(r.dark_pool.daily).toHaveLength(2);
    expect(r.dark_pool.daily.every((d) => d.date < "2026-05-02")).toBe(true);
  });

  it("skip_options_flow=true returns empty options_flow", async () => {
    const r = await fetchFlowHandler(
      { ticker: "AAPL", lookback_days: 1, skip_options_flow: true },
      {
        fetchDarkpool: async () => [],
        fetchAlerts: async () => { throw new Error("should not be called"); },
        now: () => FRIDAY_AFTER_HOURS,
      },
    );
    expect(r.options_flow.bias).toBe("NO_DATA");
    expect(r.options_flow.total_alerts).toBe(0);
  });

  it("includes options_flow when not skipped", async () => {
    const r = await fetchFlowHandler(
      { ticker: "AAPL", lookback_days: 1, skip_options_flow: false },
      {
        fetchDarkpool: async () => [],
        fetchAlerts: async () => [
          mkAlert({ is_call: true, premium: 200_000, type: "CALL" }),
          mkAlert({ is_call: false, premium: 100_000, type: "PUT" }),
        ],
        now: () => FRIDAY_AFTER_HOURS,
      },
    );
    expect(r.options_flow.total_alerts).toBe(2);
    expect(r.options_flow.bias).toBe("STRONGLY_BULLISH");
  });

  it("computes combined_signal from DP + options bias", async () => {
    const r = await fetchFlowHandler(
      { ticker: "AAPL", lookback_days: 2, skip_options_flow: false },
      {
        fetchDarkpool: async () => Array.from({ length: 10 }, () => mkTrade({ price: 100.05 })),
        fetchAlerts: async () => [
          mkAlert({ is_call: true, premium: 200_000, type: "CALL" }),
          mkAlert({ is_call: false, premium: 100_000, type: "PUT" }),
        ],
        now: () => FRIDAY_AFTER_HOURS,
      },
    );
    expect(r.combined_signal).toBe("STRONG_BULLISH_CONFLUENCE");
  });

  it("rejects invalid ticker via zod", async () => {
    await expect(
      fetchFlowHandler({ ticker: "lowercase!", lookback_days: 1 }),
    ).rejects.toThrow();
  });

  it("rejects lookback_days > 30", async () => {
    await expect(
      fetchFlowHandler({ ticker: "AAPL", lookback_days: 100 }),
    ).rejects.toThrow();
  });
});
