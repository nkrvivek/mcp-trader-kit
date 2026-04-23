import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calcRollHandler } from "../../src/tools/calc-roll.js";

function occ(t: string, yymmdd: string, cp: "C" | "P", strike: number): string {
  const s = String(Math.round(strike * 1000)).padStart(8, "0");
  return `${t}${yymmdd}${cp}${s}`;
}

function yymmdd(iso: string): string {
  return iso.slice(2, 4) + iso.slice(5, 7) + iso.slice(8, 10);
}

interface Leg {
  strike: number;
  type: "C" | "P";
  bid: number;
  ask: number;
  delta: number;
  oi: number;
}

function buildRoutes(opts: {
  ticker: string;
  price: number;
  expiries: Record<string, Leg[]>; // iso -> legs
}) {
  const routes: Record<string, any> = {
    [`/stock/${opts.ticker}/stock-state`]: { data: { close: opts.price, prev_close: opts.price - 1 } },
    [`/stock/${opts.ticker}/expiry-breakdown`]: {
      data: Object.keys(opts.expiries).map((e) => ({ expires: e })),
    },
  };

  for (const [iso, legs] of Object.entries(opts.expiries)) {
    const yy = yymmdd(iso);
    const contracts = {
      data: legs.map((l) => ({
        option_symbol: occ(opts.ticker, yy, l.type, l.strike),
        nbbo_bid: String(l.bid),
        nbbo_ask: String(l.ask),
        open_interest: l.oi,
        volume: 5,
        implied_volatility: 0.3,
      })),
    };
    const greeks = {
      data: legs.map((l) => {
        if (l.type === "P") return { put_option_symbol: occ(opts.ticker, yy, "P", l.strike), put_delta: l.delta };
        return { call_option_symbol: occ(opts.ticker, yy, "C", l.strike), call_delta: l.delta };
      }),
    };
    routes[`expiry=${iso}`] = contracts;
    routes[`/stock/${opts.ticker}/option-contracts?expiry=${iso}`] = contracts;
    routes[`/stock/${opts.ticker}/greeks?expiry=${iso}`] = greeks;
  }
  return routes;
}

