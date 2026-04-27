import { describe, expect, it } from "vitest";
import { earningsCalendarHandler } from "../../src/tools/earnings-calendar.js";

describe("earningsCalendarHandler", () => {
  const AS_OF = "2026-04-27";

  it("returns empty rows when no earnings supplied", async () => {
    const r = await earningsCalendarHandler({
      as_of: AS_OF,
      held_tickers: ["AAPL"],
      earnings: [],
    });
    expect(r.rows).toHaveLength(0);
    expect(r.summary.held_into_earnings_count).toBe(0);
    expect(r.summary.next_7_days).toBe(0);
  });

  it("filters to held + watchlist tickers only", async () => {
    const r = await earningsCalendarHandler({
      as_of: AS_OF,
      held_tickers: ["AAPL"],
      watchlist_tickers: ["NVDA"],
      earnings: [
        { ticker: "AAPL", earnings_date: "2026-05-01" },
        { ticker: "NVDA", earnings_date: "2026-05-08" },
        { ticker: "TSLA", earnings_date: "2026-05-02" },
      ],
    });
    expect(r.rows).toHaveLength(2);
    const tickers = r.rows.map((row) => row.ticker).sort();
    expect(tickers).toEqual(["AAPL", "NVDA"]);
  });

  it("flags HELD ticker within 2 days w/ R1", async () => {
    const r = await earningsCalendarHandler({
      as_of: AS_OF,
      held_tickers: ["AAPL"],
      earnings: [{ ticker: "AAPL", earnings_date: "2026-04-28", iv_tier: "YELLOW" }],
    });
    expect(r.rows[0]!.earnings_window).toBe("WITHIN_2D");
    expect(r.rows[0]!.status).toBe("HELD");
    expect(r.rows[0]!.flags.some((f) => f.includes("R1"))).toBe(true);
    expect(r.summary.held_into_earnings_count).toBe(1);
  });

  it("flags RED-tier IV crush warning within 7d", async () => {
    const r = await earningsCalendarHandler({
      as_of: AS_OF,
      held_tickers: ["NVDA"],
      earnings: [{ ticker: "NVDA", earnings_date: "2026-05-02", iv_tier: "RED" }],
    });
    expect(r.rows[0]!.flags.some((f) => f.includes("RED-tier"))).toBe(true);
    expect(r.summary.red_tier_in_window).toBe(1);
  });

  it("flags GREEN-tier IV-harvest candidate within 14d", async () => {
    const r = await earningsCalendarHandler({
      as_of: AS_OF,
      watchlist_tickers: ["XLE"],
      earnings: [{ ticker: "XLE", earnings_date: "2026-05-08", iv_tier: "GREEN" }],
    });
    expect(r.rows[0]!.flags.some((f) => f.includes("GREEN-tier"))).toBe(true);
    expect(r.summary.green_tier_in_window).toBe(1);
  });

  it("flags SHORT leg expiring after earnings (assignment risk)", async () => {
    const r = await earningsCalendarHandler({
      as_of: AS_OF,
      held_tickers: ["NVDA"],
      earnings: [{ ticker: "NVDA", earnings_date: "2026-05-02" }],
      open_option_legs: [
        { ticker: "NVDA", expiry: "2026-05-15", strike: 900, right: "P", side: "SHORT" },
      ],
    });
    expect(r.rows[0]!.conflicting_legs).toHaveLength(1);
    expect(r.rows[0]!.conflicting_legs[0]!.expires_within_earnings).toBe(true);
    expect(r.rows[0]!.flags.some((f) => f.includes("SHORT leg"))).toBe(true);
  });

  it("watchlist-only ticker outside earnings window is excluded by lookahead", async () => {
    const r = await earningsCalendarHandler({
      as_of: AS_OF,
      lookahead_days: 14,
      watchlist_tickers: ["MSFT"],
      earnings: [{ ticker: "MSFT", earnings_date: "2026-05-30" }],
    });
    expect(r.rows).toHaveLength(0);
  });

  it("excludes earnings dates already in the past", async () => {
    const r = await earningsCalendarHandler({
      as_of: AS_OF,
      held_tickers: ["AAPL"],
      earnings: [{ ticker: "AAPL", earnings_date: "2026-04-20" }],
    });
    expect(r.rows).toHaveLength(0);
  });

  it("emits earnings_within_days_map + iv_tier_map for signal_rank consumption", async () => {
    const r = await earningsCalendarHandler({
      as_of: AS_OF,
      held_tickers: ["NVDA", "AAPL"],
      earnings: [
        { ticker: "NVDA", earnings_date: "2026-05-02", iv_tier: "RED" },
        { ticker: "AAPL", earnings_date: "2026-05-08", iv_tier: "GREEN" },
      ],
    });
    expect(r.earnings_within_days_map).toEqual({ NVDA: 5, AAPL: 11 });
    expect(r.iv_tier_map).toEqual({ NVDA: "RED", AAPL: "GREEN" });
  });

  it("classifies ticker in both held + watchlist as BOTH", async () => {
    const r = await earningsCalendarHandler({
      as_of: AS_OF,
      held_tickers: ["NVDA"],
      watchlist_tickers: ["NVDA"],
      earnings: [{ ticker: "NVDA", earnings_date: "2026-05-02" }],
    });
    expect(r.rows[0]!.status).toBe("BOTH");
  });

  it("sorts rows by days_until ascending", async () => {
    const r = await earningsCalendarHandler({
      as_of: AS_OF,
      held_tickers: ["AAPL", "NVDA", "TSLA"],
      earnings: [
        { ticker: "AAPL", earnings_date: "2026-05-08" },
        { ticker: "NVDA", earnings_date: "2026-04-29" },
        { ticker: "TSLA", earnings_date: "2026-05-04" },
      ],
    });
    expect(r.rows.map((row) => row.ticker)).toEqual(["NVDA", "TSLA", "AAPL"]);
  });

  it("respects lookahead_days truncation", async () => {
    const r = await earningsCalendarHandler({
      as_of: AS_OF,
      lookahead_days: 5,
      held_tickers: ["AAPL", "NVDA"],
      earnings: [
        { ticker: "NVDA", earnings_date: "2026-04-30" },
        { ticker: "AAPL", earnings_date: "2026-05-15" },
      ],
    });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.ticker).toBe("NVDA");
  });
});
