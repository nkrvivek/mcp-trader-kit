import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screenOptionsHandler } from "../../src/tools/screen-options.js";

function occ(t: string, yymmdd: string, cp: "C" | "P", strike: number): string {
  const s = String(Math.round(strike * 1000)).padStart(8, "0");
  return `${t}${yymmdd}${cp}${s}`;
}

function isoInDays(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

function yymmdd(iso: string): string {
  return iso.slice(2, 4) + iso.slice(5, 7) + iso.slice(8, 10);
}

interface FakeChain {
  symbol: string;
  strike: number;
  type: "C" | "P";
  bid: number;
  ask: number;
  delta: number;
  oi: number;
}

function makeUwResponses(opts: {
  ticker: string;
  expiry: string;
  ivRank?: number;
  price?: number;
  chain: FakeChain[];
}) {
  const quoteRows = opts.chain.map((c) => ({
    option_symbol: c.symbol,
    nbbo_bid: String(c.bid),
    nbbo_ask: String(c.ask),
    open_interest: c.oi,
    volume: 10,
    implied_volatility: 0.25,
  }));
  const greekRows = opts.chain.map((c) => {
    if (c.type === "P") {
      return { put_option_symbol: c.symbol, put_delta: c.delta };
    }
    return { call_option_symbol: c.symbol, call_delta: c.delta };
  });
  return {
    contracts: { data: quoteRows },
    greeks: { data: greekRows },
    expiries: { data: [{ expires: opts.expiry }] },
    ivRank: { data: [{ iv_rank: opts.ivRank ?? 45 }] },
    stockState: { data: { close: opts.price ?? 300, prev_close: (opts.price ?? 300) - 2 } },
  };
}

function installFetch(routes: Record<string, any>) {
  const mock = vi.fn(async (input: any) => {
    const url = String(input);
    for (const [pat, body] of Object.entries(routes)) {
      if (url.includes(pat)) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify(body),
          json: async () => body,
        } as any;
      }
    }
    return {
      ok: false,
      status: 404,
      text: async () => `no route for ${url}`,
      json: async () => ({}),
    } as any;
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

describe("screenOptionsHandler", () => {
  beforeEach(() => {
    process.env.UW_TOKEN = "test-uw";
    process.env.FINNHUB_API_KEY = "test-fh";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns CSP candidate matching filters", async () => {
    const expiry = isoInDays(30);
    const yy = yymmdd(expiry);
    const uw = makeUwResponses({
      ticker: "NFLX",
      expiry,
      ivRank: 50,
      price: 300,
      chain: [
        { symbol: occ("NFLX", yy, "P", 280), strike: 280, type: "P", bid: 2.5, ask: 2.7, delta: -0.22, oi: 500 },
        { symbol: occ("NFLX", yy, "P", 290), strike: 290, type: "P", bid: 4.0, ask: 4.2, delta: -0.35, oi: 200 },
      ],
    });
    installFetch({
      "/stock/NFLX/option-contracts": uw.contracts,
      "/stock/NFLX/greeks": uw.greeks,
      "/stock/NFLX/expiry-breakdown": uw.expiries,
      "/stock/NFLX/iv-rank": uw.ivRank,
      "/stock/NFLX/stock-state": uw.stockState,
      "/stock/profile2": { name: "Netflix", marketCapitalization: 150000, finnhubIndustry: "Media" },
      "/calendar/earnings": { earningsCalendar: [] },
    });

    const r = await screenOptionsHandler({
      tickers: ["NFLX"],
      strategy: "csp",
      dte_min: 14,
      dte_max: 45,
      delta_abs_min: 0.10,
      delta_abs_max: 0.30,
      iv_rank_min: 30,
      min_credit: 0.25,
      min_yor: 0.008,
      min_oi: 100,
      min_mkt_cap_usd: 1_000_000_000,
    });

    expect(r.candidates.length).toBeGreaterThanOrEqual(1);
    const top = r.candidates[0]!;
    expect(top.ticker).toBe("NFLX");
    expect(top.strategy).toBe("csp");
    expect(top.short_strike).toBe(280);
    expect(top.short_delta).toBeCloseTo(-0.22, 2);
    expect(top.pop).toBeCloseTo(0.78, 2);
    expect(top.credit).toBeCloseTo(2.6, 1);
    expect(top.sector).toBe("Media");
  });

  it("skips ticker with market cap below threshold", async () => {
    installFetch({
      "/stock/profile2": { marketCapitalization: 100, finnhubIndustry: "Small" },
      "/calendar/earnings": { earningsCalendar: [] },
      "/stock/SMALL/iv-rank": { data: [{ iv_rank: 50 }] },
      "/stock/SMALL/stock-state": { data: { close: 10, prev_close: 10 } },
    });

    const r = await screenOptionsHandler({
      tickers: ["SMALL"],
      strategy: "csp",
      min_mkt_cap_usd: 1_000_000_000,
    });

    expect(r.candidates).toHaveLength(0);
    expect(r.skipped[0]?.reason).toMatch(/mkt_cap/);
  });

  it("skips ticker with iv_rank below threshold", async () => {
    installFetch({
      "/stock/profile2": { marketCapitalization: 150000, finnhubIndustry: "Tech" },
      "/calendar/earnings": { earningsCalendar: [] },
      "/stock/LOWIV/iv-rank": { data: [{ iv_rank: 15 }] },
      "/stock/LOWIV/stock-state": { data: { close: 100, prev_close: 100 } },
    });

    const r = await screenOptionsHandler({
      tickers: ["LOWIV"],
      strategy: "csp",
      iv_rank_min: 30,
      min_mkt_cap_usd: 500_000_000,
    });

    expect(r.candidates).toHaveLength(0);
    expect(r.skipped[0]?.reason).toMatch(/iv_rank/);
  });

  it("skips ticker when no expiries in DTE window", async () => {
    installFetch({
      "/stock/FAR/option-contracts": { data: [] },
      "/stock/FAR/greeks": { data: [] },
      "/stock/FAR/expiry-breakdown": { data: [{ expires: isoInDays(180) }] },
      "/stock/FAR/iv-rank": { data: [{ iv_rank: 50 }] },
      "/stock/FAR/stock-state": { data: { close: 100, prev_close: 100 } },
      "/stock/profile2": { marketCapitalization: 100000, finnhubIndustry: "Tech" },
      "/calendar/earnings": { earningsCalendar: [] },
    });

    const r = await screenOptionsHandler({
      tickers: ["FAR"],
      dte_min: 14,
      dte_max: 45,
      min_mkt_cap_usd: 500_000_000,
    });

    expect(r.candidates).toHaveLength(0);
    expect(r.skipped[0]?.reason).toMatch(/no expiries/);
  });

  it("filters PCS candidates by spread credit + max_risk", async () => {
    const expiry = isoInDays(30);
    const yy = yymmdd(expiry);
    const uw = makeUwResponses({
      ticker: "SPY",
      expiry,
      ivRank: 40,
      price: 450,
      chain: [
        { symbol: occ("SPY", yy, "P", 440), strike: 440, type: "P", bid: 2.0, ask: 2.2, delta: -0.20, oi: 1000 },
        { symbol: occ("SPY", yy, "P", 435), strike: 435, type: "P", bid: 1.0, ask: 1.2, delta: -0.12, oi: 1000 },
      ],
    });
    installFetch({
      "/stock/SPY/option-contracts": uw.contracts,
      "/stock/SPY/greeks": uw.greeks,
      "/stock/SPY/expiry-breakdown": uw.expiries,
      "/stock/SPY/iv-rank": uw.ivRank,
      "/stock/SPY/stock-state": uw.stockState,
      "/stock/profile2": { marketCapitalization: 500000, finnhubIndustry: "ETF" },
      "/calendar/earnings": { earningsCalendar: [] },
    });

    const r = await screenOptionsHandler({
      tickers: ["SPY"],
      strategy: "pcs",
      spread_width: 5,
      min_credit: 0.5,
      min_yor: 0.1,
      min_oi: 100,
      min_mkt_cap_usd: 500_000_000,
    });

    expect(r.candidates.length).toBeGreaterThanOrEqual(1);
    const top = r.candidates[0]!;
    expect(top.short_strike).toBe(440);
    expect(top.long_strike).toBe(435);
    expect(top.max_risk).toBeGreaterThan(0);
    expect(top.credit).toBeLessThan(2.1);
  });

  it("records error when UW throws (e.g., no token)", async () => {
    delete process.env.UW_TOKEN;
    installFetch({
      "/stock/profile2": { marketCapitalization: 100000, finnhubIndustry: "Tech" },
      "/calendar/earnings": { earningsCalendar: [] },
    });

    const r = await screenOptionsHandler({
      tickers: ["AAPL"],
      min_mkt_cap_usd: 500_000_000,
    });

    expect(r.candidates).toHaveLength(0);
    expect(r.skipped[0]?.reason).toMatch(/UW_TOKEN/);
  });
});
