import { describe, expect, it } from "vitest";
import { checkConcentrationHandler } from "../../src/tools/check-concentration.js";
import type { Profile } from "../../src/profiles/schema.js";

const PROFILE: Profile = {
  name: "personal", broker: "snaptrade",
  account_id: "22222222-2222-2222-2222-222222222222",
  tax_entity: "personal",
  caps: { max_order_notional: 50000, max_single_name_pct: 25, forbidden_tools: [], forbidden_leg_shapes: [] },
};

describe("checkConcentrationHandler", () => {
  it("labels positions correctly against cap", async () => {
    const r = await checkConcentrationHandler({
      profile: "personal",
      positions: [
        { ticker: "AAPL", market_value_usd: 30000 },
        { ticker: "NVDA", market_value_usd: 23000 },
        { ticker: "MSFT", market_value_usd: 10000 },
        { ticker: "GOOG", market_value_usd: 5000 },
      ],
      portfolio_total_usd: 100000,
    }, { allProfiles: [PROFILE] });

    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]!.ticker).toBe("AAPL");
    expect(r.violations[0]!.pct).toBe(30);
    expect(r.violations[0]!.over_cap_by_pct).toBe(5);

    const aapl = r.positions.find((p: any) => p.ticker === "AAPL");
    expect(aapl!.label).toBe("OVER-CAP");

    const nvda = r.positions.find((p: any) => p.ticker === "NVDA");
    expect(nvda!.label).toBe("NEAR-CAP"); // 22% is >90% of 25% cap

    const msft = r.positions.find((p: any) => p.ticker === "MSFT");
    expect(msft!.label).toBe("HEADROOM");
  });

  it("returns empty violations when all within cap", async () => {
    const r = await checkConcentrationHandler({
      profile: "personal",
      positions: [
        { ticker: "AAPL", market_value_usd: 10000 },
        { ticker: "NVDA", market_value_usd: 8000 },
      ],
      portfolio_total_usd: 100000,
    }, { allProfiles: [PROFILE] });

    expect(r.violations).toHaveLength(0);
    expect(r.positions.every((p: any) => p.label === "HEADROOM")).toBe(true);
  });

  it("computes HHI", async () => {
    const r = await checkConcentrationHandler({
      profile: "personal",
      positions: [
        { ticker: "AAPL", market_value_usd: 50000 },
        { ticker: "NVDA", market_value_usd: 50000 },
      ],
      portfolio_total_usd: 100000,
    }, { allProfiles: [PROFILE] });

    expect(r.hhi).toBe(5000);
  });

  it("warns on unknown profile", async () => {
    const r = await checkConcentrationHandler({
      profile: "unknown",
      positions: [{ ticker: "AAPL", market_value_usd: 50000 }],
      portfolio_total_usd: 100000,
    }, { allProfiles: [PROFILE] });

    expect(r.warnings).toContain("unknown profile: unknown");
  });

  it("sorts positions by pct descending", async () => {
    const r = await checkConcentrationHandler({
      profile: "personal",
      positions: [
        { ticker: "MSFT", market_value_usd: 5000 },
        { ticker: "AAPL", market_value_usd: 30000 },
        { ticker: "NVDA", market_value_usd: 15000 },
      ],
      portfolio_total_usd: 100000,
    }, { allProfiles: [PROFILE] });

    const tickers = r.positions.map((p: any) => p.ticker);
    expect(tickers).toEqual(["AAPL", "NVDA", "MSFT"]);
  });
});
