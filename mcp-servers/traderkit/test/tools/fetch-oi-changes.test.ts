import { describe, expect, it } from "vitest";
import { fetchOiChangesHandler } from "../../src/tools/fetch-oi-changes.js";
import type { UWOiChange } from "../../src/clients/uw-client.js";

const mkOi = (over: Partial<UWOiChange> = {}): UWOiChange => ({
  option_symbol: "AAPL260522C00295000",
  underlying_symbol: "AAPL",
  oi_diff_plain: 1000,
  curr_oi: 5000,
  prev_oi: 4000,
  prev_total_premium: 500_000,
  raw: {},
  ...over,
});

describe("fetchOiChangesHandler", () => {
  it("rejects when neither ticker nor market_wide is provided", async () => {
    await expect(fetchOiChangesHandler({})).rejects.toThrow(/either ticker or market_wide/);
  });

  it("calls fetchTicker with ticker when provided", async () => {
    let calledWith = "";
    const r = await fetchOiChangesHandler(
      { ticker: "AAPL" },
      {
        fetchTicker: async (t: string) => { calledWith = t; return [mkOi({})]; },
      },
    );
    expect(calledWith).toBe("AAPL");
    expect(r.ticker).toBe("AAPL");
    expect(r.market_wide).toBe(false);
    expect(r.total_count).toBe(1);
  });

  it("calls fetchMarket when market_wide=true", async () => {
    let called = false;
    const r = await fetchOiChangesHandler(
      { market_wide: true },
      {
        fetchMarket: async () => { called = true; return [mkOi({})]; },
      },
    );
    expect(called).toBe(true);
    expect(r.ticker).toBeNull();
    expect(r.market_wide).toBe(true);
  });

  it("filters by min_oi_change and min_premium", async () => {
    const r = await fetchOiChangesHandler(
      { ticker: "AAPL", min_oi_change: 500, min_premium: 1_000_000 },
      {
        fetchTicker: async () => [
          mkOi({ oi_diff_plain: 100, prev_total_premium: 5_000_000 }),    // fails oi
          mkOi({ oi_diff_plain: 1000, prev_total_premium: 500_000 }),     // fails premium
          mkOi({ oi_diff_plain: 1000, prev_total_premium: 5_000_000 }),  // pass
        ],
      },
    );
    expect(r.total_count).toBe(1);
  });

  it("categorizes premium tiers correctly", async () => {
    const r = await fetchOiChangesHandler(
      { ticker: "AAPL" },
      {
        fetchTicker: async () => [
          mkOi({ option_symbol: "AAPL260522C00295000", prev_total_premium: 15_000_000 }),
          mkOi({ option_symbol: "AAPL260522C00300000", prev_total_premium: 6_000_000 }),
          mkOi({ option_symbol: "AAPL260522C00305000", prev_total_premium: 2_000_000 }),
          mkOi({ option_symbol: "AAPL260522C00310000", prev_total_premium: 100_000 }),
        ],
      },
    );
    expect(r.data[0]!.strength).toBe("MASSIVE");
    expect(r.data[1]!.strength).toBe("LARGE");
    expect(r.data[2]!.strength).toBe("SIGNIFICANT");
    expect(r.data[3]!.strength).toBe("MODERATE");
    expect(r.massive_count).toBe(1);
  });

  it("classifies BULLISH/BEARISH from option type", async () => {
    const r = await fetchOiChangesHandler(
      { ticker: "AAPL" },
      {
        fetchTicker: async () => [
          mkOi({ option_symbol: "AAPL260522C00295000", oi_diff_plain: 1000 }),
          mkOi({ option_symbol: "AAPL260522P00280000", oi_diff_plain: 1000 }),
        ],
      },
    );
    expect(r.data[0]!.is_call).toBe(true);
    expect(r.data[0]!.direction).toBe("BULLISH");
    expect(r.data[1]!.is_call).toBe(false);
    expect(r.data[1]!.direction).toBe("BEARISH");
  });

  it("classifies CLOSING when oi_diff < 0", async () => {
    const r = await fetchOiChangesHandler(
      { ticker: "AAPL" },
      {
        fetchTicker: async () => [
          mkOi({ option_symbol: "AAPL260522C00295000", oi_diff_plain: -500 }),
          mkOi({ option_symbol: "AAPL260522P00280000", oi_diff_plain: -500 }),
        ],
      },
    );
    expect(r.data[0]!.direction).toBe("CLOSING BULLISH");
    expect(r.data[1]!.direction).toBe("CLOSING BEARISH");
  });

  it("flags LEAP when expiry year is 27 or 28", async () => {
    const r = await fetchOiChangesHandler(
      { ticker: "AAPL" },
      {
        fetchTicker: async () => [
          mkOi({ option_symbol: "AAPL270122C00300000" }),
          mkOi({ option_symbol: "AAPL280121C00300000" }),
          mkOi({ option_symbol: "AAPL260522C00295000" }),
        ],
      },
    );
    expect(r.data[0]!.is_leap).toBe(true);
    expect(r.data[1]!.is_leap).toBe(true);
    expect(r.data[2]!.is_leap).toBe(false);
  });

  it("respects limit param", async () => {
    const r = await fetchOiChangesHandler(
      { ticker: "AAPL", limit: 2 },
      {
        fetchTicker: async () => Array.from({ length: 10 }, () => mkOi()),
      },
    );
    expect(r.total_count).toBe(2);
    expect(r.data).toHaveLength(2);
  });
});
