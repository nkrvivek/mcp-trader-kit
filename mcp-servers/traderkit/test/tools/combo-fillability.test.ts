import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { comboFillabilityHandler } from "../../src/tools/combo-fillability.js";

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
  oi: number;
}

function buildRoutes(opts: {
  ticker: string;
  price: number;
  expiries: Record<string, Leg[]>;
}) {
  const routes: Record<string, any> = {
    [`/stock/${opts.ticker}/stock-state`]: { data: { close: opts.price, prev_close: opts.price - 0.1 } },
  };
  for (const [iso, legs] of Object.entries(opts.expiries)) {
    const yy = yymmdd(iso);
    const contracts = {
      data: legs.map((l) => ({
        option_symbol: occ(opts.ticker, yy, l.type, l.strike),
        nbbo_bid: String(l.bid),
        nbbo_ask: String(l.ask),
        open_interest: l.oi,
        volume: 50,
        implied_volatility: 1.1,
      })),
    };
    const greeks = { data: [] };
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
      return { ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body } as any;
    }
    return { ok: false, status: 404, text: async () => `no route for ${url}`, json: async () => ({}) } as any;
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

describe("comboFillabilityHandler", () => {
  beforeEach(() => {
    process.env.UW_TOKEN = "test-uw";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("BBAI 2026-04-23 regression: LOW score + LEG_OUT suggestion", async () => {
    const now = "2026-04-23T19:45:00Z";
    const routes = buildRoutes({
      ticker: "BBAI",
      price: 3.72,
      expiries: {
        "2026-04-24": [{ strike: 4, type: "P", bid: 0.29, ask: 0.30, oi: 1342 }],
        "2026-05-01": [{ strike: 4, type: "P", bid: 0.38, ask: 0.41, oi: 1876 }],
      },
    });
    installFetch(routes);

    const r = await comboFillabilityHandler({
      ticker: "BBAI",
      legs: [
        { action: "BUY",  right: "P", strike: 4, expiry: "2026-04-24" },
        { action: "SELL", right: "P", strike: 4, expiry: "2026-05-01" },
      ],
      net_price: 0.05,
      tif: "DAY",
      now,
      close_time: "2026-04-23T20:00:00Z",
      underlying_adv_30d: 3_800_000,
    });

    expect(r.score).toBe("LOW");
    expect(r.numeric_score).toBeLessThanOrEqual(35);
    expect(r.suggestion).toBe("LEG_OUT");
    expect(r.leg_out_plan).toBeDefined();
    expect(r.leg_out_plan!.btc.est_price).toBeCloseTo(0.30, 2);
    expect(r.leg_out_plan!.sto.est_price).toBeCloseTo(0.38, 2);
    expect(r.leg_out_plan!.est_net).toBeCloseTo(0.08, 2);
    expect(r.inputs.minutes_to_close).toBe(15);
    expect(r.inputs.near_leg.dte).toBe(1);
    // rules fired: DTE≤1, OI<2k, ADV<5M, spot-within-10%, minutes<60
    expect(r.reasons.some((x) => x.includes("DTE"))).toBe(true);
    expect(r.reasons.some((x) => x.includes("OI"))).toBe(true);
    expect(r.reasons.some((x) => x.includes("ADV"))).toBe(true);
    expect(r.reasons.some((x) => x.includes("min to close"))).toBe(true);
  });

  it("liquid SPX calendar scores HIGH + SUBMIT", async () => {
    const now = "2026-04-23T15:00:00Z";
    const routes = buildRoutes({
      ticker: "SPX",
      price: 5200,
      expiries: {
        "2026-05-15": [{ strike: 5100, type: "P", bid: 12.0, ask: 12.2, oi: 25_000 }],
        "2026-06-19": [{ strike: 5100, type: "P", bid: 24.0, ask: 24.3, oi: 40_000 }],
      },
    });
    installFetch(routes);

    const r = await comboFillabilityHandler({
      ticker: "SPX",
      legs: [
        { action: "BUY",  right: "P", strike: 5100, expiry: "2026-05-15" },
        { action: "SELL", right: "P", strike: 5100, expiry: "2026-06-19" },
      ],
      net_price: 12.0,
      tif: "DAY",
      now,
      close_time: "2026-04-23T20:00:00Z",
      underlying_adv_30d: 2_500_000_000,
    });

    expect(r.score).toBe("HIGH");
    expect(r.suggestion).toBe("SUBMIT");
    expect(r.leg_out_plan).toBeUndefined();
  });

  it("net price ≤ 0 and <30 min to close → CANCEL", async () => {
    const now = "2026-04-23T19:40:00Z";
    const routes = buildRoutes({
      ticker: "BBAI",
      price: 3.72,
      expiries: {
        "2026-04-24": [{ strike: 4, type: "P", bid: 0.29, ask: 0.30, oi: 1342 }],
        "2026-05-01": [{ strike: 4, type: "P", bid: 0.38, ask: 0.41, oi: 1876 }],
      },
    });
    installFetch(routes);

    const r = await comboFillabilityHandler({
      ticker: "BBAI",
      legs: [
        { action: "BUY",  right: "P", strike: 4, expiry: "2026-04-24" },
        { action: "SELL", right: "P", strike: 4, expiry: "2026-05-01" },
      ],
      net_price: 0.0,
      tif: "DAY",
      now,
      close_time: "2026-04-23T20:00:00Z",
      underlying_adv_30d: 3_800_000,
    });

    expect(r.score).toBe("LOW");
    expect(r.suggestion).toBe("CANCEL");
  });

  it("missing ADV → ADV rule skipped w/ warning", async () => {
    const now = "2026-04-23T15:00:00Z";
    const routes = buildRoutes({
      ticker: "AAPL",
      price: 180,
      expiries: {
        "2026-05-15": [{ strike: 175, type: "P", bid: 2.00, ask: 2.05, oi: 8_000 }],
        "2026-06-19": [{ strike: 175, type: "P", bid: 3.40, ask: 3.45, oi: 12_000 }],
      },
    });
    installFetch(routes);

    const r = await comboFillabilityHandler({
      ticker: "AAPL",
      legs: [
        { action: "BUY",  right: "P", strike: 175, expiry: "2026-05-15" },
        { action: "SELL", right: "P", strike: 175, expiry: "2026-06-19" },
      ],
      net_price: 1.40,
      tif: "DAY",
      now,
      close_time: "2026-04-23T20:00:00Z",
    });

    expect(r.warnings.some((w) => w.includes("underlying_adv_30d"))).toBe(true);
    expect(r.reasons.some((x) => x.includes("ADV"))).toBe(false);
  });
});
