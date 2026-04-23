import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { proposeTradeHandler } from "../../src/tools/propose-trade.js";
import type { Profile } from "../../src/profiles/schema.js";

const PROFILE: Profile = {
  name: "personal", broker: "snaptrade",
  account_id: "22222222-2222-2222-2222-222222222222",
  tax_entity: "personal",
  caps: { max_order_notional: 10000, max_single_name_pct: 25, forbidden_tools: [], forbidden_leg_shapes: [] },
};

const deps = { allProfiles: [PROFILE] };

describe("proposeTradeHandler", () => {
  it("produces a CANDIDATE with correct sizing", async () => {
    const r = await proposeTradeHandler({
      profile: "personal",
      ticker: "NVDA",
      direction: "BUY",
      current_price: 100,
      portfolio_total_usd: 100000,
      existing_ticker_exposure_usd: 10000,
    }, deps);

    expect(r.status).toBe("CANDIDATE");
    expect(r.shares).toBeGreaterThan(0);
    expect(r.sizing.headroom_pct).toBe(15);
    expect(r.sizing.regime_multiplier).toBe(1.0);
    expect(r.concentration.current_pct).toBe(10);
    expect(r.concentration.label).toBe("HEADROOM");
  });

  it("applies regime multiplier in CAUTION", async () => {
    const clear = await proposeTradeHandler({
      profile: "personal", ticker: "NVDA", direction: "BUY",
      current_price: 100, portfolio_total_usd: 100000,
      existing_ticker_exposure_usd: 0, regime_tier: "CLEAR",
    }, deps);

    const caution = await proposeTradeHandler({
      profile: "personal", ticker: "NVDA", direction: "BUY",
      current_price: 100, portfolio_total_usd: 100000,
      existing_ticker_exposure_usd: 0, regime_tier: "CAUTION",
    }, deps);

    expect(caution.sizing.adjusted_size_usd).toBeLessThan(clear.sizing.adjusted_size_usd);
    expect(caution.sizing.regime_multiplier).toBe(0.75);
  });

  it("rejects BUY in DEFENSIVE regime", async () => {
    const r = await proposeTradeHandler({
      profile: "personal", ticker: "NVDA", direction: "BUY",
      current_price: 100, portfolio_total_usd: 100000,
      regime_tier: "DEFENSIVE",
    }, deps);

    expect(r.status).toBe("REJECTED");
    expect(r.reason).toContain("blocked");
  });

  it("rejects when over cap", async () => {
    const r = await proposeTradeHandler({
      profile: "personal", ticker: "AAPL", direction: "BUY",
      current_price: 200, portfolio_total_usd: 100000,
      existing_ticker_exposure_usd: 30000,
    }, deps);

    expect(r.status).toBe("REJECTED");
    expect(r.reason).toContain("exceeds");
    expect(r.concentration.label).toBe("OVER-CAP");
  });

  it("caps notional at max_order_notional", async () => {
    const r = await proposeTradeHandler({
      profile: "personal", ticker: "SPY", direction: "BUY",
      current_price: 10, portfolio_total_usd: 1000000,
      existing_ticker_exposure_usd: 0,
    }, deps);

    expect(r.status).toBe("CANDIDATE");
    expect(r.notional_usd).toBeLessThanOrEqual(10000);
    expect(r.cap_check).toBe("PASS");
  });

  it("rejects unknown profile", async () => {
    const r = await proposeTradeHandler({
      profile: "unknown", ticker: "NVDA", direction: "BUY",
      current_price: 100, portfolio_total_usd: 100000,
    }, deps);

    expect(r.status).toBe("REJECTED");
    expect(r.reason).toContain("unknown profile");
  });

  it("allows SELL in any regime", async () => {
    const r = await proposeTradeHandler({
      profile: "personal", ticker: "NVDA", direction: "SELL",
      current_price: 100, portfolio_total_usd: 100000,
      existing_ticker_exposure_usd: 20000, regime_tier: "HALT",
    }, deps);

    expect(r.status).toBe("CANDIDATE");
  });

  it("includes thesis_ref and signal_summary when provided", async () => {
    const r = await proposeTradeHandler({
      profile: "personal", ticker: "AG", direction: "BUY",
      current_price: 25, portfolio_total_usd: 100000,
      thesis_ref: "silver-inflation-hedge",
      signal_summary: "UW flow spike + darkpool block",
    }, deps);

    expect(r.thesis_ref).toBe("silver-inflation-hedge");
    expect(r.signal_summary).toBe("UW flow spike + darkpool block");
  });

  describe("R14 roll_context fillability gate", () => {
    beforeEach(() => {
      process.env.UW_TOKEN = "test-uw";
    });
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    function occ(t: string, yymmdd: string, cp: "C" | "P", strike: number): string {
      const s = String(Math.round(strike * 1000)).padStart(8, "0");
      return `${t}${yymmdd}${cp}${s}`;
    }
    function yymmdd(iso: string): string {
      return iso.slice(2, 4) + iso.slice(5, 7) + iso.slice(8, 10);
    }
    function install(ticker: string, price: number, chain: Record<string, { strike: number; type: "C"|"P"; bid: number; ask: number; oi: number }[]>) {
      const routes: Record<string, any> = { [`/stock/${ticker}/stock-state`]: { data: { close: price, prev_close: price - 0.1 } } };
      for (const [iso, legs] of Object.entries(chain)) {
        routes[`/stock/${ticker}/option-contracts?expiry=${iso}`] = {
          data: legs.map((l) => ({
            option_symbol: occ(ticker, yymmdd(iso), l.type, l.strike),
            nbbo_bid: String(l.bid), nbbo_ask: String(l.ask), open_interest: l.oi, volume: 50,
          })),
        };
        routes[`/stock/${ticker}/greeks?expiry=${iso}`] = { data: [] };
      }
      vi.stubGlobal("fetch", vi.fn(async (input: any) => {
        const url = String(input);
        const m = Object.keys(routes).filter((p) => url.includes(p)).sort((a,b)=>b.length-a.length);
        return m.length ? { ok: true, status: 200, text: async () => JSON.stringify(routes[m[0]!]), json: async () => routes[m[0]!] } as any
                        : { ok: false, status: 404, text: async () => "nf", json: async () => ({}) } as any;
      }));
    }

    it("LOW fillability → suggested_structure=leg_out + warning", async () => {
      install("BBAI", 3.72, {
        "2026-04-24": [{ strike: 4, type: "P", bid: 0.29, ask: 0.30, oi: 1342 }],
        "2026-05-01": [{ strike: 4, type: "P", bid: 0.38, ask: 0.41, oi: 1876 }],
      });
      const r = await proposeTradeHandler({
        profile: "personal", ticker: "BBAI", direction: "SELL_TO_OPEN",
        current_price: 3.72, portfolio_total_usd: 100000,
        structure: "calendar_roll",
        roll_context: {
          legs: [
            { action: "BUY",  right: "P", strike: 4, expiry: "2026-04-24" },
            { action: "SELL", right: "P", strike: 4, expiry: "2026-05-01" },
          ],
          net_price: 0.05,
          tif: "DAY",
          underlying_adv_30d: 3_800_000,
          now: "2026-04-23T19:45:00Z",
          close_time: "2026-04-23T20:00:00Z",
        },
      }, deps);

      expect(r.status).toBe("CANDIDATE");
      expect(r.fillability).toBeDefined();
      expect(r.fillability.score).toBe("LOW");
      expect(r.suggested_structure).toBe("leg_out");
      expect(r.warnings.some((w: string) => w.includes("R14") && w.includes("LOW"))).toBe(true);
    });

    it("calendar_roll w/o roll_context → warning only", async () => {
      const r = await proposeTradeHandler({
        profile: "personal", ticker: "SPY", direction: "SELL_TO_OPEN",
        current_price: 500, portfolio_total_usd: 100000,
        structure: "calendar_roll",
      }, deps);
      expect(r.warnings.some((w: string) => w.includes("roll_context"))).toBe(true);
      expect(r.fillability).toBeNull();
    });

    it("non-roll structure → no fillability call", async () => {
      const r = await proposeTradeHandler({
        profile: "personal", ticker: "SPY", direction: "BUY",
        current_price: 500, portfolio_total_usd: 100000,
        structure: "equity",
      }, deps);
      expect(r.fillability).toBeNull();
      expect(r.warnings).toEqual([]);
    });
  });
});