function installFetch(routes: Record<string, any>) {
  const mock = vi.fn(async (input: any) => {
    const url = String(input);
    const matches = Object.keys(routes)
      .filter((p) => url.includes(p))
      .sort((a, b) => b.length - a.length);
    if (matches.length > 0) {
      const body = routes[matches[0]!];
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(body),
        json: async () => body,
      } as any;
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

describe("calcRollHandler", () => {
  beforeEach(() => {
    process.env.UW_TOKEN = "test-uw";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns ranked rolls w/ btc + net credit for short put", async () => {
    const current = "2026-05-15";
    const future = "2026-06-18";
    const routes = buildRoutes({
      ticker: "GOOGL",
      price: 335,
      expiries: {
        [current]: [
          { strike: 320, type: "P", bid: 7.1, ask: 7.4, delta: -0.48, oi: 500 },
        ],
        [future]: [
          { strike: 325, type: "P", bid: 13.3, ask: 13.5, delta: -0.42, oi: 3500 },
          { strike: 320, type: "P", bid: 10.5, ask: 10.7, delta: -0.38, oi: 1500 },
          { strike: 315, type: "P", bid: 8.2, ask: 8.4, delta: -0.33, oi: 1200 },
        ],
      },
    });
    installFetch(routes);

    const r = await calcRollHandler({
      ticker: "GOOGL",
      option_type: "put",
      current_strike: 320,
      current_expiry: current,
      qty: 3,
      entry_credit_per: 1.85,
      direction: "out",
      min_net_credit: 0,
      min_dte_extension: 7,
      max_dte_extension: 60,
      max_strike_adjust: 10,
      min_oi: 50,
      max_results: 10,
    });

    expect(r.btc_cost_per).toBeCloseTo(7.4, 2);
    expect(r.underlying_price).toBe(335);
    expect(r.rolls.length).toBeGreaterThanOrEqual(1);
    expect(r.warnings.some((w) => w.includes("short put ITM"))).toBe(false);

    const top = r.rolls[0]!;
    expect(top.new_expiry).toBe(future);
    expect(top.dte_extension).toBeGreaterThan(0);
    expect(top.net_credit_total).toBeCloseTo(top.net_credit_per * 100 * 3, 2);
  });

  it("returns empty rolls + warning when current leg not found", async () => {
    installFetch(
      buildRoutes({
        ticker: "AAPL",
        price: 180,
        expiries: {
          "2026-05-15": [{ strike: 175, type: "P", bid: 2, ask: 2.2, delta: -0.3, oi: 500 }],
        },
      }),
    );

    const r = await calcRollHandler({
      ticker: "AAPL",
      option_type: "put",
      current_strike: 200,
      current_expiry: "2026-05-15",
      qty: 1,
    });

    expect(r.rolls).toHaveLength(0);
    expect(r.warnings[0]).toMatch(/not found/);
  });

  it("warns when short call is ITM", async () => {
    const current = "2026-05-15";
    const future = "2026-06-18";
    installFetch(
      buildRoutes({
        ticker: "TSLA",
        price: 220,
        expiries: {
          [current]: [{ strike: 200, type: "C", bid: 22, ask: 22.5, delta: 0.78, oi: 400 }],
          [future]: [{ strike: 210, type: "C", bid: 25, ask: 25.2, delta: 0.68, oi: 800 }],
        },
      }),
    );

    const r = await calcRollHandler({
      ticker: "TSLA",
      option_type: "call",
      current_strike: 200,
      current_expiry: current,
      qty: 1,
      direction: "out_and_up",
      max_strike_adjust: 20,
      min_oi: 50,
    });

    expect(r.warnings.some((w) => w.includes("short call ITM"))).toBe(true);
    expect(r.rolls.length).toBeGreaterThan(0);
    expect(r.rolls[0]!.new_strike).toBe(210);
  });

  it("filters rolls below min_net_credit", async () => {
    const current = "2026-05-15";
    const future = "2026-06-18";
    installFetch(
      buildRoutes({
        ticker: "MSFT",
        price: 400,
        expiries: {
          [current]: [{ strike: 380, type: "P", bid: 5, ask: 5.5, delta: -0.3, oi: 500 }],
          [future]: [{ strike: 380, type: "P", bid: 5.4, ask: 5.6, delta: -0.29, oi: 1000 }],
        },
      }),
    );

    const r = await calcRollHandler({
      ticker: "MSFT",
      option_type: "put",
      current_strike: 380,
      current_expiry: current,
      min_net_credit: 2.0,
      min_oi: 50,
    });

    expect(r.rolls).toHaveLength(0);
  });

  it("direction=out_and_down excludes higher put strikes", async () => {
    const current = "2026-05-15";
    const future = "2026-06-18";
    installFetch(
      buildRoutes({
        ticker: "META",
        price: 450,
        expiries: {
          [current]: [{ strike: 430, type: "P", bid: 4, ask: 4.2, delta: -0.25, oi: 500 }],
          [future]: [
            { strike: 440, type: "P", bid: 7, ask: 7.2, delta: -0.30, oi: 1000 },
            { strike: 425, type: "P", bid: 5, ask: 5.2, delta: -0.22, oi: 1000 },
          ],
        },
      }),
    );

    const r = await calcRollHandler({
      ticker: "META",
      option_type: "put",
      current_strike: 430,
      current_expiry: current,
      direction: "out_and_down",
      max_strike_adjust: 20,
      min_oi: 50,
    });

    expect(r.rolls.every((x) => x.new_strike <= 430)).toBe(true);
    expect(r.rolls.some((x) => x.new_strike === 425)).toBe(true);
  });

  it("populates leg_out when near leg thin (DTE≤1 or OI<2k)", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const current = today; // DTE=0 → thin
    const future = new Date(Date.now() + 8 * 86400_000).toISOString().slice(0, 10);
    installFetch(
      buildRoutes({
        ticker: "BBAI",
        price: 3.72,
        expiries: {
          [current]: [{ strike: 4, type: "P", bid: 0.29, ask: 0.30, delta: -0.55, oi: 1342 }],
          [future]:  [{ strike: 4, type: "P", bid: 0.38, ask: 0.41, delta: -0.50, oi: 1876 }],
        },
      }),
    );

    const r = await calcRollHandler({
      ticker: "BBAI",
      option_type: "put",
      current_strike: 4,
      current_expiry: current,
      qty: 20,
      direction: "out",
      min_net_credit: 0,
      min_dte_extension: 5,
      max_dte_extension: 30,
      max_strike_adjust: 5,
      min_oi: 50,
    });

    expect(r.warnings.some((w) => w.includes("R14"))).toBe(true);
    expect(r.rolls.length).toBeGreaterThan(0);
    const top = r.rolls[0]!;
    expect(top.leg_out).toBeDefined();
    expect(top.leg_out!.btc_price).toBeCloseTo(0.30, 2);
    expect(top.leg_out!.sto_price).toBeCloseTo(0.38, 2);
    expect(top.leg_out!.est_net).toBeCloseTo(0.08, 2);
    expect(top.leg_out!.note).toContain("DTE=0");
  });

  it("omits leg_out when near leg liquid (OI≥2k)", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const current = new Date(Date.now() + 10 * 86400_000).toISOString().slice(0, 10);
    const future = new Date(Date.now() + 40 * 86400_000).toISOString().slice(0, 10);
    void today;
    installFetch(
      buildRoutes({
        ticker: "AAPL",
        price: 180,
        expiries: {
          [current]: [{ strike: 175, type: "P", bid: 2.0, ask: 2.1, delta: -0.3, oi: 8000 }],
          [future]:  [{ strike: 175, type: "P", bid: 3.5, ask: 3.6, delta: -0.28, oi: 10000 }],
        },
      }),
    );

    const r = await calcRollHandler({
      ticker: "AAPL",
      option_type: "put",
      current_strike: 175,
      current_expiry: current,
      qty: 1,
      min_oi: 50,
    });

    expect(r.warnings.some((w) => w.includes("R14"))).toBe(false);
    expect(r.rolls[0]!.leg_out).toBeUndefined();
  });

  it("excludes rolls beyond max_strike_adjust", async () => {
    const current = "2026-05-15";
    const future = "2026-06-18";
    installFetch(
      buildRoutes({
        ticker: "NVDA",
        price: 500,
        expiries: {
          [current]: [{ strike: 480, type: "P", bid: 5, ask: 5.2, delta: -0.25, oi: 500 }],
          [future]: [
            { strike: 480, type: "P", bid: 8, ask: 8.1, delta: -0.28, oi: 1000 },
            { strike: 450, type: "P", bid: 3, ask: 3.2, delta: -0.15, oi: 1000 },
          ],
        },
      }),
    );

    const r = await calcRollHandler({
      ticker: "NVDA",
      option_type: "put",
      current_strike: 480,
      current_expiry: current,
      direction: "out",
      max_strike_adjust: 5,
      min_oi: 50,
    });

    expect(r.rolls.every((x) => Math.abs(x.new_strike - 480) <= 5)).toBe(true);
  });
});
